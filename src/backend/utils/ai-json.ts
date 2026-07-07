/**
 * @fileoverview Helper for reading Workers-AI `json_schema` structured output.
 *
 * `env.AI.run(model, { response_format: { type: "json_schema", ... } })`
 * returns the structured payload on `result.response`, but the runtime shape is
 * NOT uniform across models/gateways:
 *   - some models return `.response` as an already-parsed object;
 *   - others (notably kimi routed through the AI Gateway) return `.response`
 *     as a JSON **string**.
 *
 * Naively doing `typeof wrapped === "object" ? wrapped : raw` silently breaks
 * the string case: it falls through to the raw `{ response: "<json>" }`
 * wrapper, so the downstream normalizer sees none of the expected keys and
 * every extracted field comes back null. This helper handles both shapes (and
 * a defensive fenced-```json``` strip) so callers get the parsed object.
 */

/**
 * Extract the parsed structured object from a Workers-AI json_schema result.
 *
 * @param raw    The value returned by `env.AI.run` (`{ response?: unknown }`
 *               possibly already spread with the payload's own keys).
 * @param label  Short label for error logging (e.g. "brand structured insight").
 * @returns The parsed object as `Partial<T>`. Falls back to `raw` (minus the
 *          `response` wrapper is not possible, so `raw` itself) only when
 *          `.response` is absent — never returns null so callers can rely on an
 *          object and let their own field-level normalization drop bad values.
 */
export function parseStructuredResponse<T>(
  raw: ({ response?: unknown } & Partial<T>) | null | undefined,
  label: string,
): Partial<T> {
  const wrapped = raw?.response;

  if (typeof wrapped === "string") {
    const text = stripJsonFence(wrapped);
    try {
      return JSON.parse(text) as Partial<T>;
    } catch (err) {
      console.error(`[ai-json] failed to parse ${label} JSON string:`, err);
      return {};
    }
  }

  if (wrapped && typeof wrapped === "object") {
    return wrapped as Partial<T>;
  }

  // No `.response` wrapper — some models spread the payload onto the result
  // directly, so treat the whole object as the source.
  return (raw ?? {}) as Partial<T>;
}

/**
 * Strip a leading/trailing Markdown ```json fence (and stray ``` fences) some
 * models wrap around JSON even under json_schema, and trim to the outermost
 * brace pair so leading prose never defeats `JSON.parse`.
 */
function stripJsonFence(text: string): string {
  let t = text.trim();
  // Remove a leading ```json / ``` fence and any trailing ``` fence.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // If there is still surrounding prose, keep the outermost {...} span.
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return t.slice(first, last + 1);
  }
  return t;
}
