import type { PrismaClient } from '@prisma/client';

// UI language the user picked in the app (Profile.language). Read server-side
// rather than trusted from the request body; null/unknown falls back to
// English. Mirrored by frontend/src/i18n (no shared package).
export type Lang = 'en' | 'th';

export async function userLanguage(prisma: PrismaClient, userId: string): Promise<Lang> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { language: true } });
  return profile?.language === 'th' ? 'th' : 'en';
}

/** Appended to the chat system instruction. Tool arguments must stay the
 * English catalog names in any language — they're matched against
 * muscleGroups.ts, and a translated name silently loses its muscle tag. */
export function chatLanguageInstruction(lang: Lang): string {
  if (lang !== 'th') return '';
  return `

The user's app is set to Thai. Reply in natural, casual Thai (the user may still write in English or mix
both — reply in Thai regardless). Meal names you log may be in Thai. BUT exercise names passed to tools
(log_set, update_routine, get_progress) must always be the exact English names from Tally's catalog (e.g.
"Bench press", "Lat pulldown") even when the user writes them in Thai — and keep those English names as-is
when you mention them in your Thai reply, since that's what Thai gyms call them.`;
}

/** Appended to the meal-estimate instruction: which language to name items in. */
export function estimateLanguageInstruction(lang: Lang): string {
  return lang === 'th'
    ? '\nName each item in Thai (e.g. "ข้าวสวย", "ไข่เจียว"), whatever language the note is written in.'
    : '\nName each item in English, whatever language the note is written in.';
}
