#!/usr/bin/env node
/** Generates docs/0041_homeowner_experience/PAGE_TRIAGE.md from the mapping below. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// verdict: KEEP (becomes a public destination) | COMBINE (route disappears into another surface)
//          OPERATOR (stays yours, out of public nav) | REMOVE (no job, or a duplicate)
// dest:    Home | Vision | Rooms | Out There | Money | Needs You | Build* | Trade* | — (*deferred)
const T = [
  // ── Shell / entry ─────────────────────────────────────────────────────────
  ["/", "KEEP", "Home", "Device-routing root becomes the project diagram."],
  ["/access", "OPERATOR", "—", "Auth gate. Unchanged."],
  ["/sitemap", "OPERATOR", "—", "Dev navigation aid; no homeowner job."],

  // ── Home ──────────────────────────────────────────────────────────────────
  ["/admin", "OPERATOR", "—", "Operator analytics. The public Home is net-new, not this."],
  ["/log/daily", "COMBINE", "Home", "Becomes 'recent movement' on Home. No natural entry event of its own."],
  ["/log/weekly", "COMBINE", "Home", "Same feed at a different grain — a filter, not a route."],
  ["/admin/shopping/progress", "COMBINE", "Home", "Duplicates the whole-project read the diagram gives for free."],

  // ── Vision ────────────────────────────────────────────────────────────────
  ["/questionnaire/", "KEEP", "Vision", "This IS the living brief intake. Becomes profile + axes."],
  ["/questionnaire/[section_slug]", "KEEP", "Vision", "Section of the brief."],
  ["/questionnaire/print", "COMBINE", "Vision", "An export of the brief, not a place."],
  ["/admin/designs/decision-room", "KEEP", "Vision", "Partner alignment. Already the advocacy-quorum surface."],
  ["/admin/designs/workshop", "KEEP", "Vision", "Concept development."],
  ["/admin/designs/moodboards", "KEEP", "Vision", "Atelier-led."],
  ["/admin/designs/moodboards/[slug]", "KEEP", "Vision", "One board."],
  ["/moodboards", "REMOVE", "Vision", "Duplicate of /admin/designs/moodboards. Two routes, one job."],
  ["/photos/inspiration", "KEEP", "Vision", "Pre-commitment imagery belongs to the dream, not to sourcing."],
  ["/admin/builder", "KEEP", "Vision", "Renovation Studio — render generation."],
  ["/admin/gallery", "COMBINE", "Vision", "Render output belongs inside the studio that made it."],
  ["/admin/prepare/blank-canvas/[...tab]", "COMBINE", "Vision", "A mode of the studio, not a separate destination."],
  ["/admin/designs/furnishings", "KEEP", "Rooms", "Furnishing is per-room; it lives in the room."],

  // ── Rooms ─────────────────────────────────────────────────────────────────
  ["/rooms/[slug]", "KEEP", "Rooms", "The room workspace. Comp C."],
  ["/rooms/beta/[slug]", "REMOVE", "Rooms", "A beta twin of the room page. Pick one; two is a trap."],
  ["/floor-plan", "KEEP", "Rooms", "The house view; entry into a room."],
  ["/kitchen-layout", "COMBINE", "Rooms", "A single room's layout study hardcoded as a top-level route."],
  ["/admin/planning/measure", "KEEP", "Rooms", "Live floor plan / measurement capture."],
  ["/admin/measurements", "COMBINE", "Rooms", "Per-room data shown project-wide. Becomes a lens, not a route."],
  ["/photos/listing", "COMBINE", "Rooms", "As-is condition is a room attribute."],
  ["/admin/shopping/schedule", "KEEP", "Rooms", "The material schedule is the room's spec, renamed."],
  ["/admin/shopping/material/[id]", "KEEP", "Rooms", "A material belongs to exactly one room."],
  ["/admin/shopping/closets", "COMBINE", "Rooms", "One room type promoted to a route."],
  ["/admin/designs/floorplan-regions", "OPERATOR", "—", "Region-drawing tooling. Setup, not use."],

  // ── Out There ─────────────────────────────────────────────────────────────
  ["/admin/shopping", "COMBINE", "Out There", "Hub page. The destination replaces it."],
  ["/admin/shopping/sourcing", "COMBINE", "Out There", "Second hub page for the same cluster."],
  ["/admin/shopping/showrooms", "KEEP", "Out There", "The showroom directory."],
  ["/admin/shopping/showrooms/[tab]", "KEEP", "Out There", "Tabs of the directory."],
  ["/admin/shopping/store/[id]", "KEEP", "Out There", "One store."],
  ["/admin/shopping/store/[id]/[section]", "KEEP", "Out There", "Section of a store."],
  ["/admin/shopping/store/[id]/inbox", "COMBINE", "Out There", "Store comms belong in the store's own sections."],
  ["/admin/shopping/drives/", "KEEP", "Out There", "Drive lists."],
  ["/admin/shopping/drives/[slug]", "KEEP", "Out There", "One drive. The in-car surface."],
  ["/admin/shopping/showrooms/visitlogs", "KEEP", "Out There", "Visit capture."],
  ["/admin/shopping/showrooms/visitlogs/[id]", "KEEP", "Out There", "One visit."],
  ["/admin/shopping/showrooms/visitlogs/new", "COMBINE", "Out There", "A create action, not a destination."],
  ["/admin/shopping/contacts", "KEEP", "Out There", "Showroom people."],
  ["/admin/shopping/sales", "KEEP", "Out There", "Sales and clearance."],
  ["/admin/shopping/intake", "KEEP", "Out There", "Capture."],
  ["/admin/shopping/scan", "COMBINE", "Out There", "A capture mode, not a place."],
  ["/admin/shopping/photo-intake", "COMBINE", "Out There", "Same — a capture mode."],
  ["/admin/shopping/products", "KEEP", "Out There", "Product library."],
  ["/admin/shopping/product/[id]", "KEEP", "Out There", "One product."],
  ["/admin/products/", "REMOVE", "Out There", "Duplicate of /admin/shopping/products."],
  ["/admin/products/[id]", "REMOVE", "Out There", "Duplicate of /admin/shopping/product/[id]."],
  ["/admin/shopping/brands/", "KEEP", "Out There", "Brand library."],
  ["/admin/shopping/brands/[brandId]", "KEEP", "Out There", "One brand."],
  ["/admin/showrooms/[id]/brands/[brandId]", "COMBINE", "Out There", "Brand-within-store; a filter of the brand page."],
  ["/admin/shopping/wishlist", "KEEP", "Out There", "Parked ideas — park-before-commit made literal."],
  ["/admin/shopping/journal", "COMBINE", "Out There", "A feed of capture events; belongs on the destination."],
  ["/admin/shopping/compare", "COMBINE", "Out There", "Comparison is a mode over a selection, not a route."],
  ["/admin/shopping/research", "KEEP", "Out There", "Deep research library."],
  ["/admin/shopping/research/[id]", "KEEP", "Out There", "One research run."],
  ["/admin/planning/research", "REMOVE", "Out There", "Second research library. Same job as the above."],
  ["/admin/planning/research/[id]", "REMOVE", "Out There", "Duplicate detail route."],
  ["/admin/prepare/uploads", "KEEP", "Out There", "The upload window."],

  // ── Needs You ─────────────────────────────────────────────────────────────
  ["/admin/shopping/showrooms/hitl", "COMBINE", "Needs You", "Park-finds review. A queue, not a place."],
  ["/admin/shopping/photo-review", "COMBINE", "Needs You", "Price-card review queue."],
  ["/admin/shopping/product-photo-hitl", "COMBINE", "Needs You", "Product-photo review queue."],
  ["/admin/shopping/receipt-review", "COMBINE", "Needs You", "Receipt review queue."],
  ["/admin/prepare/review", "COMBINE", "Needs You", "Photo review queue."],
  ["/admin/shopping/gaps", "COMBINE", "Needs You", "What is missing IS the queue."],
  ["/admin/photo-edits", "COMBINE", "Needs You", "Edit sessions awaiting a human."],

  // ── Money ─────────────────────────────────────────────────────────────────
  ["/admin/budget/tracker", "KEEP", "Money", "Committed vs paid vs exposed."],
  ["/admin/budget/dashboard", "COMBINE", "Money", "Triage matrix is a view of the tracker."],
  ["/admin/budget/truth-table", "COMBINE", "Money", "Labor and materials costs — a lens on the same data."],
  ["/admin/budget/reconciliation", "KEEP", "Money", "Reconciling receipts to plan is its own task."],
  ["/admin/estimates", "KEEP", "Money", "Estimates."],
  ["/admin/estimates/new", "COMBINE", "Money", "A create action."],
  ["/admin/bids", "KEEP", "Money", "Bid comparison."],
  ["/admin/bids/new", "COMBINE", "Money", "A create action."],

  // ── Trade / Build (deferred destinations) ────────────────────────────────
  ["/admin/companies/", "KEEP", "Trade*", "The professionals."],
  ["/admin/companies/[id]", "KEEP", "Trade*", "One company."],
  ["/admin/services", "COMBINE", "Trade*", "Service catalogue; an attribute of companies."],
  ["/admin/contracts", "KEEP", "Trade*", "Contracts — 0042 owns the intelligence on top."],
  ["/admin/permits", "KEEP", "Build*", "Permits."],
  ["/admin/permits/[permitIdentifier]", "KEEP", "Build*", "One permit."],
  ["/admin/permits/contacts", "COMBINE", "Build*", "Permit people; belongs on the permit."],
  ["/admin/pmo/schedule/contractor", "KEEP", "Build*", "Schedule."],
  ["/admin/tasks", "KEEP", "Build*", "Tasks."],
  ["/bid/[token]", "KEEP", "Trade*", "Vendor-facing share link. Its own surface, correctly."],

  // ── Documents ─────────────────────────────────────────────────────────────
  ["/admin/docs/", "KEEP", "Records", "Documents."],
  ["/admin/docs/views", "OPERATOR", "—", "Saved-view configuration."],
  ["/docs/", "REMOVE", "Records", "Public twin of /admin/docs."],
  ["/docs/[id]", "REMOVE", "Records", "Duplicate detail route."],
  ["/docs/view/[slug]", "REMOVE", "Records", "Third route into the same documents."],
  ["/admin/supporting-docs", "COMBINE", "Records", "Supporting docs are documents with a tag."],
  ["/supporting-docs", "REMOVE", "Records", "Public twin of the above."],
  ["/admin/notes/edit", "COMBINE", "Records", "A note editor with no natural entry event."],

  // ── Comms ─────────────────────────────────────────────────────────────────
  ["/admin/inbox", "COMBINE", "Needs You", "One of three inbox routes."],
  ["/admin/inbox/all", "KEEP", "Needs You", "The unified inbox is the one that survives."],
  ["/admin/inbox/gmail", "COMBINE", "Needs You", "A source filter of the unified inbox."],
  ["/admin/dialer", "OPERATOR", "—", "Prospecting tool. No homeowner job."],

  // ── Operator: system, config, dev ─────────────────────────────────────────
  ["/admin/changelog", "OPERATOR", "—", "Dev changelog."],
  ["/admin/changelog/[slug]", "OPERATOR", "—", "Changelog detail."],
  ["/admin/changelog/[slug]/slides", "OPERATOR", "—", "Slide view."],
  ["/admin/changelog/blocks", "OPERATOR", "—", "Block gallery."],
  ["/admin/changelog/preview/", "OPERATOR", "—", "Proposal index."],
  ["/admin/changelog/preview/[slug]", "OPERATOR", "—", "Proposal detail — this plan lives here."],
  ["/admin/changelog/preview/[slug]/slides", "OPERATOR", "—", "Slide view."],
  ["/admin/plans/", "OPERATOR", "—", "Plan board."],
  ["/admin/plans/[slug]", "OPERATOR", "—", "One plan."],
  ["/admin/studio", "OPERATOR", "—", "Component studio."],
  ["/admin/studio/[slug]", "OPERATOR", "—", "One component."],
  ["/studio-runtime", "OPERATOR", "—", "Studio runtime host."],
  ["/admin/changelog/blocks ", "REMOVE", "—", "duplicate-guard row; ignored"],
  ["/admin/system/health", "OPERATOR", "—", "Health probes."],
  ["/admin/system/audit/", "OPERATOR", "—", "Audit log."],
  ["/admin/system/audit/[serviceSlug]", "OPERATOR", "—", "Per-service audit."],
  ["/admin/system/logs/", "OPERATOR", "—", "Logs."],
  ["/admin/system/logs/[serviceSlug]", "OPERATOR", "—", "Per-service logs."],
  ["/admin/system/agents/queue", "OPERATOR", "—", "Agent run ledger."],
  ["/admin/system/agents/queue/[id]", "OPERATOR", "—", "One run."],
  ["/admin/system/agents/failed", "OPERATOR", "—", "Agent failures."],
  ["/admin/system/agents/usage", "OPERATOR", "—", "Agent cost."],
  ["/admin/system/integration/usage", "OPERATOR", "—", "Integration usage."],
  ["/admin/integrations/usage", "REMOVE", "—", "Duplicate of /admin/system/integration/usage."],
  ["/admin/mcp-ops", "OPERATOR", "—", "MCP ops."],
  ["/admin/mcp-ops/[...path]", "OPERATOR", "—", "MCP ops detail."],
  ["/admin/pmo/components", "OPERATOR", "—", "PMO component inventory."],
  ["/admin/pmo/operations", "OPERATOR", "—", "PMO operations."],
  ["/admin/config", "OPERATOR", "—", "Config home. Correctly admin-gated already."],
  ["/admin/config/address", "OPERATOR", "—", "Property address — the flow that must create the properties row."],
  ["/admin/config/brands/types", "OPERATOR", "—", "Brand type vocabulary."],
  ["/admin/config/device", "OPERATOR", "—", "Device landing preferences."],
  ["/admin/config/integrations/tesla", "OPERATOR", "—", "Tesla integration."],
  ["/admin/config/tesla", "REMOVE", "—", "Duplicate of config/integrations/tesla."],
  ["/admin/config/photo/categories", "OPERATOR", "—", "Photo category vocabulary."],
  ["/admin/config/photo/colors", "OPERATOR", "—", "Colour vocabulary."],
  ["/admin/config/photo/subcategories", "OPERATOR", "—", "Photo subcategory vocabulary."],
  ["/admin/config/showroom/store-types", "OPERATOR", "—", "Store type vocabulary."],
  ["/admin/config/tax", "OPERATOR", "—", "Sales tax rates."],
  ["/admin/config/usage", "OPERATOR", "—", "Usage config."],
  ["/connect/", "OPERATOR", "—", "MCP connector docs. Public, but its own surface."],
  ["/connect/tools", "OPERATOR", "—", "Tool catalogue."],
];

const rows = T.filter((r) => !r[0].endsWith(" "));

// ── integrity check: every discovered route accounted for exactly once ───────
const discovered = execFileSync("bash", [
  "-lc",
  "find src/frontend/pages -name '*.astro' | sed 's|src/frontend/pages||; s|\\.astro$||; s|/index$|/|' | sort",
])
  .toString()
  .trim()
  .split("\n");

const mapped = new Set(rows.map((r) => r[0]));
const missing = discovered.filter((d) => !mapped.has(d));
const extra = [...mapped].filter((m) => !discovered.includes(m));
const dupes = rows.map((r) => r[0]).filter((v, i, a) => a.indexOf(v) !== i);

if (missing.length || extra.length || dupes.length) {
  console.error("TRIAGE INTEGRITY FAILURE");
  if (missing.length) console.error("  unmapped routes:", missing);
  if (extra.length) console.error("  mapped but not found:", extra);
  if (dupes.length) console.error("  duplicated rows:", dupes);
  process.exit(1);
}

const count = (fn) => rows.filter(fn).length;
const byVerdict = ["KEEP", "COMBINE", "OPERATOR", "REMOVE"].map((v) => [v, count((r) => r[1] === v)]);
const DESTS = ["Home", "Vision", "Rooms", "Out There", "Needs You", "Money", "Records", "Trade*", "Build*"];
const publicRows = rows.filter((r) => r[1] === "KEEP" || r[1] === "COMBINE");

let md = `# 0041 · Page triage — all ${rows.length} routes

> Generated from the mapping in \`scripts/\` and integrity-checked against
> \`find src/frontend/pages -name '*.astro'\`: every discovered route appears
> exactly once, nothing mapped that does not exist. Regenerating fails loudly
> if a route is added without a verdict.

## Verdicts

| Verdict | Count | Meaning |
|---|---:|---|
${byVerdict
  .map(
    ([v, n]) =>
      `| **${v}** | ${n} | ${
        {
          KEEP: "Survives as a route inside a public destination.",
          COMBINE: "Route disappears — becomes a tab, panel, filter, mode, or action on another surface.",
          OPERATOR: "Stays yours. Out of public navigation entirely.",
          REMOVE: "No homeowner job, or a duplicate of a route that does the same thing.",
        }[v]
      } |`,
  )
  .join("\n")}

**${publicRows.length} routes are homeowner-facing.** Of those, **${count(
    (r) => r[1] === "KEEP",
  )} survive as routes** and **${count(
    (r) => r[1] === "COMBINE",
  )} collapse into another surface** — a ${Math.round(
    (1 - count((r) => r[1] === "KEEP") / publicRows.length) * 100,
  )}% reduction in public route count before a single screen is designed.

The other ${count((r) => r[1] === "OPERATOR")} stay as your back office, and ${count(
    (r) => r[1] === "REMOVE",
  )} are duplicates or dead twins that should go regardless of this plan.

## Duplicates worth killing on their own merits

These are not triage opinions — they are two routes doing one job today:

${rows
  .filter((r) => r[1] === "REMOVE")
  .map((r) => `- \`${r[0]}\` — ${r[3]}`)
  .join("\n")}

## By destination

${DESTS.map((d) => {
  const inDest = publicRows.filter((r) => r[2] === d);
  if (inDest.length === 0) return "";
  const keeps = inDest.filter((r) => r[1] === "KEEP").length;
  return `### ${d}${d.endsWith("*") ? " *(deferred destination)*" : ""}

${inDest.length} routes in, ${keeps} out.

| Route | Verdict | Reason |
|---|---|---|
${inDest.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[3]} |`).join("\n")}
`;
}).join("\n")}

## Operator surfaces (out of public navigation)

${count((r) => r[1] === "OPERATOR")} routes. Untouched by this plan — they remain
the operator back office, and \`/admin/config/*\` already lives behind its own
shell exactly as the project conventions require.

| Route | Reason |
|---|---|
${rows
  .filter((r) => r[1] === "OPERATOR")
  .map((r) => `| \`${r[0]}\` | ${r[3]} |`)
  .join("\n")}

## What this changes about the plan

- **The questionnaire is the living brief.** \`/questionnaire/*\` already collects
  what Vision needs. Phase 2 extends it into profiles and axes rather than
  building intake from scratch.
- **The review queues are already one queue, wearing seven URLs.** park-finds,
  price cards, product photos, receipts, photo review, gaps, and photo edits are
  all the same job. Needs You is a consolidation, not a new feature.
- **Documents are the worst duplication in the codebase** — seven routes across
  \`/docs\`, \`/admin/docs\`, \`/supporting-docs\`, and \`/admin/supporting-docs\`.
- **\`/admin/config/address\` is the blocker for a \`projects\` row.** It owns the
  property record that \`projects.propertyId\` needs, and \`properties\` is empty on
  remote.
`;

fs.writeFileSync(
  "./docs/0041_homeowner_experience/PAGE_TRIAGE.md",
  md,
);
console.log(`wrote PAGE_TRIAGE.md — ${rows.length} routes, integrity check passed`);
console.log(byVerdict.map(([v, n]) => `  ${v}: ${n}`).join("\n"));
