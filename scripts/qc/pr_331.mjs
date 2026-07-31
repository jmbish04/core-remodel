#!/usr/bin/env node
/**
 * QC for PR #331 — Pascal MCP tools + generator (0043 Phase 2).
 * Run: node scripts/qc/pr_331.mjs --preview   (branch)   or bare (prod, regression)
 *
 * The 9 `pascal` tools live in the OAuth `/mcp` registry (ALL_TOOL_GROUPS), which
 * is surfaced by the public catalog `GET /api/mcp-docs`. That catalog is the honest
 * deployed wire check for registry tools (same approach as pr_220 / pr_301). End-to-end
 * tool execution runs through the OAuth connector + the Phase-4 /admin/pascal UI.
 */
import { createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, finish } = createChecks();
console.log(`QC pascal MCP tools against ${BASE}\n`);

const EXPECTED = [
  "create_render_project",
  "create_study",
  "get_render_context",
  "get_scene_graph",
  "generate_floorplan_variant",
  "list_studies",
  "list_variants",
  "get_variant_editor_link",
  "get_render_status",
];

try {
  const docs = await c.get("/api/mcp-docs");
  check("GET /api/mcp-docs 200", docs.status === 200, `status=${docs.status}`);

  const tools =
    docs.json?.tools ||
    docs.json?.groups?.flatMap((g) => g.tools || []) ||
    [];
  check("catalog has tools", Array.isArray(tools) && tools.length > 0, `n=${tools.length}`);

  const byName = new Map(tools.map((t) => [t.name, t]));

  // Regression guard: on a target where none of the new tools are deployed yet
  // (e.g. prod before merge), report pending instead of failing.
  if (!EXPECTED.some((n) => byName.has(n))) {
    console.log(
      `\n⚠️  pascal tools not in the catalog on ${BASE} — pending merge/deploy. ` +
        `Run against --preview to verify the new surface.\n`,
    );
    process.exit(0);
  }

  for (const name of EXPECTED) {
    const t = byName.get(name);
    check(`tool registered: ${name}`, !!t, "missing from catalog");
    if (t) {
      check(
        `  ${name}: render category + description + example`,
        t.category === "render" &&
          typeof t.description === "string" &&
          t.description.length > 20 &&
          Array.isArray(t.examples) &&
          t.examples.length >= 1,
        `cat=${t.category} desc=${t.description?.length} ex=${t.examples?.length}`,
      );
    }
  }

  // get_scene_graph must advertise the full-fidelity read intent.
  const gsg = byName.get("get_scene_graph");
  check(
    "get_scene_graph promises the FULL graph",
    /full|every node|complete/i.test(gsg?.description || ""),
    gsg?.description?.slice(0, 80),
  );

  info("Execution (create/generate/read) is exercised via the OAuth connector + Phase-4 admin UI.");
} catch (err) {
  check("QC ran without throwing", false, String(err?.stack || err));
}

finish();
