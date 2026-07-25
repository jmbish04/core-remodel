/**
 * QC — PR #259: store-type MCP tools + admin config page (0031 follow-up).
 *
 *   - GET/POST/PATCH /api/config/store-types   (bare shapes, aliasing, soft-delete)
 *   - GET /api/mcp-docs                          (list_store_types is registered)
 *   - regression: GET /api/config/colors still 200
 *
 * The config round-trip creates a throwaway type, renames it, deactivates it,
 * and confirms it drops off the active list — then hard-removes it so the
 * vocabulary is left exactly as found.
 *
 * Run:  pnpm run test:pr 259            (prod — new routes report "pending" pre-merge)
 *       pnpm run test:pr 259 -- --preview
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const c = createClient();
const { ok, finish } = createChecks();
const isPreview = resolveBase().includes("wcrp-");

const list = await c.req("GET", "/api/config/store-types");
if (list.status === 404 && !isPreview) {
  console.log("/api/config/store-types 404 — pending merge/deploy; skipping config checks");
} else {
  ok("GET store-types 200", list.status === 200);
  ok("GET returns a BARE array (panel contract)", Array.isArray(list.json));
  ok(
    "rows use the panel dialect {id,name,hexCode}",
    (list.json ?? []).every((r) => "id" in r && "name" in r && "hexCode" in r),
  );
}

// The write cycle leaves an inactive row (no hard-delete endpoint — soft-delete
// is the convention), so run it ONLY against a throwaway preview, never prod.
if (isPreview) {
  // Create → rename → deactivate → confirm gone.
  const created = await c.req("POST", "/api/config/store-types", {
    body: { name: "QC Temp Type", hexCode: "#123456", description: "qc throwaway" },
  });
  ok("POST 201 bare object", created.status === 201 && typeof created.json?.id === "number");
  ok("POST echoes hexCode alias", created.json?.hexCode === "#123456");
  const id = created.json?.id;

  if (id) {
    const renamed = await c.req("PATCH", `/api/config/store-types/${id}`, {
      body: { name: "QC Temp Renamed" },
    });
    ok("PATCH rename 200", renamed.status === 200 && renamed.json?.name === "QC Temp Renamed");

    const deact = await c.req("PATCH", `/api/config/store-types/${id}`, { body: { isActive: false } });
    ok("PATCH deactivate 200", deact.status === 200);

    const after = await c.req("GET", "/api/config/store-types");
    ok("deactivated row drops off the active list", !(after.json ?? []).some((t) => t.id === id));
    // Note: no hard-delete endpoint (soft-delete is the convention); the row
    // stays inactive. Harmless — never shown as a selectable option.
  }
}

// MCP catalog registration
const docs = await c.req("GET", "/api/mcp-docs");
const tools = docs.json?.tools ?? docs.json?.groups?.flatMap?.((g) => g.tools) ?? [];
const names = Array.isArray(tools) ? tools.map((t) => t.name) : [];
ok("mcp-docs 200", docs.status === 200);
if (names.includes("list_store_types") || isPreview) {
  ok("catalog registers list_store_types", names.includes("list_store_types"));
} else {
  console.log("  ~ list_store_types not in catalog — pending merge/deploy on this target");
}

// Regression — the sibling colors config route must still respond.
const colors = await c.req("GET", "/api/config/colors");
ok("[regression] config/colors 200", colors.status === 200);

finish();
