import { z } from 'zod-mcp';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import { PrismaClient } from '@prisma/client';
import { userIdFromAuthInfo } from './auth';
import { weeklyTopSets, weeklyVolume } from './weeklyBuckets';
import { muscleFor, catalogByMuscle } from '../data/muscleGroups';
import { logger } from '../utils/logger';

/** Flattened "Muscle: a, b, c" lines for the update_routine tool description
 * — gives the model the same exercise vocabulary Edit Routine's checklist
 * uses, so a proposed routine actually renders with muscle tags and shows
 * up checked there, instead of silently falling back to untagged names. */
function catalogSummary(): string {
  return (Object.entries(catalogByMuscle()) as [string, string[]][])
    .map(([muscle, names]) => `${muscle}: ${names.join(', ')}`)
    .join(' | ');
}

const prisma = new PrismaClient();

function requireUserId(ctx: ServerContext): string {
  return userIdFromAuthInfo(ctx.http?.authInfo);
}

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** Wraps a tool handler so unexpected errors (Prisma failures, etc.) never
 * leak internal details — stack traces, file paths, query text — into what
 * the model/user sees; the real error is logged server-side instead. */
function safeTool<Args>(
  toolName: string,
  fn: (args: Args, ctx: ServerContext) => Promise<CallToolResult>,
) {
  return async (args: Args, ctx: ServerContext): Promise<CallToolResult> => {
    try {
      return await fn(args, ctx);
    } catch (error) {
      logger.error(`MCP tool "${toolName}" failed`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return errorResult(`${toolName} failed. Please try again.`);
    }
  };
}

/** Registers Tally's chat-assistant tools on a fresh McpServer instance. */
export function registerTallyTools(server: McpServer): void {
  server.registerTool(
    'log_meal',
    {
      title: 'Log a meal',
      description:
        "Logs a meal (calories + macros) to the user's food diary, same as adding it from the Today screen. loggedAt defaults to now.",
      inputSchema: z.object({
        name: z.string().min(1).describe('Meal name, e.g. "Chicken rice bowl"'),
        kcal: z.number().int().min(0),
        carbsG: z.number().int().min(0),
        proteinG: z.number().int().min(0),
        fatG: z.number().int().min(0),
        loggedAt: z
          .string()
          .datetime()
          .optional()
          .describe('ISO 8601 timestamp of when the meal was eaten; defaults to now'),
      }),
    },
    safeTool('log_meal', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const meal = await prisma.meal.create({
        data: {
          userId,
          name: args.name,
          kcal: args.kcal,
          carbsG: args.carbsG,
          proteinG: args.proteinG,
          fatG: args.fatG,
          loggedAt: args.loggedAt ? new Date(args.loggedAt) : new Date(),
        },
      });
      return textResult({ ok: true, meal });
    }),
  );

  server.registerTool(
    'log_set',
    {
      title: 'Log a workout set',
      description:
        "Logs one completed set (exercise, weight, reps) to the user's workout history, same as Set Log on the Train screen. completedAt defaults to now.",
      inputSchema: z.object({
        exercise: z.string().min(1).describe('Exercise name as the user refers to it, e.g. "Chest press"'),
        weightKg: z.number().min(0),
        reps: z.number().int().min(0),
        completedAt: z
          .string()
          .datetime()
          .optional()
          .describe('ISO 8601 timestamp the set was completed; defaults to now'),
      }),
    },
    safeTool('log_set', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const set = await prisma.loggedSet.create({
        data: {
          userId,
          exercise: args.exercise,
          weightKg: args.weightKg,
          reps: args.reps,
          completedAt: args.completedAt ? new Date(args.completedAt) : new Date(),
        },
      });
      return textResult({ ok: true, set });
    }),
  );

  server.registerTool(
    'log_body_weight',
    {
      title: 'Log body weight',
      description:
        "Updates the user's current body weight on their profile (the same value shown/edited on the You screen). Tally does not keep a historical body-weight log — this overwrites the current value.",
      inputSchema: z.object({
        weightKg: z.number().positive(),
      }),
    },
    safeTool('log_body_weight', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const profile = await prisma.profile.upsert({
        where: { userId },
        update: { weightKg: args.weightKg },
        create: { userId, weightKg: args.weightKg },
      });
      return textResult({ ok: true, profile });
    }),
  );

  server.registerTool(
    'update_routine',
    {
      title: 'Set the workout routine',
      description:
        `Replaces the user's single active routine (the "Today · routine" card on Train, and its exercise ` +
        `checklist on Edit Routine) — same as saving changes there by hand. This overwrites the whole exercise ` +
        `list, it doesn't append to it, so only call it after the user has confirmed a specific routine you've ` +
        `proposed in chat — never on a vague "give me a routine" without first describing what you'd set and ` +
        `getting a yes. Prefer exercise names from Tally's catalog so they get a muscle-group tag and show up ` +
        `checked on Edit Routine: ${catalogSummary()}. A name outside this catalog is still allowed (e.g. an ` +
        `exercise the user has logged before that isn't in the catalog) but won't have a muscle group.`,
      inputSchema: z.object({
        name: z.string().min(1).optional().describe('Routine name, e.g. "Push A"; omit to keep the current name'),
        exercises: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe('Full replacement exercise list, in the order they should appear; omit to keep the current list'),
      }),
    },
    safeTool('update_routine', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const routine = await prisma.routine.upsert({
        where: { userId },
        update: args,
        create: { userId, ...args },
      });
      return textResult({ ok: true, routine: { name: routine.name, exercises: routine.exercises } });
    }),
  );

  server.registerTool(
    'get_progress',
    {
      title: 'Get progress summary',
      description:
        'Reads back progress data to answer questions like "how is my bench doing", "how has my week of eating been", or "what should I train next": profile (incl. current body weight and goal), per-exercise weekly top-set/volume trend (or last set + muscle group per exercise if no exercise is named — use the completedAt dates to see which muscle groups were trained today/recently and suggest a different one), and recent nutrition averages.',
      inputSchema: z.object({
        exercise: z.string().min(1).optional().describe('Exercise to get a weekly trend for; omit for an overview of every logged exercise'),
        weeks: z.number().int().min(1).max(26).optional().describe('How many recent weeks of lifting trend to include; default 6'),
        nutritionDays: z.number().int().min(1).max(90).optional().describe('How many recent days of meals to average; default 7'),
      }),
    },
    safeTool('get_progress', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const weeks = args.weeks ?? 6;
      const nutritionDays = args.nutritionDays ?? 7;

      const profile = await prisma.profile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      let exerciseProgress: unknown = null;
      let allExercisesLastSet: unknown = undefined;

      if (args.exercise) {
        const sets = await prisma.loggedSet.findMany({
          where: { userId, exercise: args.exercise },
          orderBy: { completedAt: 'asc' },
        });
        const lastSet = sets.length ? sets[sets.length - 1] : null;
        exerciseProgress = {
          name: args.exercise,
          muscle: muscleFor(args.exercise),
          setsLogged: sets.length,
          weeklyTopSetsKg: weeklyTopSets(sets, weeks),
          weeklyVolumeKg: weeklyVolume(sets, weeks),
          lastSet: lastSet
            ? { weightKg: lastSet.weightKg, reps: lastSet.reps, completedAt: lastSet.completedAt }
            : null,
        };
      } else {
        const sets = await prisma.loggedSet.findMany({
          where: { userId },
          distinct: ['exercise'],
          orderBy: { completedAt: 'desc' },
        });
        // Tagged with muscle group (Chest/Back/Legs/Shoulders/Arms/Core, or
        // null for an exercise outside the known catalog) so the assistant
        // can reason about which muscle groups were trained recently — e.g.
        // "heavy leg day today" — without guessing from the exercise name.
        allExercisesLastSet = Object.fromEntries(
          sets.map((s) => [
            s.exercise,
            { weightKg: s.weightKg, reps: s.reps, completedAt: s.completedAt, muscle: muscleFor(s.exercise) },
          ]),
        );
      }

      const sinceDate = new Date();
      sinceDate.setUTCDate(sinceDate.getUTCDate() - nutritionDays);
      const meals = await prisma.meal.findMany({
        where: { userId, loggedAt: { gte: sinceDate } },
      });
      const dayKeys = new Set(meals.map((m) => m.loggedAt.toISOString().slice(0, 10)));
      const daysWithLoggedMeals = dayKeys.size;
      const totals = meals.reduce(
        (acc, m) => ({
          kcal: acc.kcal + m.kcal,
          carbsG: acc.carbsG + m.carbsG,
          proteinG: acc.proteinG + m.proteinG,
          fatG: acc.fatG + m.fatG,
        }),
        { kcal: 0, carbsG: 0, proteinG: 0, fatG: 0 },
      );
      const divisor = daysWithLoggedMeals || 1;

      // Individual rows with ids, most recent first, capped well below the
      // full window — this is what makes update_meal/delete_meal usable:
      // the assistant resolves "which meal" from here (by name/time it can
      // already see in the conversation) rather than needing to remember an
      // id across turns, since chat history it's re-given each turn is
      // text-only (see chat.ts).
      const recentMeals = meals
        .slice()
        .sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime())
        .slice(0, 10)
        .map((m) => ({
          id: m.id, name: m.name, kcal: m.kcal, carbsG: m.carbsG, proteinG: m.proteinG, fatG: m.fatG,
          loggedAt: m.loggedAt,
        }));

      return textResult({
        profile: {
          weightKg: profile.weightKg,
          goal: profile.goal,
          sex: profile.sex,
          age: profile.age,
          heightCm: profile.heightCm,
          units: profile.units,
        },
        exercise: exerciseProgress,
        allExercisesLastSet,
        nutrition: {
          windowDays: nutritionDays,
          daysWithLoggedMeals,
          averageDailyKcal: Math.round(totals.kcal / divisor),
          averageDailyProteinG: Math.round(totals.proteinG / divisor),
          averageDailyCarbsG: Math.round(totals.carbsG / divisor),
          averageDailyFatG: Math.round(totals.fatG / divisor),
          recentMeals,
        },
      });
    }),
  );

  server.registerTool(
    'update_meal',
    {
      title: 'Edit a logged meal',
      description:
        'Corrects a meal already in the diary — e.g. the user clarifies portion size or ingredients after ' +
        "log_meal ran, or points out a wrong number. Only pass the fields that change; anything omitted keeps " +
        "its current value. Needs the meal's id — if you don't already have it from earlier in this " +
        'conversation, call get_progress first and read it off nutrition.recentMeals (matched by name/time).',
      inputSchema: z.object({
        id: z.string().min(1).describe('The meal id, from log_meal\'s result or get_progress\'s nutrition.recentMeals'),
        name: z.string().min(1).optional(),
        kcal: z.number().int().min(0).optional(),
        carbsG: z.number().int().min(0).optional(),
        proteinG: z.number().int().min(0).optional(),
        fatG: z.number().int().min(0).optional(),
      }),
    },
    safeTool('update_meal', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const { id, ...patch } = args;
      const existing = await prisma.meal.findFirst({ where: { id, userId } });
      if (!existing) return errorResult('No meal with that id was found.');
      const meal = await prisma.meal.update({ where: { id }, data: patch });
      return textResult({ ok: true, meal });
    }),
  );

  server.registerTool(
    'delete_meal',
    {
      title: 'Delete a logged meal',
      description:
        "Removes a meal from the diary entirely — e.g. the user says a log was wrong and just wants it gone, " +
        "or it was a duplicate. Needs the meal's id — if you don't already have it, call get_progress first " +
        'and read it off nutrition.recentMeals.',
      inputSchema: z.object({
        id: z.string().min(1).describe('The meal id, from log_meal\'s result or get_progress\'s nutrition.recentMeals'),
      }),
    },
    safeTool('delete_meal', async (args, ctx) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.meal.findFirst({ where: { id: args.id, userId } });
      if (!existing) return errorResult('No meal with that id was found.');
      await prisma.meal.delete({ where: { id: args.id } });
      return textResult({ ok: true });
    }),
  );
}
