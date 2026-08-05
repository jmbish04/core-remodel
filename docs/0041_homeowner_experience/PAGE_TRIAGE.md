# 0041 · Page triage — all 141 routes

> Generated from the mapping in `scripts/` and integrity-checked against
> `find src/frontend/pages -name '*.astro'`: every discovered route appears
> exactly once, nothing mapped that does not exist. Regenerating fails loudly
> if a route is added without a verdict.

## Verdicts

| Verdict | Count | Meaning |
|---|---:|---|
| **KEEP** | 48 | Survives as a route inside a public destination. |
| **COMBINE** | 36 | Route disappears — becomes a tab, panel, filter, mode, or action on another surface. |
| **OPERATOR** | 45 | Stays yours. Out of public navigation entirely. |
| **REMOVE** | 12 | No homeowner job, or a duplicate of a route that does the same thing. |

**84 routes are homeowner-facing.** Of those, **48 survive as routes** and **36 collapse into another surface** — a 43% reduction in public route count before a single screen is designed.

The other 45 stay as your back office, and 12 are duplicates or dead twins that should go regardless of this plan.

## Duplicates worth killing on their own merits

These are not triage opinions — they are two routes doing one job today:

- `/moodboards` — Duplicate of /admin/designs/moodboards. Two routes, one job.
- `/rooms/beta/[slug]` — A beta twin of the room page. Pick one; two is a trap.
- `/admin/products/` — Duplicate of /admin/shopping/products.
- `/admin/products/[id]` — Duplicate of /admin/shopping/product/[id].
- `/admin/planning/research` — Second research library. Same job as the above.
- `/admin/planning/research/[id]` — Duplicate detail route.
- `/docs/` — Public twin of /admin/docs.
- `/docs/[id]` — Duplicate detail route.
- `/docs/view/[slug]` — Third route into the same documents.
- `/supporting-docs` — Public twin of the above.
- `/admin/integrations/usage` — Duplicate of /admin/system/integration/usage.
- `/admin/config/tesla` — Duplicate of config/integrations/tesla.

## By destination

### Home

4 routes in, 1 out.

| Route | Verdict | Reason |
|---|---|---|
| `/` | KEEP | Device-routing root becomes the project diagram. |
| `/log/daily` | COMBINE | Becomes 'recent movement' on Home. No natural entry event of its own. |
| `/log/weekly` | COMBINE | Same feed at a different grain — a filter, not a route. |
| `/admin/shopping/progress` | COMBINE | Duplicates the whole-project read the diagram gives for free. |

### Vision

11 routes in, 8 out.

| Route | Verdict | Reason |
|---|---|---|
| `/questionnaire/` | KEEP | This IS the living brief intake. Becomes profile + axes. |
| `/questionnaire/[section_slug]` | KEEP | Section of the brief. |
| `/questionnaire/print` | COMBINE | An export of the brief, not a place. |
| `/admin/designs/decision-room` | KEEP | Partner alignment. Already the advocacy-quorum surface. |
| `/admin/designs/workshop` | KEEP | Concept development. |
| `/admin/designs/moodboards` | KEEP | Atelier-led. |
| `/admin/designs/moodboards/[slug]` | KEEP | One board. |
| `/photos/inspiration` | KEEP | Pre-commitment imagery belongs to the dream, not to sourcing. |
| `/admin/builder` | KEEP | Renovation Studio — render generation. |
| `/admin/gallery` | COMBINE | Render output belongs inside the studio that made it. |
| `/admin/prepare/blank-canvas/[...tab]` | COMBINE | A mode of the studio, not a separate destination. |

### Rooms

10 routes in, 6 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/designs/furnishings` | KEEP | Furnishing is per-room; it lives in the room. |
| `/rooms/[slug]` | KEEP | The room workspace. Comp C. |
| `/floor-plan` | KEEP | The house view; entry into a room. |
| `/kitchen-layout` | COMBINE | A single room's layout study hardcoded as a top-level route. |
| `/admin/planning/measure` | KEEP | Live floor plan / measurement capture. |
| `/admin/measurements` | COMBINE | Per-room data shown project-wide. Becomes a lens, not a route. |
| `/photos/listing` | COMBINE | As-is condition is a room attribute. |
| `/admin/shopping/schedule` | KEEP | The material schedule is the room's spec, renamed. |
| `/admin/shopping/material/[id]` | KEEP | A material belongs to exactly one room. |
| `/admin/shopping/closets` | COMBINE | One room type promoted to a route. |

### Out There

28 routes in, 19 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/shopping` | COMBINE | Hub page. The destination replaces it. |
| `/admin/shopping/sourcing` | COMBINE | Second hub page for the same cluster. |
| `/admin/shopping/showrooms` | KEEP | The showroom directory. |
| `/admin/shopping/showrooms/[tab]` | KEEP | Tabs of the directory. |
| `/admin/shopping/store/[id]` | KEEP | One store. |
| `/admin/shopping/store/[id]/[section]` | KEEP | Section of a store. |
| `/admin/shopping/store/[id]/inbox` | COMBINE | Store comms belong in the store's own sections. |
| `/admin/shopping/drives/` | KEEP | Drive lists. |
| `/admin/shopping/drives/[slug]` | KEEP | One drive. The in-car surface. |
| `/admin/shopping/showrooms/visitlogs` | KEEP | Visit capture. |
| `/admin/shopping/showrooms/visitlogs/[id]` | KEEP | One visit. |
| `/admin/shopping/showrooms/visitlogs/new` | COMBINE | A create action, not a destination. |
| `/admin/shopping/contacts` | KEEP | Showroom people. |
| `/admin/shopping/sales` | KEEP | Sales and clearance. |
| `/admin/shopping/intake` | KEEP | Capture. |
| `/admin/shopping/scan` | COMBINE | A capture mode, not a place. |
| `/admin/shopping/photo-intake` | COMBINE | Same — a capture mode. |
| `/admin/shopping/products` | KEEP | Product library. |
| `/admin/shopping/product/[id]` | KEEP | One product. |
| `/admin/shopping/brands/` | KEEP | Brand library. |
| `/admin/shopping/brands/[brandId]` | KEEP | One brand. |
| `/admin/showrooms/[id]/brands/[brandId]` | COMBINE | Brand-within-store; a filter of the brand page. |
| `/admin/shopping/wishlist` | KEEP | Parked ideas — park-before-commit made literal. |
| `/admin/shopping/journal` | COMBINE | A feed of capture events; belongs on the destination. |
| `/admin/shopping/compare` | COMBINE | Comparison is a mode over a selection, not a route. |
| `/admin/shopping/research` | KEEP | Deep research library. |
| `/admin/shopping/research/[id]` | KEEP | One research run. |
| `/admin/prepare/uploads` | KEEP | The upload window. |

### Needs You

10 routes in, 1 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/shopping/showrooms/hitl` | COMBINE | Park-finds review. A queue, not a place. |
| `/admin/shopping/photo-review` | COMBINE | Price-card review queue. |
| `/admin/shopping/product-photo-hitl` | COMBINE | Product-photo review queue. |
| `/admin/shopping/receipt-review` | COMBINE | Receipt review queue. |
| `/admin/prepare/review` | COMBINE | Photo review queue. |
| `/admin/shopping/gaps` | COMBINE | What is missing IS the queue. |
| `/admin/photo-edits` | COMBINE | Edit sessions awaiting a human. |
| `/admin/inbox` | COMBINE | One of three inbox routes. |
| `/admin/inbox/all` | KEEP | The unified inbox is the one that survives. |
| `/admin/inbox/gmail` | COMBINE | A source filter of the unified inbox. |

### Money

8 routes in, 4 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/budget/tracker` | KEEP | Committed vs paid vs exposed. |
| `/admin/budget/dashboard` | COMBINE | Triage matrix is a view of the tracker. |
| `/admin/budget/truth-table` | COMBINE | Labor and materials costs — a lens on the same data. |
| `/admin/budget/reconciliation` | KEEP | Reconciling receipts to plan is its own task. |
| `/admin/estimates` | KEEP | Estimates. |
| `/admin/estimates/new` | COMBINE | A create action. |
| `/admin/bids` | KEEP | Bid comparison. |
| `/admin/bids/new` | COMBINE | A create action. |

### Records

3 routes in, 1 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/docs/` | KEEP | Documents. |
| `/admin/supporting-docs` | COMBINE | Supporting docs are documents with a tag. |
| `/admin/notes/edit` | COMBINE | A note editor with no natural entry event. |

### Trade* *(deferred destination)*

5 routes in, 4 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/companies/` | KEEP | The professionals. |
| `/admin/companies/[id]` | KEEP | One company. |
| `/admin/services` | COMBINE | Service catalogue; an attribute of companies. |
| `/admin/contracts` | KEEP | Contracts — 0042 owns the intelligence on top. |
| `/bid/[token]` | KEEP | Vendor-facing share link. Its own surface, correctly. |

### Build* *(deferred destination)*

5 routes in, 4 out.

| Route | Verdict | Reason |
|---|---|---|
| `/admin/permits` | KEEP | Permits. |
| `/admin/permits/[permitIdentifier]` | KEEP | One permit. |
| `/admin/permits/contacts` | COMBINE | Permit people; belongs on the permit. |
| `/admin/pmo/schedule/contractor` | KEEP | Schedule. |
| `/admin/tasks` | KEEP | Tasks. |


## Operator surfaces (out of public navigation)

45 routes. Untouched by this plan — they remain
the operator back office, and `/admin/config/*` already lives behind its own
shell exactly as the project conventions require.

| Route | Reason |
|---|---|
| `/access` | Auth gate. Unchanged. |
| `/sitemap` | Dev navigation aid; no homeowner job. |
| `/admin` | Operator analytics. The public Home is net-new, not this. |
| `/admin/designs/floorplan-regions` | Region-drawing tooling. Setup, not use. |
| `/admin/docs/views` | Saved-view configuration. |
| `/admin/dialer` | Prospecting tool. No homeowner job. |
| `/admin/changelog` | Dev changelog. |
| `/admin/changelog/[slug]` | Changelog detail. |
| `/admin/changelog/[slug]/slides` | Slide view. |
| `/admin/changelog/blocks` | Block gallery. |
| `/admin/changelog/preview/` | Proposal index. |
| `/admin/changelog/preview/[slug]` | Proposal detail — this plan lives here. |
| `/admin/changelog/preview/[slug]/slides` | Slide view. |
| `/admin/plans/` | Plan board. |
| `/admin/plans/[slug]` | One plan. |
| `/admin/studio` | Component studio. |
| `/admin/studio/[slug]` | One component. |
| `/studio-runtime` | Studio runtime host. |
| `/admin/system/health` | Health probes. |
| `/admin/system/audit/` | Audit log. |
| `/admin/system/audit/[serviceSlug]` | Per-service audit. |
| `/admin/system/logs/` | Logs. |
| `/admin/system/logs/[serviceSlug]` | Per-service logs. |
| `/admin/system/agents/queue` | Agent run ledger. |
| `/admin/system/agents/queue/[id]` | One run. |
| `/admin/system/agents/failed` | Agent failures. |
| `/admin/system/agents/usage` | Agent cost. |
| `/admin/system/integration/usage` | Integration usage. |
| `/admin/mcp-ops` | MCP ops. |
| `/admin/mcp-ops/[...path]` | MCP ops detail. |
| `/admin/pmo/components` | PMO component inventory. |
| `/admin/pmo/operations` | PMO operations. |
| `/admin/config` | Config home. Correctly admin-gated already. |
| `/admin/config/address` | Property address — the flow that must create the properties row. |
| `/admin/config/brands/types` | Brand type vocabulary. |
| `/admin/config/device` | Device landing preferences. |
| `/admin/config/integrations/tesla` | Tesla integration. |
| `/admin/config/photo/categories` | Photo category vocabulary. |
| `/admin/config/photo/colors` | Colour vocabulary. |
| `/admin/config/photo/subcategories` | Photo subcategory vocabulary. |
| `/admin/config/showroom/store-types` | Store type vocabulary. |
| `/admin/config/tax` | Sales tax rates. |
| `/admin/config/usage` | Usage config. |
| `/connect/` | MCP connector docs. Public, but its own surface. |
| `/connect/tools` | Tool catalogue. |

## What this changes about the plan

- **The questionnaire is the living brief.** `/questionnaire/*` already collects
  what Vision needs. Phase 2 extends it into profiles and axes rather than
  building intake from scratch.
- **The review queues are already one queue, wearing seven URLs.** park-finds,
  price cards, product photos, receipts, photo review, gaps, and photo edits are
  all the same job. Needs You is a consolidation, not a new feature.
- **Documents are the worst duplication in the codebase** — seven routes across
  `/docs`, `/admin/docs`, `/supporting-docs`, and `/admin/supporting-docs`.
- **`/admin/config/address` is the blocker for a `projects` row.** It owns the
  property record that `projects.propertyId` needs, and `properties` is empty on
  remote.
