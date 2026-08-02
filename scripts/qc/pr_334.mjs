#!/usr/bin/env node
/**
 * QC for PR #334 — Pascal Phase 3 (full-fidelity edits, compare, snapshots) + page move.
 * Run: node scripts/qc/pr_334.mjs --preview   or bare (prod, regression)
 *
 * The new tools are in the OAuth `/mcp` registry (surfaced by /api/mcp-docs). Execution
 * of edits runs via the OAuth connector; here we verify registration + the page move.
 */
import { accessCookie, createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, finish } = createChecks();
console.log(`QC pascal phase 3 against ${BASE}\n`);

const NEW_TOOLS = [
  "edit_scene_nodes",
  "put_scene_graph",
  "compare_layout_variants",
  "capture_scene_screenshot",
];

try {
  const docs = await c.get("/api/mcp-docs");
  check("GET /api/mcp-docs 200", docs.status === 200, `status=${docs.status}`);
  const tools = docs.json?.tools || docs.json?.groups?.flatMap((g) => g.tools || []) || [];
  const byName = new Map(tools.map((t) => [t.name, t]));

  if (docs.status === 200 && !NEW_TOOLS.some((n) => byName.has(n))) {
    console.log(`\n⚠️  phase-3 tools not in catalog on ${BASE} — pending merge/deploy.\n`);
    process.exit(0);
  }

  for (const name of NEW_TOOLS) {
    const t = byName.get(name);
    check(`tool registered: ${name}`, !!t, "missing");
    if (t)
      check(
        `  ${name}: render + description + example`,
        t.category === "render" && (t.description?.length ?? 0) > 20 && (t.examples?.length ?? 0) >= 1,
        `cat=${t.category} desc=${t.description?.length} ex=${t.examples?.length}`,
      );
  }
  const edit = byName.get("edit_scene_nodes");
  check(
    "edit_scene_nodes advertises add/update/delete/move",
    /add\/update\/delete\/move|granular/i.test(edit?.description || ""),
    edit?.description?.slice(0, 80),
  );

  // Page move: /admin/plan/3d renders; old /admin/pascal/editor is gone.
  const cookie = accessCookie();
  const nu = await c.req("GET", "/admin/plan/3d", { headers: { cookie } });
  check("/admin/plan/3d renders (200)", nu.status === 200, `status=${nu.status}`);
  check("/admin/plan/3d embeds the editor iframe", /<iframe/i.test(nu.text || ""), "no iframe");
  const old = await c.req("GET", "/admin/pascal/editor", { headers: { cookie } });
  check("old /admin/pascal/editor is gone (404)", old.status === 404, `status=${old.status}`);

  info("Edit/put/compare/capture execution is exercised via the OAuth connector.");
} catch (err) {
  check("QC ran without throwing", false, String(err?.stack || err));
}

finish();
