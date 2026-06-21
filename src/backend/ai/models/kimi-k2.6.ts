/**
 * @fileoverview Kimi K2.6 model module for Cloudflare Workers AI.
 *
 * Moonshot AI's frontier MoE model (1T total / 32B active params).
 * Capabilities: chat, structured output (json_schema), streaming, tool use, vision.
 * Context window: 262,144 tokens.
 *
 * Schema sources:
 *   Sync input:  https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/sync-input.json
 *   Sync output: https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/sync-output.json
 */

import { z } from "zod";

import { defineModel, readTextResponse } from "./_define";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export const KimiK26Message = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});

// ---------------------------------------------------------------------------
// Messages API input (multi-turn chat, structured output, tool use)
// ---------------------------------------------------------------------------

export const KimiK26Input = z.object({
  messages: z.array(KimiK26Message).min(1),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  response_format: z
    .object({
      type: z.enum(["json_object", "json_schema"]),
      json_schema: z.unknown(),
    })
    .optional(),
  chat_template_kwargs: z
    .object({
      thinking: z.boolean().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Output schema — OpenAI-compatible choices format
// ---------------------------------------------------------------------------

export const KimiK26Output = z.object({ response: z.string() });

// ---------------------------------------------------------------------------
// Model descriptor
// ---------------------------------------------------------------------------

export const kimi_k2_6 = defineModel({
  id: "@cf/moonshotai/kimi-k2.6",
  capabilities: ["chat", "json-mode", "streaming"],
  input: KimiK26Input,
  output: KimiK26Output,

  serialize: (input) => {
    const body: Record<string, unknown> = {
      messages: input.messages,
      max_tokens: input.max_tokens ?? 4096,
    };

    // Only include optional params if they were explicitly set
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.top_p !== undefined) body.top_p = input.top_p;
    if (input.seed !== undefined) body.seed = input.seed;
    if (input.frequency_penalty !== undefined) body.frequency_penalty = input.frequency_penalty;
    if (input.presence_penalty !== undefined) body.presence_penalty = input.presence_penalty;
    if (input.response_format !== undefined) body.response_format = input.response_format;

    // Disable thinking by default for structured extraction — reasoning traces
    // add latency and aren't needed when json_schema constrains the output.
    body.chat_template_kwargs = input.chat_template_kwargs ?? { thinking: false };

    return body;
  },

  parseResponse: (raw) => KimiK26Output.parse(readTextResponse(raw)),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type KimiK26Input = z.infer<typeof KimiK26Input>;
export type KimiK26Output = z.infer<typeof KimiK26Output>;
export type KimiK26Message = z.infer<typeof KimiK26Message>;
