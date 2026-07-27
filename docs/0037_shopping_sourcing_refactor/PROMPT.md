# 0037 — Build Prompt (copy-paste for the coding agent)

You are building **0037 Shopping & Sourcing Refactor + Shopping Concierge**. Read
`docs/0037_shopping_sourcing_refactor/IMPLEMENTATION_PLAN.md` and `DESIGN_SPEC.md` first.
Ship **one PR per phase**. Update `plan_tasks` (slug `shopping-sourcing-refactor`) as you go:
`in_progress` on pickup → `in_review` + prNumber on PR open → `done` on merge.

**Session start:** `pnpm run worktree:check` (must be 0 behind origin/main); prefer a fresh
worktree cut from origin/main per phase.

## Ground truth (verified files)
- Sidebar IA: `src/frontend/components/sidebar/nav-groups.ts:56-77`; item type + render:
  `src/frontend/components/sidebar/shared.tsx:12` (`SidebarItem`), `RenderGroup`/`NavLink`.
  Rail: `AdminSidebar.tsx:223` (hardcoded `w-64`). Hub landing: `pages/admin/shopping.astro:5-22`.
- Showrooms island: `src/frontend/components/showroom/ShowroomsDirectoryApp.tsx` (rebuild).
- Materials island: `src/frontend/components/materials/MaterialsScheduleApp.tsx` (rebuild).
- Brands: `components/.../BrandsDirectoryApp` + `BrandDetailViewport`; API `api/routes/brands.ts`
  (`GET /:id` at 793 already returns product lines + images), `api/routes/products-catalog.ts`.
- Gmail UI: `src/frontend/components/gmail/GmailInboxApp.tsx` (+ ThreadList/ThreadView).
- Gmail client: `src/backend/services/gmail/client.ts` — **has send, NO `drafts.create`** (add it).
- Agent template: `src/backend/ai/agents/showroom-scout/` + `mcp-bridge.ts` (reuse the
  `RemodelTool` registry in-process). Register in `_worker.ts` (~35-60) + `wrangler.jsonc` DO
  bindings (~357-420) + migration tags (latest `v16`; new agent = **`v17`**).
- MCP tools live in-repo at `src/backend/mcp/tools/<domain>/` (one file per tool).

## Rules that bite here
- **Nav change is additive** — `children?`/`icon?`/`href?` optional; don't break existing groups.
- **D1:** `db.batch()` (never `db.transaction()`); chunk `inArray`/multi-row inserts at 20.
- **FKs, never denormalized `*_name`** — JOIN for display; new sales-category is def+mapping tables.
- **Multi-select** = definition + mapping + `MultipleSelector`; **currency** = text + cents +
  `CurrencyInput`. See IMPLEMENTATION_PLAN §6 compliance table.
- **Structured output** on every AI call (JSON schema); return ids, validate against live set.
- **Astro shells:** `class` not `className`; mandatory header (icon+title+description); one island.
- **Email is draft-first** — agent stages Gmail drafts (labeled, thread-tracked); send is an
  explicit user action (individual or mail-merge). Never auto-send.
- **Migrations:** `pnpm run db:generate` → `pnpm run migrate:remote`; verify column exists.
- **Deploy is yours:** preview per PR (`pnpm run deploy:preview` + `test:pr <n> -- --preview`),
  and `pnpm run deploy` from main after merge. Delete preview on merge.

## Phase order
0. Sidebar nested tree + icons + larger text + collapse-to-rail (cookie) + re-authored shopping IA.
1. **Filter framework** — `filter_types` + `filter_definitions` + `<object>_filter_mappings`; AI
   classify service (full-defs-in, JSON schema `{matched_filter_ids, proposed_new_filters}`, validate
   ids, create missing types/defs, batch-map); config-driven `FilterRail`; `/admin/config/filters`;
   MCP classify tools. **+ currency compliance** (price_cents on wishlist_items + products, CurrencyInput).
2. Showrooms grouped table (design hand-off; DESIGN_SPEC §1) — sales category = `filter_type`.
3. Materials grouped table (DESIGN_SPEC §2) with per-group Products/Showrooms/Brands toggle; room_type/material_type via framework.
4. Brands & Products ecommerce grid (4a) → runway (4b follow-up) (DESIGN_SPEC §3); category subpages = `product_type` facets.
5. Shopping Journal look + Purchase Ops (Review dash, Invoices, Deliveries).
6. `ShoppingConciergeAgent` (AIChatAgent, v17) + Gmail `drafts.*` + label + `email_outreach_threads`.
7. Gmail inbox Drafts view (sparkle + mail-merge send) + MCP outreach tools.

**Filter framework rules:** definition + mapping (never a comma string, never polymorphic mapping —
one `<object>_filter_mappings` per surface with real FKs). AI classify uses `response_format`
json_schema, returns PKs (+ optional new-filter payloads), worker validates every returned id
against the live set before mapping, mints PKs for approved new defs, then `db.batch` maps (chunk 20).

Each phase: QC script `scripts/qc/pr_<n>.mjs` run on preview **and** prod, changelog entry with
real output pasted, `plan_tasks` advanced, `tsc --noEmit` diff clean.
