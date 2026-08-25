import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const createSetSchema = z.object({
  exercise: z.string().min(1),
  weightKg: z.number().min(0),
  reps: z.number().int().min(0),
  completedAt: z.string().datetime().optional(), // defaults to now
});

const listQuerySchema = z.object({
  exercise: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => parseInt(v || '50', 10))
    .pipe(z.number().int().min(1).max(500)),
});

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { exercise, limit } = listQuerySchema.parse(req.query);

      const sets = await prisma.loggedSet.findMany({
        where: { userId, ...(exercise ? { exercise } : {}) },
        orderBy: { completedAt: 'desc' },
        take: limit,
      });

      res.json({ sets });
    } catch (error) {
      next(error);
    }
  },
);

// Most recent set per distinct exercise — backs "last weight" lookups on the
// Train/Library screens without an N+1 request per exercise.
router.get(
  '/last',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;

      const sets = await prisma.loggedSet.findMany({
        where: { userId },
        distinct: ['exercise'],
        orderBy: { completedAt: 'desc' },
      });

      res.json({
        lastByExercise: Object.fromEntries(
          sets.map((s) => [s.exercise, { weightKg: s.weightKg, reps: s.reps, completedAt: s.completedAt }]),
        ),
      });
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
      const data = createSetSchema.parse(req.body);

      const set = await prisma.loggedSet.create({
        data: {
          userId,
          exercise: data.exercise,
          weightKg: data.weightKg,
          reps: data.reps,
          completedAt: data.completedAt ? new Date(data.completedAt) : new Date(),
        },
      });

      res.status(201).json(set);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
