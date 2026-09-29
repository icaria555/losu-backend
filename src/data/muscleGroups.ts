// Exercise -> muscle group lookup, ported from the frontend's exercise
// catalog (frontend/src/data/library.ts LIBRARY). Kept as a plain mirror
// rather than a shared package — it's a small, rarely-changing lookup
// table, and the two apps have no shared-code setup today. If you add an
// exercise to the frontend catalog, add it here too so get_progress can
// tag it with a muscle group for the chat assistant.

export type Muscle = 'Chest' | 'Back' | 'Legs' | 'Shoulders' | 'Arms' | 'Core';

const CATALOG: Record<Muscle, string[]> = {
  Chest: [
    'Chest press', 'Incline press', 'Incline dumbbell press', 'Bench press', 'Dumbbell press', 'Cable fly',
    'Pec fly', 'Push-up',
  ],
  Back: [
    'Lat pulldown', 'Seated row', 'Dumbbell row', 'Barbell row', 'Assisted pull-up', 'Pull-up',
    'Back extension', 'Dumbbell back extension',
  ],
  Legs: [
    'Leg press', 'Leg extension', 'Leg curl', 'Back squat', 'Romanian deadlift', 'Bulgarian split squat',
    'Calf raise', 'Dumbbell calf raise', 'Glute machine', 'Leg adductor', 'Leg abductor',
  ],
  Shoulders: [
    'Shoulder press', 'Dumbbell shoulder press', 'Overhead press', 'Lateral raise', 'Machine lateral raise',
    'Face pull',
  ],
  Arms: [
    'Triceps pushdown', 'Triceps extension', 'Dumbbell triceps extension', 'Triceps curl', 'Biceps curl',
    'Machine biceps curl', 'Preacher curl', 'Dumbbell preacher curl', 'Dip',
  ],
  Core: [
    'Cable crunch', 'Ab coaster', 'Abdominal crunch', 'Ab machine', 'Torso rotation', 'Hanging leg raise',
    'Plank',
  ],
};

const EXERCISE_TO_MUSCLE: Map<string, Muscle> = new Map(
  (Object.entries(CATALOG) as [Muscle, string[]][]).flatMap(([muscle, names]) => names.map((n) => [n, muscle])),
);

/** Which muscle group an exercise trains, from the catalog above. A
 * user-added exercise outside the catalog resolves to null — callers
 * should omit/skip rather than guess. */
export function muscleFor(exercise: string): Muscle | null {
  return EXERCISE_TO_MUSCLE.get(exercise) ?? null;
}

/** Every catalog exercise name, grouped by muscle in the same order as
 * CATALOG above — used to tell the chat assistant which exercise names are
 * "known" (get a muscle tag, show up correctly in Edit Routine's checklist)
 * versus a free-typed custom name (allowed, but untagged). */
export function catalogByMuscle(): Record<Muscle, string[]> {
  return CATALOG;
}
