#!/usr/bin/env node
/**
 * Unit test for the agent run ledger's pure helpers
 * (`services/agent-runs.ts`): secret redaction, size capping, and the
 * error-code extraction that makes failures groupable.
 *
 * Redaction is a security boundary — tool arguments routinely carry API keys
 * and this table is readable from an admin page — so it gets a real test.
 *
 * Pure functions, no network and no bindings. Costs nothing to run.
 *
 * Usage:
 *   node scripts/tests/test_agent_runs.mjs
 *   pnpm run test:agent-runs
 */
import assert from "node:assert/strict";

import { errorCodeOf, safeJson } from "../../src/backend/services/agent-run-format.ts";

let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("\nagent-runs / safeJson");

check("redacts secret-ish keys at any depth", () => {
  const out = safeJson({
    url: "https://example.com",
    apiKey: "sk-live-123",
    nested: { authorization: "Bearer abc", GOOGLE_MAPS_API: "xyz" },
  });
  assert.ok(!out.includes("sk-live-123"), "api key leaked");
  assert.ok(!out.includes("Bearer abc"), "authorization leaked");
  assert.ok(!out.includes("xyz"), "nested secret leaked");
  assert.ok(out.includes("[redacted]"));
  assert.ok(out.includes("https://example.com"), "non-secret data should survive");
});

check("redaction is case-insensitive and matches substrings", () => {
  for (const key of ["Token", "REFRESH_TOKEN", "password", "myApiKeyHere", "Cookie"]) {
    const out = safeJson({ [key]: "leak-me" });
    assert.ok(!out.includes("leak-me"), `${key} was not redacted`);
  }
});

check("caps oversized payloads AND stays valid JSON", () => {
  const out = safeJson({ blob: "x".repeat(50_000) });
  assert.ok(out.length < 6_000, `expected a capped string, got ${out.length} chars`);
  // Raw slicing would emit invalid JSON, which throws in the UI's JSON.parse
  // and breaks SQLite json_extract on this column.
  const parsed = JSON.parse(out);
  assert.equal(parsed._truncated, true);
  assert.ok(parsed._originalLength > 50_000);
  assert.equal(typeof parsed.preview, "string");
});

check("unserializable placeholder is valid JSON too", () => {
  const a = { name: "a" };
  a.self = a;
  assert.deepEqual(JSON.parse(safeJson(a)), { _unserializable: true });
});

check("returns null for null/undefined rather than the string 'null'", () => {
  assert.equal(safeJson(undefined), null);
  assert.equal(safeJson(null), null);
});

check("survives circular structures without throwing", () => {
  const a = { name: "a" };
  a.self = a;
  assert.doesNotThrow(() => safeJson(a));
});

check("passes through ordinary values", () => {
  assert.equal(safeJson({ n: 1, s: "two" }), '{"n":1,"s":"two"}');
  assert.equal(safeJson([1, 2]), "[1,2]");
});

console.log("\nagent-runs / errorCodeOf");

check("prefers an explicit SCREAMING_SNAKE code", () => {
  // The real one: GoogleMapsService throws this when the free tier is spent.
  assert.equal(errorCodeOf(new Error("MAPS_QUOTA_EXCEEDED")), "MAPS_QUOTA_EXCEEDED");
  assert.equal(
    errorCodeOf(new Error("ROUTE_MATRIX_ERROR: 500 upstream exploded")),
    "ROUTE_MATRIX_ERROR",
  );
});

check("falls back to an HTTP status when there is no code", () => {
  // The real one: the transient Gemini failure that killed a whole scout run.
  assert.equal(errorCodeOf(new Error("503 Service Unavailable")), "503");
  assert.equal(errorCodeOf(new Error("request failed with 429")), "429");
});

check("falls back to the error class name", () => {
  class TimeoutError extends Error {}
  assert.equal(errorCodeOf(new TimeoutError("took too long")), "TimeoutError");
});

check("never throws on odd inputs", () => {
  assert.equal(errorCodeOf(null), "UNKNOWN");
  assert.equal(errorCodeOf(undefined), "UNKNOWN");
  assert.equal(typeof errorCodeOf("plain string"), "string");
  assert.equal(typeof errorCodeOf({ weird: true }), "string");
});

check("REGRESSION: does NOT group on incidental acronyms", () => {
  // The original regex matched any 4+ char capitalized token, so a message
  // like "Failed to parse JSON response" grouped under "JSON" and dragged
  // unrelated failures into one bucket — destroying the grouping this
  // function exists to provide. Requiring an underscore discriminates a real
  // SCREAMING_SNAKE code from an incidental acronym.
  for (const [msg, notCode] of [
    ["Failed to parse JSON response", "JSON"],
    ["HTTP request never completed", "HTTP"],
    ["GET /api/foo hung up", "GET"],
    ["Invalid URL supplied", "URL"],
    ["NULL returned where an object was expected", "NULL"],
  ]) {
    assert.notEqual(errorCodeOf(new Error(msg)), notCode, `"${msg}" grouped as ${notCode}`);
  }
});

check("prefers an explicit .code property over message parsing", () => {
  // Node convention, and more trustworthy than any regex.
  const e = Object.assign(new Error("connect failed"), { code: "ETIMEDOUT" });
  assert.equal(errorCodeOf(e), "ETIMEDOUT");
  const httpish = Object.assign(new Error("boom"), { code: 503 });
  assert.equal(errorCodeOf(httpish), "503");
});

check("groups identical failures under one code", () => {
  // The whole point: 5 stores failing the same way must read as one problem.
  const codes = [
    "MAPS_QUOTA_EXCEEDED",
    "MAPS_QUOTA_EXCEEDED: store 41",
    "Error: MAPS_QUOTA_EXCEEDED while geocoding",
  ].map((m) => errorCodeOf(new Error(m)));
  assert.deepEqual(new Set(codes), new Set(["MAPS_QUOTA_EXCEEDED"]));
});

console.log(`\n${passed} passed${process.exitCode ? " (with failures)" : ""}\n`);
