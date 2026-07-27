# 0038 — Sales & Clearance Overhaul · Coding-agent PROMPT

You are implementing feature **0038 sales-clearance-overhaul** in the
core-remodel Cloudflare Worker (Astro SSR + Hono + Drizzle/D1 + Agents SDK +
Browser Rendering). Read `IMPLEMENTATION_PLAN.md` and `DESIGN_SPEC.md` in this
folder first. Follow every rule in the repo `CLAUDE.md` (D1 `batch()` not
`transaction()`, chunk inserts at 20, FK-not-name, currency text+cents,
multi-select def+mapping, structured-output JSON schema, page-styling, changelog
+ QC + preview discipline). **Ship one PR per phase.**

## Session start (mandatory)
1. `pnpm run worktree:check` — confirm 0 behind `origin/main`. If behind, rebase
   or cut a fresh worktree.
2. Read the MCP ops backlog (open issues) before Worker work.
3. Pull the live plan tasks: `get_feature_proposal` / `GET /api/admin/plans/sales-clearance-overhaul`. Mark each task `in_progress` when you pick it up, `in_review` + `prNumber` at PR, `done` at merge — via `update_plan_task`.

## Ground truth (do not rebuild these)
- Scrape: `src/backend/services/showroom/sales.ts` (`sweepShowroomSales`).
- Browser Rendering: `src/backend/ai/tools/browser-rendering.ts`
  (`scrapeUrl`, `extractJson`, `capturePdf`, `uploadPdfToR2`, `extractLinksFromHtml`).
- Structured output: `src/backend/services/structured-output.ts`, `utils/ai-json.ts`.
- Schema dir: `src/backend/db/schema/showroom/` (`sales.ts`, `stores.ts`,
  `links.ts` WEBSITE_CLEARANCE, `scan_log.ts`, `price_observations.ts`).
- API: `src/backend/api/routes/showroom-sales.ts` (`showroomSalesRouter`).
- Frontend: `src/frontend/pages/admin/shopping/sales.astro`,
  `src/frontend/components/showroom/sales/SalesApp.tsx`.
- Email: `src/backend/services/email/*`. Cron: `src/_worker.ts` scheduled.

## Phase A — schema + migration + backfill
- New Drizzle tables in `db/schema/showroom/`: `sale_cycles`, `sale_items`,
  `sale_item_images`, `sale_item_colors`, `sale_watch`, `sale_scrape_runs`,
  `weekly_sale_ad`; `colors` definition (if not already present); verify/create
  shared `categories`/`subcategories`. Add `is_online_only` to `showroom_stores`
  and `page_markdown` to `showroom_store_sales`. Columns per the ERD in the plan.
- Prices as `*_text` + `*_cents`. Rich text as `*_markdown` + `*_html`. FKs only,
  no denormalized names. `barrel` exports in the schema `index.ts`.
- `pnpm run db:generate`; **read the generated SQL** (strip non-delta if the
  snapshot is behind); `pnpm run migrate:remote`; verify columns exist on remote.
- Backfill: read every `showroom_store_sales.clearanceDetailsJson.items[]` →
  insert `sale_items` (+ images from item urls, + colors, + prices text/cents).
  Chunk at 20, `db.batch()`. Assert backfilled row count == source item count.

## Phase B — scrape upgrade + change-detection
- In `sweepShowroomSales`: open a `sale_cycles` row (status=running). Per
  `WEBSITE_CLEARANCE` link: **plain worker `fetch` of the HTML** to pull product
  image `src`s (`extractLinksFromHtml`/regex over `<img>`), PLUS Browser Render
  markdown (store on `showroom_store_sales.page_markdown`).
- Structured-extract into `sale_items` with a **lenient** JSON schema (required-
  ish: brand/product_line/model/sku but never hard-fail; capture color(s),
  size, original/sale/discount/shipping, deal terms, condition — floor
  model/open box/open package/return, warranty, qty, damage notes). Return
  **ids** for category/subcategory/color from the live vocab; validate before
  insert; unmatched → null FK + keep `_text`.
- **Categorization reliability (grouping depends on it):** two-pass classify —
  if pass 1 leaves an item uncategorized, run a cheap second classify over just
  those items; still unknown → group under **brand**, not a generic bucket. If
  a page's uncategorized rate > ~30%, flag the run `low_quality` on
  `sale_scrape_runs` (surfaced on Sale Scan Health). New types create a
  subcategory via the definition-create path.
- Map images → `sale_item_images` (raw src, no CF Images).
- **Diff** vs prior cycle by `match_key` (url→sku→brand+model): set
  `change_status` (new/unchanged/price_drop/qty_down/color_gone/gone/back),
  `prev_sale_price_cents`, `is_current`.
- Write `sale_scrape_runs` per source (ok/empty/no_new/failed + error_text +
  duration). Close `sale_cycles` (status=scraped, counts).

## Phase C — shopping intelligence: cost-aware triage (broad, reusable)
**Money is the constraint. Deep research is $2–7/run — never per item.** Three tiers:
- **Tier 0 — `SaleTriageOrchestrator`** (one structured AI call over the cycle's
  NEW unreviewed items): cluster by brand+category; route each item/cluster to
  `skip | group_surface | item_surface | deep_candidate` using price threshold +
  category complexity + per-cycle deep budget. Cheap commodity items are grouped
  so ONE surface pass covers the cluster (`sale_research_clusters`).
- **Tier 1 — surface pass** (`PersonalizedShoppingAgent` DO, quick `web_search` +
  `browser_render` + `get_sale_item`): produces `deal_score` + insight AND a
  `recommendation{ needs_deep, reason, search_plan[], confidence }`. Group passes
  fan one summary out to each item's insight. **Every item gets an insight.**
- **Tier 2 — deep research** (reuse existing `ProductResearchWorkflow` /
  `backend/ai/deep-research`, do NOT rebuild): runs ONLY when
  `needs_deep && sale_price_cents ≥ deep_research_min_price_cents && cycle
  deep-runs < deep_research_per_cycle_budget`. Over budget / under threshold →
  keep surface insight, set `research_reason="deep suggested but gated"` and
  expose a manual-trigger affordance (MCP `score_sale_item` / button).
- Infra: `SHOPPING_QUEUE` (producer enqueues the tasks the orchestrator picked,
  per cluster or standout item); `ShoppingScoreWorkflow` (durable steps: surface
  → conditional deep → write); `PersonalizedShoppingAgent` DO generic
  `ShoppingTask{ intent, subject, budget?, constraints[] }`, `intent="deal_surface"`.
  Bump DO migration tag; export DO + workflow in `src/_worker.ts`.
- Write `deal_score`, `deal_savings_cents`, `deal_insight_markdown/_html`,
  `deal_scored_at`, `research_tier`, `research_confidence`, `research_reason`,
  `research_cluster_id`, `deep_research_ref`. Config thresholds start as constants
  (`surface_min_price_cents=15000`, `deep_research_min_price_cents=150000`,
  `deep_research_per_cycle_budget=5`, `high_complexity_categories[]`). **Log every
  skip + budget-gated escalation.** Close cycle (status=scored).

## Phase D — weekly PDF ad + delivery
- `WeeklyAdWorkflow`: after status=scored, render an **HTML ad template**
  (same data as frontend) → `capturePdf` → `uploadPdfToR2` → `weekly_sale_ad`
  row (pdf key, summary md/html, top_finds_json, failed_sites_json, counts).
- Sections: intro, per-store spreads, price-drops, sold/gone, **nothing-new**
  state, **failed-scrape "check manually"** list.
- Notification on the sales page (`ad/latest`). Email overview + top finds + PDF
  attached via email service; empty-cycle still emails.

## Phase E — frontend
- Rework `SalesApp.tsx` into `view: 'stores' | 'store'` + product modal + right-
  side filter **Sheet** (only in store view, only on filter-button click; no
  sidebar collapse). Build store cards, grouped item cards (group by type),
  product modal (image carousel + lightbox + external link + Watch / Not-
  interested), weekly-ad banner, watch-list callouts.
- New page `/admin/shopping/sales/scan-health` ("Sale Scan Health") — per-source
  table + manual add-clearance-URL (map existing store or create online-only).
- Wire the provided reference components (`AISalesTrackerApp`,
  `StoreSalesDetailApp`) to real endpoints; swap raw primitives for repo Base-UI
  shadcn. Image `onError` → fallback icon.

## API + MCP + docs (across phases)
- Endpoints per plan §8 on `showroomSalesRouter`. Zod v4 hand-written schemas.
- New MCP `tools/sales/` domain (one file per tool) + registry + `/connect/tools`.
- Changelog branch + entry + detail page (Mermaid) + verification block per PR.
- QC `scripts/qc/pr_<n>.mjs`; run `--preview` and prod; paste output into PR +
  changelog. `pnpm run deploy:preview`; migrate remote; delete preview on merge.

## Definition of done
Each phase: PR opened, review bot addressed, QC green on preview + prod
regression, changelog updated, plan task → done+PR. After merge to main:
`pnpm run deploy` (or Deploy manual Action), verify deployment + migrations,
state what shipped.
