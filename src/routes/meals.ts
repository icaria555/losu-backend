import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

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
