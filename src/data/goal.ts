// Calorie-goal rules shared by the profile route and the chat assistant's
// update_goal tool. The frontend keeps its own copy of the same numbers in
// frontend/src/state/calc.ts (no shared package) — change both together.

/** Allowed range for the daily goal adjustment, in kcal/day. Negative is a
 * cut, positive a bulk. Wider than any sane plan on purpose, so it only
 * catches typos/extremes; the minimum-target warning below handles the
 * "legal but aggressive" middle. */
export const GOAL_OFFSET_MIN = -1000;
export const GOAL_OFFSET_MAX = 700;

/** The pre-custom-offset goal presets, still accepted from older app builds
 * (and kept in the deprecated `Profile.goal` column). */
export const LEGACY_GOALS = ['Maintain', 'Cut (−450)', 'Bulk (+300)'] as const;
export type LegacyGoal = (typeof LEGACY_GOALS)[number];

export const LEGACY_GOAL_OFFSETS: Record<LegacyGoal, number> = {
  Maintain: 0,
  'Cut (−450)': -450,
  'Bulk (+300)': 300,
};

/** Closest legacy preset for an offset, by sign — written alongside
 * goalOffsetKcal so the deprecated column (and any old app build still
 * reading it) stays roughly right. */
export function legacyGoalFor(offsetKcal: number): LegacyGoal {
  if (offsetKcal < 0) return 'Cut (−450)';
  if (offsetKcal > 0) return 'Bulk (+300)';
  return 'Maintain';
}

/** Human label, e.g. "Cut 200", "Maintain", "Bulk 300". */
export function goalLabel(offsetKcal: number): string {
  if (offsetKcal < 0) return `Cut ${-offsetKcal}`;
  if (offsetKcal > 0) return `Bulk ${offsetKcal}`;
  return 'Maintain';
}

/** Daily target below which Tally warns (but still allows it). */
export const MIN_TARGET_KCAL: Record<'m' | 'f', number> = { m: 1500, f: 1200 };

export function minTargetFor(sex: string): number {
  return sex === 'f' ? MIN_TARGET_KCAL.f : MIN_TARGET_KCAL.m;
}

const ACTIVITY_MULT = [1.2, 1.375, 1.55, 1.725] as const;

type TargetInputs = {
  sex: string; age: number; heightCm: number; weightKg: number; activity: number; connected: boolean;
};

/** Server-side estimate of the daily target, for the chat tool's warning
 * only. The app's real target for a Health Connect user is built from
 * on-device burn data the server never sees, so for them this uses a
 * deliberately low burn (resting + minimal activity, the floor of what
 * calc.ts can produce) — i.e. "on a quiet day it could get this low".
 * Manual users get the exact same formula the app uses. */
export function estimateTargetKcal(p: TargetInputs, offsetKcal: number): number {
  const bmr = Math.round(10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'm' ? 5 : -161));
  const burn = p.connected
    ? Math.round(bmr * 1.15)
    : Math.round(bmr * (ACTIVITY_MULT[p.activity] ?? ACTIVITY_MULT[2]));
  return burn + offsetKcal;
}
