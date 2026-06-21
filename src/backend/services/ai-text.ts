/**
 * @fileoverview AI text helpers backed by Workers AI (env.AI).
 *
 * Provides three capabilities used by the room-viewport feature (0005):
 *   - improveDescription   — tightens a user-supplied description (supporting-doc ✨ button)
 *   - summarizeDocumentForRoom — 1-2 sentence room-tailored relevance summary (AI column in
 *                               the supporting materials table); result is cached in
 *                               `supporting_documents.aiRationale` by the calling route.
 *   - summarizeRoomOptions — simplified plain-language summary of raw room option/deviation
 *                            content (Room Options "AI Quick Summary" tab).
 *
 * Model: @cf/meta/llama-3.3-70b-instruct-fp8-fast
 * Prompt construction: ES6 template literals with real newlines — NEVER .join('\n').
 *
 * All functions accept `env` as the first argument so the caller can pass `c.env`
 * without any module-level state that would leak across requests.
 */

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

/** Maximum tokens the model should generate per call. */
const MAX_TOKENS = 512;

/**
 * Truncate a string to a maximum character length to keep prompts within
 * model context limits. Adds ellipsis when truncated.
 */
function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}…`;
}

/**
 * Extract the text response from a Workers AI result.
 * Workers AI returns `{ response: string }` for text-generation models.
 */
function extractResponse(raw: unknown): string {
  if (raw && typeof raw === "object" && "response" in raw) {
    const r = (raw as Record<string, unknown>).response;
    return typeof r === "string" ? r.trim() : "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Improves a user-supplied description using Workers AI.
 *
 * Used by the supporting-documents upload intake form when the user clicks
 * the ✨ ("improve description") button. The AI returns a tighter, more
 * professional version that the user must explicitly approve before it
 * overwrites their original text.
 *
 * @param env      - Cloudflare Worker env (provides env.AI binding)
 * @param text     - The raw description text to improve (max 3 000 chars)
 * @param context  - Optional surrounding context (e.g. document title, room name)
 * @returns        Improved description string, or original text on failure
 */
export async function improveDescription(
  env: Env,
  text: string,
  context?: string,
): Promise<string> {
  const trimmedText = cap(text.trim(), 3_000);
  const contextLine = context ? `\nContext: ${cap(context.trim(), 200)}` : "";

  const systemPrompt = `You are a professional remodel project manager helping a homeowner write clear, concise document descriptions.
Your task: rewrite the provided description to be more professional, specific, and useful.
Rules:
- Keep it under 3 sentences.
- Preserve all factual details.
- Do not add information that isn't implied by the original.
- Return ONLY the improved description text, no preamble or explanation.`;

  const userPrompt = `Improve this document description:
"${trimmedText}"${contextLine}`;

  try {
    const raw = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
    } as Parameters<typeof env.AI.run>[1]);

    const improved = extractResponse(raw);
    return improved.length > 0 ? improved : text;
  } catch {
    // Non-fatal: return original text so the UI can still function.
    return text;
  }
}

/**
 * Generates a 1-2 sentence room-specific relevance summary for a supporting document.
 *
 * Used by the Room Viewport supporting-materials table AI summary column.
 * The result should be cached by the caller into `supporting_documents.aiRationale`.
 *
 * @param env  - Cloudflare Worker env
 * @param doc  - Document metadata to summarize
 * @param room - Room context for tailoring the summary
 * @returns    Summary string, or empty string on failure
 */
export async function summarizeDocumentForRoom(
  env: Env,
  doc: {
    title: string;
    description?: string | null;
    sourceType: string;
    externalUrl?: string | null;
  },
  room: {
    roomName: string;
    roomCode: string;
  },
): Promise<string> {
  const titleText = cap(doc.title.trim(), 200);
  const descriptionText = doc.description ? cap(doc.description.trim(), 800) : "";
  const descriptionLine = descriptionText ? `\nDescription: ${descriptionText}` : "";
  const urlLine = doc.externalUrl ? `\nSource URL: ${cap(doc.externalUrl.trim(), 150)}` : "";

  const systemPrompt = `You are a remodel project assistant helping homeowners understand how their saved documents relate to specific rooms.
Write a 1-2 sentence summary explaining how this document is relevant to the named room.
Return ONLY the summary text. No preamble. No bullet points.`;

  const userPrompt = `Document title: ${titleText}
Document type: ${doc.sourceType}${descriptionLine}${urlLine}

Room: ${room.roomName} (${room.roomCode})

Write a brief summary of how this document applies to the ${room.roomName}.`;

  try {
    const raw = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
    } as Parameters<typeof env.AI.run>[1]);

    return extractResponse(raw);
  } catch {
    return "";
  }
}

/**
 * Generates a plain-language "quick summary" of raw room option / deviation content.
 *
 * Used by the Room Options section in the Room Viewport when deviations exist.
 * Tab 2 ("AI Quick Summary") shows this result. The raw content comes from
 * `scenario_room_plans` + vision nodes already in the room detail payload.
 *
 * @param env        - Cloudflare Worker env
 * @param rawOptions - Raw text of the room's options/deviations to summarize
 * @param roomName   - Name of the room for context
 * @returns          Summary string, or empty string on failure
 */
export async function summarizeRoomOptions(
  env: Env,
  rawOptions: string,
  roomName?: string,
): Promise<string> {
  const optionsText = cap(rawOptions.trim(), 4_000);
  const roomLine = roomName ? ` for the ${cap(roomName.trim(), 100)}` : "";

  const systemPrompt = `You are a remodel planning assistant helping homeowners quickly understand their renovation options.
Write a concise plain-language summary of the provided room options and design decisions.
Rules:
- 3-5 sentences maximum.
- Use plain language, not technical jargon.
- Highlight the key tradeoffs or decisions the homeowner faces.
- Return ONLY the summary. No headings, no bullet points, no preamble.`;

  const userPrompt = `Here are the current renovation options and notes${roomLine}:

${optionsText}

Summarize these options in plain language for a homeowner.`;

  try {
    const raw = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: MAX_TOKENS,
    } as Parameters<typeof env.AI.run>[1]);

    return extractResponse(raw);
  } catch {
    return "";
  }
}
