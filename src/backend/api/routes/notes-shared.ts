/**
 * @fileoverview Shared note-editor utilities — `/api/notes`
 *
 * Mounted at `/api/notes` (see src/backend/api/index.ts), gated end-to-end by
 * `requireAccessAuth` — powers the full-page note editor (showroom store
 * notes + company CRM notes) with a shared AI-assist utility.
 *
 *   POST /api/notes/generate-title   Generate a concise note title via Workers AI
 *
 * Conventions:
 *   - Hand-written Zod v4 schemas (drizzle-zod is banned — breaks pnpm run build).
 *   - No DB access here — this router is pure Workers-AI orchestration.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const notesSharedRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Shared error envelope ────────────────────────────────────────────────────

const errorSchema = z.object({
  error: z.string(),
});

// ════════════════════════════════════════════════════════════════════════════
// POST /generate-title
// ════════════════════════════════════════════════════════════════════════════

/** Same model used by the Gmail draft-assist endpoint (gmail.ts DRAFT_ASSIST_MODEL). */
const GENERATE_TITLE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-loftq";

/** Server-side hard cap on the content sent to the model. */
const GENERATE_TITLE_CONTENT_MAX_CHARS = 8000;

/** Hard cap on the returned title after trim/strip, regardless of model output. */
const GENERATE_TITLE_MAX_CHARS = 80;

/** Soft target communicated to the model — titles should stay well under this. */
const GENERATE_TITLE_TARGET_MAX_CHARS = 60;

const generateTitleBodySchema = z.object({
  /** Plain text or markdown of the note document. Capped server-side. */
  content: z.string().min(1),
  /** Optional extra context (e.g. company name, showroom name) to ground the title. */
  context: z.string().optional(),
});

/** Strip a single layer of matching surrounding quotes ("..." or '...'). */
function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/** Strip trailing punctuation (periods, commas, semicolons, colons) from a title. */
function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:]+$/, "").trim();
}

notesSharedRouter.openapi(
  createRoute({
    method: "post",
    path: "/generate-title",
    operationId: "generateNoteTitle",
    tags: ["Notes"],
    summary: "Generate a concise note title from document content via Workers AI",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: generateTitleBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Title generated",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), title: z.string() }),
          },
        },
      },
      400: {
        description: "Empty or invalid content",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { content, context } = c.req.valid("json");

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return c.json({ error: "content is required" }, 400);
    }

    const cappedContent = trimmedContent.slice(0, GENERATE_TITLE_CONTENT_MAX_CHARS);

    try {
      const userContent = `Document content:\n${cappedContent}${
        context ? `\n\nAdditional context: ${context}` : ""
      }`;

      const systemPrompt = `You generate a concise, specific title for a note document. Requirements:
- At most ${GENERATE_TITLE_TARGET_MAX_CHARS} characters.
- No surrounding quotes.
- No trailing punctuation (periods, commas, semicolons, colons).
- Specific to the document content — never generic ("Untitled Note", "New Note", etc).
- Return ONLY the title text. No explanation, no markdown, no labels.`;

      const raw = (await c.env.AI.run(GENERATE_TITLE_MODEL as Parameters<typeof c.env.AI.run>[0], {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 64,
        gateway: { id: c.env.AI_GATEWAY_ID },
      } as Parameters<typeof c.env.AI.run>[1])) as { response?: string };

      let title = (raw?.response ?? "").trim();
      title = stripSurroundingQuotes(title);
      title = stripTrailingPunctuation(title);
      title = title.slice(0, GENERATE_TITLE_MAX_CHARS).trim();

      if (!title) throw new Error("Workers AI returned an empty title");

      return c.json({ success: true as const, title }, 200);
    } catch (err) {
      console.error("[notes-shared] POST /generate-title error:", err);
      return c.json({ error: "Failed to generate title" }, 500);
    }
  },
);
