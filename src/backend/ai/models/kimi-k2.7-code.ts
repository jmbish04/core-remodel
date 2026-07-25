/**
 * @fileoverview Kimi K2.7-Code — the structured-extraction model.
 *
 * WHY A SEPARATE MODULE FROM kimi-k2.6. Behaviourally they are NOT
 * interchangeable despite sharing the Kimi Messages API. k2.6 spends its entire
 * token budget on the reasoning channel and returns `content: ""` with
 * `finish_reason: "length"` — which downstream normalizers turn into all-null
 * extractions, the silent defect that persisted empty product-research rows for
 * months. Measured 2026-07-19 on an identical structured-output prompt:
 *   kimi-k2.6       ~59s  content:"" — unusable
 *   kimi-k2.7-code  ~10s  valid JSON, finish_reason "stop", 3/3 identical
 * `src/backend/services/brand-reconcile.ts` and `structured-output.ts` already
 * pin this model for the same reason.
 *
 * Same Messages-API request/response shape as k2.6, so the input/output schemas
 * are reused. `serialize` keeps `thinking` disabled and `max_tokens` generous
 * (4096): k2.7-code also carries a reasoning channel and returns empty content
 * when the budget is tight, so a tight cap reintroduces the exact failure.
 */

import { defineModel, readTextResponse } from "./_define";
import { KimiK26Input, KimiK26Output } from "./kimi-k2.6";

export const kimi_k2_7_code = defineModel({
  id: "@cf/moonshotai/kimi-k2.7-code",
  capabilities: ["chat", "json-mode", "streaming"],
  input: KimiK26Input,
  output: KimiK26Output,

  serialize: (input) => {
    const body: Record<string, unknown> = {
      messages: input.messages,
      max_tokens: input.max_tokens ?? 4096,
    };

    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.top_p !== undefined) body.top_p = input.top_p;
    if (input.seed !== undefined) body.seed = input.seed;
    if (input.frequency_penalty !== undefined) body.frequency_penalty = input.frequency_penalty;
    if (input.presence_penalty !== undefined) body.presence_penalty = input.presence_penalty;
    if (input.response_format !== undefined) body.response_format = input.response_format;

    // Reasoning off for structured extraction — json_schema already constrains
    // the output, and the reasoning channel is what starved content on k2.6.
    body.chat_template_kwargs = input.chat_template_kwargs ?? { thinking: false };

    return body;
  },

  parseResponse: (raw) => KimiK26Output.parse(readTextResponse(raw)),
});
