import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GoogleGenAI, mcpToTool } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { authenticate } from '../middleware/auth';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1),
});

// A resized/compressed photo (see the frontend's use of expo-image-manipulator
// before this ever reaches the wire) — base64-encoded. Capped per-image well
// under the shared express.json({ limit: '10mb' }) body limit divided by
// MAX_IMAGES, as a sanity backstop on top of the client-side resize (a real
// 1024px/quality-0.7 JPEG lands nowhere near this).
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_LENGTH = 2_000_000; // ~1.5MB decoded, per image
const imageSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().max(MAX_IMAGE_BASE64_LENGTH),
});

// Stateless: the client resends the whole conversation each turn (the newest
// user message last) and we don't persist it server-side — same pattern as
// a plain chat-completions call, no new DB table needed for v1. `images` are
// only ever attached to the current turn — the client deliberately doesn't
// resend a photo's bytes on every later turn once it's been seen once (see
// ChatContext.tsx), so this is never expected on an earlier history entry.
const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  images: z.array(imageSchema).max(MAX_IMAGES).optional(),
});

const SYSTEM_INSTRUCTION = `You are Tally's in-app assistant, embedded in a calorie and workout tracking app.
You can act on the user's behalf via tools: log a meal, log a workout set, log body weight, set the workout
routine, edit or delete a previously logged meal, and read back their progress (lifting trend per exercise, or
an overview of every exercise; recent nutrition averages; current profile). Always use a tool rather than just
saying you logged something. Confirm briefly what you logged (name/exercise, numbers) after a write. Keep
replies short and conversational — this is a small chat bubble, not a report. If the user asks about something
Tally doesn't track (e.g. a historical body-weight trend — only the current weight is stored), say so plainly
instead of guessing. The user can attach one or more photos (e.g. a plate of food, or a plate plus its nutrition
label, or a couple of angles of the same meal) — when photos are included, look at all of them together as
context for the same message and estimate calories/macros the same way you'd reason from a text description,
then log it the same way if they ask you to. Treat multiple photos as one combined meal/context unless the
user's text says they're separate things.

If the user corrects or adds detail about a meal after you've already logged it ("actually it was two
servings", "that's wrong, it didn't have rice") — don't log a second entry. Call update_meal on the one you
already logged, re-estimating the macros yourself from the new detail. If they instead want it gone entirely
("delete that", "remove the one you just logged"), call delete_meal. Both need the meal's id: you already have
it if you called log_meal earlier in this same reply, otherwise call get_progress and match the meal by
name/time in nutrition.recentMeals. If you can't confidently tell which meal they mean, ask rather than
guessing — deleting or editing the wrong one is worse than a clarifying question.

When asked what to train next (or when it's naturally relevant), call get_progress with no exercise named —
it returns every logged exercise's muscle group and completedAt. Use the dates to see which muscle groups
were trained today/recently and suggest a different one for balance (e.g. a heavy leg day today points
toward chest/back/arms next), the way a training partner would. Only exercises from Tally's known catalog
carry a muscle group (others come back null) — don't guess a muscle group yourself for those.

When asked to recommend, build, or update a routine, use the same signals (goal from get_progress's profile,
recent muscle-group balance) to propose a concrete one — name and exercise list — in your reply first. Only
call update_routine once the user has actually agreed to that specific routine ("yes", "use that", "set it
up"); it replaces the whole routine rather than adding to it, so don't call it on a first ask or an ambiguous
reply the way you would log_meal.`;

router.post(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!config.geminiApiKey) {
      res.status(503).json({ error: 'Chat is not configured yet' });
      return;
    }

    let mcpClient: Client | undefined;
    try {
      const { messages, images } = chatRequestSchema.parse(req.body);
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role !== 'user') {
        res.status(400).json({ error: 'The last message must be from the user' });
        return;
      }

      // Reuses the same access token the request itself was authenticated
      // with, so the MCP server's bearer auth resolves to this same user —
      // every tool call the model makes is scoped to them.
      mcpClient = new Client({ name: 'tally-chat', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${config.port}/mcp`),
        { requestInit: { headers: { Authorization: req.headers.authorization! } } },
      );
      await mcpClient.connect(transport);

      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.text }],
      }));

      const chat = ai.chats.create({
        model: config.geminiModel,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [mcpToTool(mcpClient)],
        },
        history,
      });

      const message = images?.length
        ? [
          { text: lastMessage.text },
          ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
        ]
        : lastMessage.text;
      const response = await chat.sendMessage({ message });
      res.json({ reply: response.text ?? '' });
    } catch (error) {
      logger.error('Chat request failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      next(error);
    } finally {
      await mcpClient?.close();
    }
  },
);

export default router;
