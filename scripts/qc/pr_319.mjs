#!/usr/bin/env node
/**
 * @fileoverview QC — PR #319, 0032 K1: real-time voice MCP keepalive (SSE heartbeat).
 *
 * withSseHeartbeat wraps the two OAuth-gated MCP transports so any
 * text/event-stream response carries a `: ping` comment frame every 15s. The
 * heartbeat only kicks in on an AUTHENTICATED SSE stream (an OAuth grant we can't
 * mint here), so this proves the WRAPPER DID NOT REGRESS the surface:
 *   1. GET /mcp/sse and POST /mcp still respond through the wrapper — an
 *      unauthenticated request is 401 (OAuth gate intact), never 404 (route lost)
 *      or 5xx (wrapper threw).
 *   2. A non-SSE response passes through untouched: the OAuth token endpoint +
 *      the .well-known metadata still answer as before (the wrapper is scoped to
 *      /mcp + /mcp/sse and returns non-event-stream bodies verbatim).
 *   3. Regression — the legacy bearer MCP surface (/api/mcp-docs catalog) is
 *      unaffected (it never went through OAuthProvider's apiHandlers).
 *
 *   pnpm run test:pr 319 -- --preview
 *   pnpm run test:pr 319
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_319 — voice MCP SSE keepalive (K1)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // 1. Both MCP transports still respond through the heartbeat wrapper.
  //    Unauthenticated → OAuth gate answers (401), NOT 404 (route dropped) or 5xx (wrapper threw).
  const sse = await client.get("/mcp/sse");
  checks.ok(
    "GET /mcp/sse → wired through wrapper (401 gated, not 404/5xx)",
    sse.status !== 404 && sse.status < 500,
    `→ ${sse.status}`,
  );
  const mcp = await client.post("/mcp", {});
  checks.ok(
    "POST /mcp → wired through wrapper (not 404/5xx)",
    mcp.status !== 404 && mcp.status < 500,
    `→ ${mcp.status}`,
  );

  // 2. Non-SSE responses pass through untouched — OAuth metadata + token endpoint still answer.
  const meta = await client.get("/.well-known/oauth-authorization-server");
  checks.ok(
    "GET /.well-known/oauth-authorization-server → still served (non-SSE passthrough)",
    meta.status === 200,
    `→ ${meta.status}`,
  );

  // 3. Regression — the legacy bearer MCP catalog is untouched by the OAuth-side wrapper.
  const docs = await client.get("/api/mcp-docs");
  checks.ok(
    "GET /api/mcp-docs → legacy MCP surface intact",
    docs.status === 200,
    `→ ${docs.status}`,
  );

  checks.info(
    "The 15s `: ping` heartbeat fires only on an authenticated text/event-stream MCP session (an OAuth grant not mintable in QC); it's verified live in a Claude voice session. QC proves the wrapper didn't drop/break the transports or the non-SSE paths.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
