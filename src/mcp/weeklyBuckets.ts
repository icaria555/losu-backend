/**
 * Backend port of frontend/src/state/weeklyBuckets.ts — same ISO-week
 * bucketing so numbers the chat assistant reports match the Progress chart
 * exactly. Keep both copies in sync if the algorithm ever changes.
 */

interface SetLike {
  weightKg: number;
  reps: number;
  completedAt: Date;
}

/** ISO week key (Monday-start), e.g. "2026-W34". */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Top set (heaviest weightKg) per ISO week, most recent `weeks` buckets that
 * actually have data, oldest first. */
export function weeklyTopSets(sets: SetLike[], weeks = 6): number[] {
  const byWeek = new Map<string, number>();
  for (const s of sets) {
    const key = isoWeekKey(s.completedAt);
    byWeek.set(key, Math.max(byWeek.get(key) ?? 0, s.weightKg));
  }
  const orderedKeys = [...byWeek.keys()].sort();
  const recent = orderedKeys.slice(-weeks);
  return recent.map((k) => byWeek.get(k)!);
}

/** Sum of weightKg × reps per ISO week — moves during a rep-climbing
 * double-progression week even when the top set alone reads flat. */
export function weeklyVolume(sets: SetLike[], weeks = 6): number[] {
  const byWeek = new Map<string, number>();
  for (const s of sets) {
    const key = isoWeekKey(s.completedAt);
    byWeek.set(key, (byWeek.get(key) ?? 0) + s.weightKg * s.reps);
  }
  const orderedKeys = [...byWeek.keys()].sort();
  const recent = orderedKeys.slice(-weeks);
  return recent.map((k) => Math.round(byWeek.get(k)!));
}
