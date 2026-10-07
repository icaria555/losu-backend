import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { estimateLanguageInstruction, userLanguage } from '../data/language';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { imageSchema, MAX_IMAGES } from '../utils/images';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

const createMealSchema = z.object({
  name: z.string().min(1),
  kcal: z.number().int().min(0),
  carbsG: z.number().int().min(0),
  proteinG: z.number().int().min(0),
  fatG: z.number().int().min(0),
  loggedAt: z.string().datetime().optional(), // defaults to now
});

const listQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

function dayRange(dateStr?: string): { gte: Date; lt: Date } {
  const base = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { date } = listQuerySchema.parse(req.query);
      const { gte, lt } = dayRange(date);

      const meals = await prisma.meal.findMany({
        where: { userId, loggedAt: { gte, lt } },
        orderBy: { loggedAt: 'asc' },
      });

      res.json({ meals });
    } catch (error) {
      next(error);
    }
  },
);

const frequentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

router.get(
  '/frequent',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { limit } = frequentQuerySchema.parse(req.query);
      const take = limit ?? 3;

      // Group by exact name and rank by how often it's been logged — "You've
      // had this before" is meant as a one-tap repeat of your actual habits,
      // not a fuzzy "similar meals" match.
      const grouped = await prisma.meal.groupBy({
        by: ['name'],
        where: { userId },
        _count: { name: true },
        orderBy: { _count: { name: 'desc' } },
        take,
      });

      // Macros for a name aren't fixed (you might log "Chicken rice bowl" at
      // slightly different portions each time) — use the most recently
      // logged instance's macros as the representative one, same principle
      // as `lastByExercise` for workout sets: repeat what you actually did
      // last time, not an average that never happened.
      const meals = await Promise.all(
        grouped.map(async (g) => {
          const latest = await prisma.meal.findFirst({
            where: { userId, name: g.name },
            orderBy: { loggedAt: 'desc' },
          });
          return {
            name: g.name,
            count: g._count.name,
            kcal: latest!.kcal,
            carbsG: latest!.carbsG,
            proteinG: latest!.proteinG,
            fatG: latest!.fatG,
          };
        }),
      );

      res.json({ meals });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = createMealSchema.parse(req.body);

      const meal = await prisma.meal.create({
        data: {
          userId,
          name: data.name,
          kcal: data.kcal,
          carbsG: data.carbsG,
          proteinG: data.proteinG,
          fatG: data.fatG,
          loggedAt: data.loggedAt ? new Date(data.loggedAt) : new Date(),
        },
      });

      res.status(201).json(meal);
    } catch (error) {
      next(error);
    }
  },
);

// ── Estimate ─────────────────────────────────────────────────────────────
// Photo and/or description → itemized macro estimate for LogMealScreen's
// review step. Read-only: nothing is logged here — the user adjusts portions
// on the estimate screen and the client then POSTs /meals as usual.

const estimateRequestSchema = z
  .object({
    note: z.string().max(1000).optional(),
    images: z.array(imageSchema).max(MAX_IMAGES).optional(),
  })
  .refine((b) => (b.note?.trim().length ?? 0) > 0 || (b.images?.length ?? 0) > 0, {
    message: 'Send a description, a photo, or both',
  });

// Totals for the item at `grams` — the client derives per-gram rates from
// these so its ± portion stepper scales macros linearly.
const ESTIMATE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short food name, in the language the instruction asks for' },
          grams: { type: 'integer', description: 'Estimated edible portion weight in grams' },
          confidence: { type: 'string', enum: ['high', 'med', 'low'] },
          kcal: { type: 'integer' },
          carbsG: { type: 'integer' },
          proteinG: { type: 'integer' },
          fatG: { type: 'integer' },
        },
        required: ['name', 'grams', 'confidence', 'kcal', 'carbsG', 'proteinG', 'fatG'],
      },
    },
  },
  required: ['items'],
};

const estimatedItemSchema = z.object({
  name: z.string().min(1),
  grams: z.number().positive(),
  confidence: z.enum(['high', 'med', 'low']),
  kcal: z.number().min(0),
  carbsG: z.number().min(0),
  proteinG: z.number().min(0),
  fatG: z.number().min(0),
});

const ESTIMATE_INSTRUCTION = `You estimate the nutrition of a meal for a calorie-tracking app.
Break the meal into its main components (usually 1–5 items: e.g. rice, the protein, a sauce/oil, a side) and,
for each, estimate the edible portion in grams and the kcal/carbs/protein/fat for that portion. Use the
user's stated quantities when given; otherwise judge typical portions (from the photo's plate size and
proportions when there's a photo). Include cooking oil/butter/sauce when the dish implies it. Confidence:
"high" for stated quantities or unambiguous items, "med" for typical-portion guesses, "low" when the item or
amount is hard to tell. If there's a photo and a note, the note's details override what the photo suggests.
If the input isn't food at all, return an empty items list.`;

router.post(
  '/estimate',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!config.geminiApiKey) {
      res.status(503).json({ error: 'Meal estimation is not configured yet', code: 'estimate_not_configured' });
      return;
    }
    try {
      const { note, images } = estimateRequestSchema.parse(req.body);
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const response = await ai.models.generateContent({
        model: config.geminiModel,
        config: {
          systemInstruction: ESTIMATE_INSTRUCTION + estimateLanguageInstruction(await userLanguage(prisma, req.user!.userId)),
          responseMimeType: 'application/json',
          responseJsonSchema: ESTIMATE_RESPONSE_SCHEMA,
        },
        contents: [{
          role: 'user',
          parts: [
            { text: note?.trim() ? `Meal: ${note.trim()}` : 'Estimate the meal in the photo.' },
            ...(images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
          ],
        }],
      });

      const parsed = z.object({ items: z.array(estimatedItemSchema) }).parse(JSON.parse(response.text ?? ''));
      res.json({
        items: parsed.items.map((it) => ({
          ...it,
          grams: Math.round(it.grams),
          kcal: Math.round(it.kcal),
          carbsG: Math.round(it.carbsG),
          proteinG: Math.round(it.proteinG),
          fatG: Math.round(it.fatG),
        })),
      });
    } catch (error) {
      logger.error('Meal estimate failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      next(error);
    }
  },
);

router.delete(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const meal = await prisma.meal.findFirst({ where: { id: req.params.id, userId } });
      if (!meal) {
        throw new AppError(404, 'Meal not found');
      }
      await prisma.meal.delete({ where: { id: meal.id } });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
