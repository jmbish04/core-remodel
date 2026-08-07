#!/usr/bin/env node
/**
 * QC for 0048 — Multi-room multi-angle render campaigns.
 *
 * Verifies the new campaign API surface and that the canonical MCP registry
 * exposes the render campaign tools. Does not run a full end-to-end render
 * (that requires blank-canvas listing photos and AI quota).
 *
 * The tools + routes are new, so on prod (pre-merge/deploy) they are absent →
 * reported pending, not failed.
 *
 *   pnpm run test:pr 0048 -- --preview
 *   pnpm run test:pr 0048
 */
import { createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const { ok: check, info, summary } = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(
  `\nQC 0048 — multi-room render campaigns\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`,
);

/** On prod, a not-yet-deployed surface is pending (not a failure). */
function pendingOr(cond, name) {
  if (!cond && !isPreview) {
    info(`${name} — not on prod yet (pending merge/deploy; expected pre-merge).`);
    return false;
  }
  return true;
}

// 1. MCP registry includes the new render tools (regression: mcp-docs itself).
const docs = await client.get("/api/mcp-docs");
check("mcp-docs 200", docs.status === 200, `status=${docs.status}`);
const tools = docs.json?.tools ?? [];
const toolNames = new Set(tools.map((t) => t.name));
for (const name of [
  "create_render_campaign",
  "list_render_campaigns",
  "get_render_campaign",
  "cancel_render_campaign",
  "run_room_looks",
]) {
  if (pendingOr(toolNames.has(name), `tool registered: ${name}`)) {
    check(`tool registered: ${name}`, toolNames.has(name));
  }
}

// 2. Campaign list endpoint is reachable.
const list = await client.get("/api/render/campaigns?limit=10");
if (pendingOr(list.status === 200, "GET /api/render/campaigns 200")) {
  check("GET /api/render/campaigns 200", list.status === 200, `status=${list.status}`);
  check(
    "list returns campaigns array",
    Array.isArray(list.json?.campaigns),
    JSON.stringify(list.json)?.slice(0, 120),
  );
}

// 3. Unknown campaign returns 404 (a plain 404 on prod is ambiguous — only
//    assert on preview, where the route definitely exists).
const missing = await client.get(`/api/render/campaigns/${crypto.randomUUID()}`);
if (isPreview) {
  check("GET unknown campaign 404", missing.status === 404, `status=${missing.status}`);
}

// 4. Create campaign with invalid angles returns a clean 400 (not a 500).
const bad = await client.post("/api/render/campaigns", {
  name: "QC invalid campaign",
  prompt: "Test prompt",
  angles: [{ roomId: 999999, listingPhotoId: 999999 }],
});
if (pendingOr(bad.status === 400, "POST invalid angles 400")) {
  check(
    "POST invalid angles 400",
    bad.status === 400,
    `status=${bad.status} ${bad.text?.slice(0, 120)}`,
  );
  check(
    "error message present",
    typeof bad.json?.error === "string" && bad.json.error.length > 0,
    JSON.stringify(bad.json)?.slice(0, 120),
  );
}

info(
  `registered render campaign tools: ${
    [...toolNames]
      .filter(
        (n) =>
          n.endsWith("_render_campaign") || n === "run_room_looks" || n === "list_render_campaigns",
      )
      .join(", ") || "(none — pending deploy)"
  }`,
);

process.exit(summary().failed === 0 ? 0 : 1);
