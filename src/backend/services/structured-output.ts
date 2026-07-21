/**
 * @fileoverview Structured JSON generation — Gemini first, kimi-k2.7-code fallback.
 *
 * One entry point for "give me typed JSON back", so call sites stop each
 * hand-rolling a provider call and re-learning the same failure modes.
 *
 * PROVIDER ORDER
 *   1. Gemini (`gemini-2.5-flash`) via `createGeminiClient` — DIRECT to Google,
 *      NOT through Cloudflare AI Gateway. The Gemini interactions API is not
 *      gateway-compatible on this account; routing it through the gateway
 *      returned 401 (AiGatewayError 2009) for every call. The shared factory
 *      also logs each call to `gemini_usage_log` under a `feature` label, which
 *      is our own token ledger — so pass a real feature name.
 *   2. `@cf/moonshotai/kimi-k2.7-code` via Workers AI on the gateway. Kimi 2.7
 *      Code natively supports `response_format: json_schema`, so this is a real
 *      structured call, not prompt-and-pray.
 *
 * THE VERSION IS LOAD-BEARING. kimi-k2.6 is NOT a substitute: it spends its
 * whole budget on reasoning and returns `content: ""` with finish_reason
 * "length" (~59s for nothing). That is what silently produced all-null
 * extractions for months. Measured 2026-07-19:
 *   kimi-k2.6       ~59s  unusable
 *   kimi-k2.7-code  ~10s  valid JSON, 3/3 identical across repeat runs
 *   gemini-2.5-flash      primary; separate quota from Workers AI, which is the
 *                         main reason it is worth having both
 *
 * WHY A FALLBACK AT ALL: the two run on different providers and quotas, so a
 * Workers AI rate-limit (error 3040 under batch load) or a Gemini outage takes
 * out one path, not the feature.
 *
 * An empty response is treated as FAILURE, never as an empty result. Both
 * models carry a reasoning channel and will return empty content when the token
 * budget is tight; degrading that to `{}` is precisely how the null-extraction
 * bug hid.
 */

import { createGeminiClient } from "@backend/services/render/providers/gemini-stage-provider";
import { parseStructuredResponse, stripJsonFence } from "@backend/utils/ai-json";

/** Default Gemini model — fast, cheap, and the one already used for extraction. */
const GEMINI_MODEL = "gemini-2.5-flash";

/** Fallback. See the version warning above. */
const KIMI_MODEL = "@cf/moonshotai/kimi-k2.7-code" as const;

const DEFAULT_MAX_TOKENS = 4096;

/** Minimal JSON-Schema subset both providers understand once converted. */
export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: readonly string[];
  enum?: readonly string[];
  description?: string;
  additionalProperties?: boolean;
  nullable?: boolean;
}

export interface StructuredOptions {
  /**
   * Cost-attribution label written to `gemini_usage_log` (e.g.
   * "brand_reconcile"). Required — an unlabelled call is invisible in the
   * ledger.
   */
  feature: string;
  prompt: string;
  schema: JsonSchemaNode;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Skip Gemini. Useful when a caller knows the schema trips its converter. */
  skipGemini?: boolean;
}

export interface StructuredResult<T> {
  data: T;
  provider: "gemini" | "kimi";
  /** Populated when the primary failed and the fallback carried the call. */
  primaryError?: string;
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly geminiError?: string,
    readonly kimiError?: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/**
 * Convert a JSON Schema node to Gemini's `responseSchema` dialect.
 *
 * Gemini takes an OpenAPI-3.0 subset, which differs from JSON Schema in ways
 * that silently break a request rather than erroring usefully:
 *   - no type unions. `["string","null"]` must become `{type:"string",
 *     nullable:true}`; sent as-is, the whole call fails.
 *   - `additionalProperties` is not accepted and must be dropped.
 * Everything else passes through.
 */
export function toGeminiSchema(node: JsonSchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (Array.isArray(node.type)) {
    const concrete = node.type.filter((t) => t !== "null");
    out.type = concrete[0] ?? "string";
    if (node.type.includes("null")) out.nullable = true;
  } else if (node.type) {
    out.type = node.type;
  }
  if (node.nullable) out.nullable = true;
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = [...node.enum];

  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (node.items) out.items = toGeminiSchema(node.items);
  // Gemini rejects a `required` naming a property that isn't declared.
  if (node.required?.length) {
    const declared = new Set(Object.keys(node.properties ?? {}));
    const kept = node.required.filter((r) => declared.has(r));
    if (kept.length) out.required = kept;
  }

  return out;
}

async function viaGemini<T>(env: Env, opts: StructuredOptions): Promise<T> {
  const ai = await createGeminiClient(env, opts.feature);
  const prompt = opts.system ? `${opts.system}\n\n${opts.prompt}` : opts.prompt;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(opts.schema),
      temperature: opts.temperature ?? 0,
      maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  });

  const raw = response.text || "";
  if (!raw.trim()) {
    // Empty is a failure, not an empty result — see the file header.
    throw new Error("gemini returned empty text");
  }

  const parsed: unknown = JSON.parse(stripJsonFence(raw));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`gemini returned a non-object: ${typeof parsed}`);
  }
  return parsed as T;
}

async function viaKimi<T>(env: Env, opts: StructuredOptions): Promise<T> {
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.prompt },
  ];

  const raw = (await env.AI.run(
    KIMI_MODEL as Parameters<typeof env.AI.run>[0],
    {
      messages,
      // Kimi 2.7 Code supports json_schema natively, so this constrains
      // decoding rather than merely asking nicely.
      response_format: { type: "json_schema", json_schema: opts.schema },
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? 0,
      gateway: { id: env.AI_GATEWAY_ID },
    } as Parameters<typeof env.AI.run>[1],
  )) as { response?: unknown } & Partial<T>;

  // parseStructuredResponse handles all three envelopes these models use —
  // `.response` as object, `.response` as JSON string, and the OpenAI-style
  // choices[0].message.content — and throws on empty or non-object output.
  return parseStructuredResponse<T>(raw, `${opts.feature} (kimi)`) as T;
}

/**
 * Generate a typed JSON object, falling back across providers.
 *
 * Throws `StructuredOutputError` carrying BOTH provider errors when neither
 * succeeds — a single merged message hides which one actually broke.
 */
export async function generateStructured<T>(
  env: Env,
  opts: StructuredOptions,
): Promise<StructuredResult<T>> {
  let geminiError: string | undefined;

  if (!opts.skipGemini) {
    try {
      return { data: await viaGemini<T>(env, opts), provider: "gemini" };
    } catch (err) {
      geminiError = err instanceof Error ? err.message : String(err);
      console.error(`[structured-output] gemini failed for ${opts.feature}:`, geminiError);
    }
  }

  try {
    return {
      data: await viaKimi<T>(env, opts),
      provider: "kimi",
      primaryError: geminiError,
    };
  } catch (err) {
    const kimiError = err instanceof Error ? err.message : String(err);
    throw new StructuredOutputError(
      `structured output failed for ${opts.feature} on all providers ` +
        `(gemini: ${geminiError ?? "skipped"}; kimi: ${kimiError})`,
      geminiError,
      kimiError,
    );
  }
}
