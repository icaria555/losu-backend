import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import {
  GOAL_OFFSET_MAX, GOAL_OFFSET_MIN, LEGACY_GOALS, LEGACY_GOAL_OFFSETS, legacyGoalFor,
} from '../data/goal';

const router = Router();
const prisma = new PrismaClient();


const updateProfileSchema = z.object({
  sex: z.enum(['m', 'f']).optional(),
  age: z.number().int().min(14).max(120).optional(),
  heightCm: z.number().positive().optional(),
  weightKg: z.number().positive().optional(),
  units: z.enum(['met', 'imp']).nullable().optional(),
  language: z.enum(['en', 'th']).nullable().optional(),
  goalOffsetKcal: z.number().int().min(GOAL_OFFSET_MIN).max(GOAL_OFFSET_MAX).optional(),
  // Legacy preset from app builds that predate goalOffsetKcal — converted
  // below, and ignored if goalOffsetKcal is also sent.
  goal: z.enum(LEGACY_GOALS).optional(),
  activity: z.number().int().min(0).max(3).optional(),
  connected: z.boolean().optional(),
  hcTier: z.enum(['total', 'active']).nullable().optional(),
  onboarded: z.boolean().optional(),
});

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;

      // Upsert so a user created before profiles existed (or any race with
      // registration) always has one to read.
      const profile = await prisma.profile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      res.json(profile);
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { goal: legacyGoal, ...rest } = updateProfileSchema.parse(req.body);
      const goalOffsetKcal = rest.goalOffsetKcal
        ?? (legacyGoal !== undefined ? LEGACY_GOAL_OFFSETS[legacyGoal] : undefined);
      const data = goalOffsetKcal === undefined
        ? rest
        : { ...rest, goalOffsetKcal, goal: legacyGoalFor(goalOffsetKcal) };

      const profile = await prisma.profile.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      });

      res.json(profile);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
