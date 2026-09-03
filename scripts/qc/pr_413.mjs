#!/usr/bin/env node
/**
 * QC for PR #413 — MCP tool list restored, API-key auth on /mcp, Code Mode.
 *
 *   node scripts/qc/pr_413.mjs --preview   # this branch's preview worker
 *   node scripts/qc/pr_413.mjs             # production (regression guard)
 *
 * What it proves, in the order the bug actually failed:
 *
 *   1. `tools/list` returns tools at all. The whole defect was a single
 *      `z.date()` in one outputShape blanking the ENTIRE list for every client
 *      (-32603 "Date cannot be represented in JSON Schema"), so the assertion
 *      that matters is a non-null tool array — not any one tool's presence.
 *   2. Both auth paths reach it: an OAuth grant AND a plain WORKER_API_KEY
 *      bearer, which OAuthProvider used to reject with a flat 401.
 *   3. `/mcp` is Code Mode (`code` + `describe_tools`) and `/mcp/direct` is the
 *      raw surface carrying the full registry.
 *   4. The `code` sandbox executes against live data and cannot reach the
 *      internet.
 *   5. OAuth lifetimes are a full year — a shorter one silently breaks the
 *      claude.ai connector months later.
 *
 * Against PRODUCTION before this merges, 1-4 are reported as "pending
 * merge/deploy" rather than hard failures; the OAuth-lifetime and catalog
 * checks are true regression guards and must pass on prod today.
 */
import { createChecks, resolveBase } from "../config.mjs";
import { accessCookie, catalogToolCount, listTools, oauthAccessToken } from "./_mcp_surface.mjs";

const BASE = resolveBase();
const IS_PROD = !process.argv.includes("--preview") && !process.argv.includes("--base");
const { ok: check, info, finish } = createChecks();
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

console.log(`QC pr_413 (MCP tools + auth + Code Mode) against ${BASE}\n`);

/** On prod before merge a new surface is legitimately absent — report, don't fail. */
function expect(name, condition, detail) {
  if (IS_PROD && !condition) {
    info(`~ ${name} — pending merge/deploy on production (${detail})`);
    return false;
  }
  return check(name, condition, detail);
}

/** JSON-RPC tools/call against the Code Mode endpoint. */
async function callTool(token, sessionHeaders, name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...sessionHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.match(/^data: (.*)$/m);
  return line ? JSON.parse(line[1]) : null;
}

// ── 1. The registry itself (regression guard — must pass everywhere) ─────────
const catalogCount = await catalogToolCount(BASE);
check("/api/mcp-docs reports a populated registry", catalogCount > 100, `toolCount=${catalogCount}`);

// ── 2. OAuth: full authorization-code flow, and a ONE YEAR access token ──────
const { accessToken, refreshToken, expiresIn } = await oauthAccessToken(BASE);
check("OAuth authorization-code flow yields an access token", Boolean(accessToken));
check("OAuth issues a refresh token", Boolean(refreshToken));
check(
  "OAuth access token lives a full year",
  expiresIn === ONE_YEAR_SECONDS,
  `expires_in=${expiresIn} (${(expiresIn / 86400).toFixed(1)} days), want ${ONE_YEAR_SECONDS}`,
);

// ── 3. tools/list is non-empty on every surface × every auth path ────────────
const { key } = await accessCookie();
const surfaces = [
  ["/mcp", "oauth", accessToken],
  ["/mcp", "api key", key],
  ["/mcp/direct", "oauth", accessToken],
  ["/mcp/direct", "api key", key],
];

const listed = new Map();
for (const [path, kind, token] of surfaces) {
  const res = await listTools(BASE, path, { authorization: `Bearer ${token}` });
  const names = res.tools;
  listed.set(`${path}:${kind}`, names);
  expect(
    `${path} (${kind}) returns a tool list`,
    Array.isArray(names) && names.length > 0,
    `status=${res.status} ${res.error ?? "tools=null"}`,
  );
}

const codeTools = listed.get("/mcp:oauth");
expect(
  "/mcp is Code Mode — exactly `code` + `describe_tools`",
  Array.isArray(codeTools) && codeTools.length === 2 && codeTools.includes("code") && codeTools.includes("describe_tools"),
  `tools=${JSON.stringify(codeTools)}`,
);

const directTools = listed.get("/mcp/direct:oauth");
expect(
  "/mcp/direct advertises the whole registry",
  Array.isArray(directTools) && directTools.length === catalogCount,
  `direct=${directTools?.length} catalog=${catalogCount}`,
);
expect(
  "the API-key path sees the same surface as OAuth",
  // Both being null is NOT agreement — require a real list before comparing, or
  // this passes vacuously against a production that serves neither.
  Array.isArray(directTools) &&
    JSON.stringify(listed.get("/mcp/direct:api key")) === JSON.stringify(directTools),
  `oauth=${directTools?.length ?? "null"} apikey=${listed.get("/mcp/direct:api key")?.length ?? "null"}`,
);

// ── 4. Code Mode actually runs, and is sandboxed ─────────────────────────────
if (Array.isArray(codeTools) && codeTools.includes("code")) {
  const init = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qc", version: "1" } },
    }),
  });
  const session = { "mcp-session-id": init.headers.get("mcp-session-id") };

  const described = await callTool(key, session, "describe_tools", { names: ["list_rooms"] });
  const describedText = described?.result?.content?.[0]?.text ?? "";
  check(
    "describe_tools returns TypeScript for a named method",
    describedText.includes("ListRoomsInput"),
    describedText.slice(0, 160),
  );

  const ran = await callTool(key, session, "code", {
    code: "async () => { const r = await codemode.list_rooms({ limit: 3 }); return r.items.length; }",
  });
  const ranText = ran?.result?.content?.[0]?.text ?? "";
  check(
    "code executes JavaScript against live remodel data",
    !ran?.result?.isError && Number(ranText) > 0,
    `isError=${ran?.result?.isError} text=${ranText.slice(0, 200)}`,
  );

  const escaped = await callTool(key, session, "code", {
    code: "async () => { const r = await fetch('https://example.com'); return r.status; }",
  });
  const escapedText = escaped?.result?.content?.[0]?.text ?? "";
  check(
    "the code sandbox cannot reach the internet",
    escaped?.result?.isError === true && escapedText.includes("not permitted to access the internet"),
    escapedText.slice(0, 200),
  );
} else if (IS_PROD) {
  info("~ code-tool execution — pending merge/deploy on production");
}

// ── 5. The legacy bearer shim must keep working ──────────────────────────────
const legacy = await fetch(`${BASE}/api/mcp`, {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});
const legacyBody = await legacy.json();
check(
  "legacy /api/mcp bearer shim still lists its tools",
  (legacyBody?.result?.tools?.length ?? 0) > 0,
  `status=${legacy.status} tools=${legacyBody?.result?.tools?.length}`,
);

finish();
