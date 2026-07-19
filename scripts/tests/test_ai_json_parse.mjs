// Run: npx tsx scripts/tests/test_ai_json_parse.mjs
//
// Regression guard for the silent-empty-extraction bug: product 35's research
// run persisted a fully null store_product_intel row off a 21 KB report because
// a truncated `.response` string failed JSON.parse and was swallowed into `{}`.
// The caller's normalizer then turned every missing key into null/false/[] and
// the workflow step reported success.
import assert from "node:assert";

const { parseStructuredResponse, stripJsonFence, AiJsonParseError } =
  await import("../../src/backend/utils/ai-json.ts");

// --- .response as an already-parsed object (some models) ---
assert.deepEqual(
  parseStructuredResponse({ response: { aiRetailPrice: "$1,150" } }, "obj"),
  { aiRetailPrice: "$1,150" },
);

// --- .response as a JSON string (kimi via the AI Gateway) ---
assert.deepEqual(
  parseStructuredResponse({ response: '{"aiRetailPrice":"$1,150"}' }, "str"),
  { aiRetailPrice: "$1,150" },
);

// --- fenced JSON some models emit even under json_schema ---
assert.deepEqual(
  parseStructuredResponse(
    { response: '```json\n{"specs":[{"key":"Finish","value":"Brass"}]}\n```' },
    "fenced",
  ),
  { specs: [{ key: "Finish", value: "Brass" }] },
);
assert.equal(stripJsonFence('prose before {"a":1} prose after'), '{"a":1}');

// --- no .response wrapper — payload spread onto the result ---
assert.deepEqual(
  parseStructuredResponse({ caRegulatoryFlag: false }, "bare"),
  { caRegulatoryFlag: false },
);

// --- THE REGRESSION: truncated JSON must throw, never degrade to {} ---
// This is real-shaped output cut off mid-string by an unset max_tokens.
const truncated =
  '{"reviewSummary":"The Gessi Goccia draws consistently strong marks for fit and finish","description":"Wall-mount lavatory faucet trim wi';
assert.throws(
  () => parseStructuredResponse({ response: truncated }, "truncated intel"),
  (err) => {
    assert.ok(err instanceof AiJsonParseError, "expected AiJsonParseError");
    assert.match(err.message, /unparseable JSON/);
    assert.equal(err.textLength, truncated.length);
    return true;
  },
  "truncated model output must throw so step.do() retries instead of persisting an empty intel row",
);

// Plain prose (model ignored the schema entirely) must also throw, not yield {}.
assert.throws(
  () => parseStructuredResponse({ response: "I cannot determine pricing." }, "prose"),
  AiJsonParseError,
);

// --- THE REAL ROOT CAUSE: OpenAI-style envelope with no `.response` ---
// gpt-oss-120b and kimi-k2.6 answer as choices[0].message.content. This used to
// fall through to "treat raw as the payload", handing back {choices:[…]} — no
// expected keys, so the caller nulled every field with no error anywhere.
assert.deepEqual(
  parseStructuredResponse(
    {
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"aiRetailPrice":"$1,500-$2,000"}' },
        },
      ],
    },
    "openai envelope",
  ),
  { aiRetailPrice: "$1,500-$2,000" },
);

// Reasoning models burn the whole budget on reasoning_content and emit an empty
// content with finish_reason "length". That is a failure, not a different
// envelope — it must throw rather than silently yield {}.
assert.throws(
  () =>
    parseStructuredResponse(
      {
        choices: [
          {
            finish_reason: "length",
            message: { content: "", reasoning_content: "The user wants me to…" },
          },
        ],
      },
      "reasoning-model empty content",
    ),
  AiJsonParseError,
  "empty content from a reasoning model must throw, not degrade to {}",
);

console.log("ai-json parse guards: OK");
