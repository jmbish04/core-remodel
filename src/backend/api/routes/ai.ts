/**
 * @fileoverview AI API routes for Workers AI integration via AI Gateway.
 *
 * Includes T6.1 (feature 0005) helper routes:
 *   POST /api/ai/improve-description — tighten a description (✨ button)
 *
 * The other T6.1 routes live beside their resources:
 *   POST /api/supporting-documents/:id/room-summary  → supporting-documents.ts
 *   POST /api/rooms/code/:roomCode/options-summary   → rooms.ts
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { Variables } from "../index";

import { authMiddleware } from "../middleware/auth";

const aiRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware
aiRouter.use("*", authMiddleware);

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    }),
  ),
  model: z.string().optional(),
});

const speechToTextSchema = z.object({
  audio: z.string(), // base64 encoded audio
});

const textToSpeechSchema = z.object({
  text: z.string(),
  voice: z.string().optional(),
});

// POST /api/ai/chat
aiRouter.post("/chat", zValidator("json", chatSchema), async (c) => {
  const { messages, model = "@cf/meta/llama-3.2-3b-instruct" } = c.req.valid("json");

  try {
    const response = await c.env.AI.run(model, {
      messages,
      stream: false,
    });

    return c.json(response);
  } catch (error) {
    console.error("AI chat error:", error);
    return c.json({ error: "AI chat failed" }, 500);
  }
});

// POST /api/ai/chat/stream
aiRouter.post("/chat/stream", zValidator("json", chatSchema), async (c) => {
  const { messages, model = "@cf/meta/llama-3.2-3b-instruct" } = c.req.valid("json");

  try {
    const stream = await c.env.AI.run(model, {
      messages,
      stream: true,
    });

    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("AI chat stream error:", error);
    return c.json({ error: "AI chat stream failed" }, 500);
  }
});

// POST /api/ai/speech-to-text
aiRouter.post("/speech-to-text", zValidator("json", speechToTextSchema), async (c) => {
  const { audio } = c.req.valid("json");

  try {
    // Decode base64 audio
    const audioBuffer = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));

    const response = await c.env.AI.run("@cf/openai/whisper", {
      audio: Array.from(audioBuffer),
    });

    return c.json(response);
  } catch (error) {
    console.error("Speech-to-text error:", error);
    return c.json({ error: "Speech-to-text failed" }, 500);
  }
});

// POST /api/ai/text-to-speech
aiRouter.post("/text-to-speech", zValidator("json", textToSpeechSchema), async (c) => {
  const { text, voice = "alloy" } = c.req.valid("json");

  try {
    const response = await c.env.AI.run("@cf/deepgram/aura-1", {
      text,
      voice,
    });

    // Return audio as base64
    if (response instanceof ReadableStream) {
      const reader = response.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const audioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        audioData.set(chunk, offset);
        offset += chunk.length;
      }

      const base64Audio = btoa(String.fromCharCode(...audioData));
      return c.json({ audio: base64Audio });
    }

    return c.json(response);
  } catch (error) {
    console.error("Text-to-speech error:", error);
    return c.json({ error: "Text-to-speech failed" }, 500);
  }
});

// NOTE: T6.1 POST /api/ai/improve-description was MOVED to the public,
// browser-reachable supporting-documents router (this aiRouter is Bearer-gated
// for server-to-server use; the browser only holds the access cookie).
// See supporting-documents.ts → POST /api/supporting-documents/improve-description.

// POST /api/ai/embeddings
aiRouter.post(
  "/embeddings",
  zValidator("json", z.object({ text: z.string().min(1) })),
  async (c) => {
    const { text } = await c.req.json();

    try {
      const response = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text,
      });

      return c.json(response);
    } catch (error) {
      console.error("Embeddings error:", error);
      return c.json({ error: "Embeddings generation failed" }, 500);
    }
  },
);

export { aiRouter };
