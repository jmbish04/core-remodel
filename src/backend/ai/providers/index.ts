/**
 * @fileoverview AI provider facade — exposes centralized methods for
 * structured output generation, chat, and streaming.
 *
 * All methods resolve the model from the environment-based registry
 * and route through the active provider (currently Workers AI only).
 */

import type { z } from "zod";

import { zodToJsonSchema } from "zod-to-json-schema";

import type { GptOssMessage } from "../models/gpt-oss-120b";
import type { AIProvider } from "./base";

import { getModelRegistry } from "../models";
import { WorkersAIProvider } from "./workers-ai";
import { createGeminiClient } from "@backend/services/render/providers/gemini-stage-provider";

// Re-export the shared message type for consumers
export type { GptOssMessage as ChatMessage } from "../models/gpt-oss-120b";

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function getProvider(env: Env, name: "workers-ai" = "workers-ai"): AIProvider {
  switch (name) {
    case "workers-ai":
      return new WorkersAIProvider(env);
  }
}

// ---------------------------------------------------------------------------
// generateStructuredOutput — structured JSON output via json_schema
// ---------------------------------------------------------------------------

/**
 * Generate a structured output object that conforms to the given Zod schema.
 *
 * Uses `response_format: { type: "json_schema" }` to instruct the model
 * (gpt-oss-120b) to return valid JSON matching the schema.  The response
 * is parsed and validated against the schema directly — no regex stripping.
 *
 * @param env      Worker environment bindings
 * @param opts     Messages, Zod schema, and optional generation params
 * @returns        Parsed and validated output matching TSchema
 */
export async function generateStructuredOutput<TSchema extends z.ZodTypeAny>(
  env: Env,
  opts: {
    messages: GptOssMessage[];
    schema: TSchema;
    schemaName?: string;
    temperature?: number;
    max_tokens?: number;
    cacheTtl?: number;
  },
): Promise<z.infer<TSchema>> {
  const provider = getProvider(env);
  const model = getModelRegistry(env).extract;

  try {
    const raw = await provider.invokeStructured(
      model,
      {
        messages: opts.messages,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.max_tokens,
        response_format: {
          type: "json_schema" as const,
          json_schema: zodToJsonSchema(opts.schema as never, opts.schemaName ?? "Schema"),
        },
      },
      { cacheTtl: opts.cacheTtl },
    );

    return opts.schema.parse(raw);
  } catch (workersAiErr) {
    // Workers AI structured output has proven unreliable in prod — the
    // kimi extract path returns empty/unparseable content, which surfaces here
    // as a throw and silently zeroed every downstream extraction. Rather than
    // let that kill the caller, fall back to Gemini, which does structured
    // output (responseSchema) reliably. The model + schema are identical in
    // intent; only the runtime differs.
    console.error(
      `[structured] Workers AI (${model.id}) failed — falling back to Gemini:`,
      workersAiErr,
    );
    try {
      return await structuredViaGemini(env, opts);
    } catch (geminiErr) {
      console.error("[structured] Gemini fallback ALSO failed:", geminiErr);
      // Surface the ORIGINAL primary-path error — it is the root failure and
      // what callers/tests expect to see.
      throw workersAiErr;
    }
  }
}

/**
 * Gemini structured-output fallback. Direct Google API (not AI Gateway — that
 * path 401s), logged to `gemini_usage_log` under "structured_fallback".
 *
 * The Zod schema is reused verbatim via `responseSchema`; a small sanitiser
 * strips the JSON-Schema keys Gemini's schema validator rejects.
 */
async function structuredViaGemini<TSchema extends z.ZodTypeAny>(
  env: Env,
  opts: {
    messages: GptOssMessage[];
    schema: TSchema;
    schemaName?: string;
    temperature?: number;
    max_tokens?: number;
  },
): Promise<z.infer<TSchema>> {
  const ai = await createGeminiClient(env, "structured_fallback");

  // Gemini separates the system instruction from the turn contents, and uses
  // "model" where the chat API uses "assistant".
  const system = opts.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(
        zodToJsonSchema(opts.schema as never, { $refStrategy: "none" }),
      ),
      temperature: opts.temperature ?? 0,
      // Honour an explicit cap for parity with the Workers AI path, but only
      // when the caller set one — passing undefined (the common case) lets
      // Gemini use its own generous default, so its thinking tokens are never
      // squeezed by an artificially tight limit.
      ...(opts.max_tokens ? { maxOutputTokens: opts.max_tokens } : {}),
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini structured fallback returned empty text");
  return opts.schema.parse(JSON.parse(text)) as z.infer<TSchema>;
}

/**
 * Strip the JSON-Schema keys Gemini's `responseSchema` rejects
 * (`$schema`, `additionalProperties`, `$ref`/`definitions`, `default`, `$id`).
 * `$refStrategy: "none"` already inlines refs, so this only prunes leftovers.
 */
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (["$schema", "additionalProperties", "$ref", "definitions", "default", "$id"].includes(k)) {
        continue;
      }
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return node;
}

// ---------------------------------------------------------------------------
// streamChat — streaming SSE for frontend chat UI
// ---------------------------------------------------------------------------

/**
 * Stream chat tokens from the model as a ReadableStream<Uint8Array>.
 *
 * Returns raw SSE from Workers AI — callers can pipe this to the frontend
 * or wrap it in an SSE-formatted stream via `toSseStream()`.
 *
 * @param env      Worker environment bindings
 * @param opts     Chat messages and optional generation params
 * @returns        ReadableStream of raw model output chunks
 */
export async function streamChat(
  env: Env,
  opts: {
    messages: GptOssMessage[];
    temperature?: number;
    max_tokens?: number;
    cacheTtl?: number;
  },
): Promise<ReadableStream<Uint8Array>> {
  const provider = getProvider(env);
  const model = getModelRegistry(env).chat;

  return provider.streamModel(
    model,
    {
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens,
    },
    { cacheTtl: opts.cacheTtl },
  );
}
