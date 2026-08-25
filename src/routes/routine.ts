import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const updateRoutineSchema = z.object({
  name: z.string().min(1).optional(),
  exercises: z.array(z.string().min(1)).min(1).optional(),
});

async function withLastDone(userId: string, routine: { name: string; exercises: string[] }) {
  // "Last done" isn't stored on the routine — computed from its own logged
  // history, so it's always accurate without needing to be kept in sync
  // when the routine's exercise list changes.
  const lastSet = await prisma.loggedSet.findFirst({
    where: { userId, exercise: { in: routine.exercises } },
    orderBy: { completedAt: 'desc' },
  });
  return { name: routine.name, exercises: routine.exercises, lastDone: lastSet?.completedAt.toISOString() ?? null };
}

router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const routine = await prisma.routine.upsert({ where: { userId }, update: {}, create: { userId } });
      res.json(await withLastDone(userId, routine));
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
      const data = updateRoutineSchema.parse(req.body);
      const routine = await prisma.routine.upsert({ where: { userId }, update: data, create: { userId, ...data } });
      res.json(await withLastDone(userId, routine));
    } catch (error) {
      next(error);
    }
  },
);

export default router;
