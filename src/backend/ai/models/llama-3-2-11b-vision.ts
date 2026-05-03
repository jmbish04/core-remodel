/**
 * @fileoverview Llama 3.2 11B Vision Instruct model descriptor.
 *
 * This is the primary vision model on Workers AI. It accepts multimodal
 * messages (text + image_url) and returns text analysis of visual content.
 *
 * Model ID: @cf/meta/llama-3.2-11b-vision-instruct
 */

import { z } from "zod";

import { defineModel, readTextResponse } from "./_define";

// ---------------------------------------------------------------------------
// Input schema — multimodal messages with image_url content parts
// ---------------------------------------------------------------------------

const ContentPart = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(), // data:image/...;base64,... or https://...
    }),
  }),
]);

const VisionMessage = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(ContentPart)]),
});

export const Llama32VisionInput = z.object({
  messages: z.array(VisionMessage).min(1),
  max_tokens: z.number().int().positive().max(4096).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const Llama32VisionOutput = z.object({ response: z.string() });

// ---------------------------------------------------------------------------
// Model descriptor
// ---------------------------------------------------------------------------

export const llama_3_2_11b_vision = defineModel({
  id: "@cf/meta/llama-3.2-11b-vision-instruct",
  capabilities: ["vision", "chat"],
  input: Llama32VisionInput,
  output: Llama32VisionOutput,

  serialize: (input) => ({
    messages: input.messages,
    max_tokens: input.max_tokens ?? 2048,
    temperature: input.temperature,
  }),

  parseResponse: (raw) => Llama32VisionOutput.parse(readTextResponse(raw)),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type Llama32VisionInput = z.infer<typeof Llama32VisionInput>;
export type Llama32VisionOutput = z.infer<typeof Llama32VisionOutput>;
