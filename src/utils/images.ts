import { z } from 'zod';

// A resized/compressed photo (the frontend runs it through
// expo-image-manipulator — see frontend/src/utils/pickImages.ts — before it
// ever reaches the wire), base64-encoded. Capped per-image well under the
// shared express.json({ limit: '10mb' }) body limit divided by MAX_IMAGES, as
// a sanity backstop on top of the client-side resize (a real
// 1024px/quality-0.7 JPEG lands nowhere near this). Shared by /chat and
// /meals/estimate.
export const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_LENGTH = 2_000_000; // ~1.5MB decoded, per image

export const imageSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().max(MAX_IMAGE_BASE64_LENGTH),
});
