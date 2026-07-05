# Rebrand showroom→shopping, cleanup sidebar IA, fix navbar performance

## Context

Three related problems on the `/admin` area of the core-remodel app:

1. **Route rebrand.** The showroom sourcing suite lives under `/admin/showroom/*` with a landing page titled "Showroom Planner". The user wants it rebranded as the **shopping / sourcing** hub: URLs move to `/admin/shopping/*`, and the landing header becomes **"Sourcing and Shopping tools"**.
2. **Sidebar bloat.** `AppSidebar.tsx` renders ~40 links across 7 always-expanded admin sections plus a gallery group and a docs tree. It's a long scroll — bad on mobile — and has real redundancy/confusion (two "Products" pages, two "Floor Plan" links, "Research Center" vs "Deep Research", "Supporting Docs" filed under Photos, a dead `/admin/forecasting` link, "Shopping Journal" in the nav but absent from the landing hub).
3. **Navbar performance.** The sidebar is a `client:only="react"` island (BaseLayout.astro:37) with **no server-rendered HTML**. Its active-highlight is computed from `window.location.pathname` at mount (AppSidebar.tsx:392). Navigation is plain MPA full-page reloads with **no prefetch** (astro.config.ts has no `prefetch`/`ClientRouter`). Net effect: clicking a link "hangs" (waiting on SSR), and after the page paints, the sidebar re-downloads/hydrates and only *then* shows the correct highlight — seconds late.

Decisions locked with the user: **full `/admin/showroom/*` → `/admin/shopping/*` tree move**, **hub-and-spoke + collapsible sidebar**, **SSR-sidebar + prefetch** performance fix (no View Transitions).

> IMPORTANT: This touches **page routes only**. The API (`/api/showroom-stores/*`), the DB tables (`showroom_*`), and the React component folders (`components/showroom/*`) are **not** renamed. The just-built bulk-backfill feature keeps calling `/api/showroom-stores/*` unchanged.

---

## Part A — Route rebrand: `/admin/showroom/*` → `/admin/shopping/*`

### A1. Move the page files (Astro file-based routing)
- Rename directory `src/frontend/pages/admin/showroom/` → `src/frontend/pages/admin/shopping/` (all ~18 pages move: `schedule`, `gaps`, `intake`, `products`, `research`, `sourcing`, `compare`, `scan`, `progress`, `showrooms.astro`, `showrooms/[tab].astro`, `product/[id].astro`, `material/[id].astro`, `store/[id].astro`, `store/[id]/[section].astro`).
- Rename landing `src/frontend/pages/admin/showroom.astro` → `src/frontend/pages/admin/shopping.astro`.
- Move `src/frontend/pages/admin/shopping-journal.astro` → `src/frontend/pages/admin/shopping/journal.astro` (folds the journal into the hub, per the user's note that it was missing from the landing).
- Legacy plural route `src/frontend/pages/admin/showrooms/[id]/brands/[brandId].astro` stays where it is but its internal redirect target updates to `/admin/shopping/showrooms` (see A3).

### A2. Landing page (`admin/shopping.astro`)
- Change `<h1>` "Showroom Planner" → **"Sourcing and Shopping tools"**; keep/adjust the subheader.
- The `links` array (currently 11 cards) becomes the **hub-and-spoke home for all shopping tools**. Update every `href` to `/admin/shopping/*` and add the entries that are missing from the landing today: **Shopping Journal** (`/admin/shopping/journal`), **Coverage Gaps** (`/admin/shopping/gaps`), **Field Scan** (`/admin/shopping/scan`), **Compare** (`/admin/shopping/compare`), **Global Products** (`/admin/products`, labeled "All Products (Global)"), **Closet Research** (`/rooms/closets`), **Brand Types** (`/admin/brands/types`). This is what lets the sidebar stay short (Part B).

### A3. Update all internal references
Do a **careful** find/replace of the page-route prefix `"/admin/showroom"` → `"/admin/shopping"` across `src/frontend/**`, but only where followed by `/`, `"`, `` ` ``, or end-of-string — **must not** touch the plural legacy `"/admin/showrooms/..."`. Known reference sites (from exploration):
- `AppSidebar.tsx` nav hrefs (rewritten wholesale in Part B).
- `components/showroom/ShowroomsDirectoryApp.tsx` — tab links `/admin/showroom/showrooms/<tab>` and store links.
- `components/showroom/StoreViewportApp.tsx` (back → showrooms), `MaterialViewportApp.tsx` (→ schedule), `ProductViewportApp.tsx` (→ products), `CompareApp.tsx` (→ product/[id]).
- In-page `Astro.redirect(...)` targets inside the moved `store/[id]`, `store/[id]/[section]`, `product/[id]`, `material/[id]`, `showrooms/[tab]`, `sourcing.astro` pages, and the legacy `admin/showrooms/[id]/brands/[brandId].astro`.
- `components/showroom/ShoppingJournalApp.tsx` link to `/admin/research` stays (that's Research Library, unaffected).

### A4. Preserve old URLs with redirects
Add an Astro `redirects` map in `astro.config.ts` (no `redirects` key exists today) so bookmarks/prod links keep working:
```js
redirects: {
  "/admin/showroom": "/admin/shopping",
  "/admin/showroom/[...rest]": "/admin/shopping/[...rest]",
  "/admin/shopping-journal": "/admin/shopping/journal",
}
```
(Astro supports `[...rest]` param passthrough in redirects; `output: "server"` handles them at runtime on the Worker.)

---

## Part B — Sidebar cleanup: hub-and-spoke + collapsible

Rewrite the nav-item model in `AppSidebar.tsx`. Each section becomes a **collapsible group** (reuse the pattern already used for the Reference/Docs tree). **Only the section containing the active path is expanded by default** (computed from the SSR `currentPath` prop from Part C, so it's correct on first paint). Optionally persist open/closed per-section in `localStorage`.

### Proposed structure (recommended — open to your edits)

- **Mission Control** (`/`) — ungrouped, top.
- **Plan** — Live Floor Plan (`/measure`), Measurements (`/measurements`), Mood Boards (`/admin/planning/moodboards`), Decision Room (`/admin/planning/decision-room`).
- **Budget** — Budget Tracker (`/budget-tracker`), Triage Matrix (`/budget-dashboard`), Labor & Materials Costs (`/admin/truth-table`). *(drop dead `/admin/forecasting` link — page doesn't exist.)*
- **Contractors** — Companies (`/admin/companies`, newly surfaced), Estimates (`/admin/estimates`), Contracts (`/admin/contracts`), Bid Portfolios (`/bid-portfolios`), Schedule (`/admin/contractor-schedule`), Permits (`/admin/permits`), Prospect Dialer (`/admin/dialer`). *(Contractor Permits `/admin/permits/contacts` surfaces on the Permits page, not the sidebar.)*
- **Shopping & Sourcing** — hub link **Sourcing & Shopping tools** (`/admin/shopping`) + Showrooms (`/admin/shopping/showrooms`), Materials Schedule (`/admin/shopping/schedule`), Products (`/admin/shopping/products`), Shopping Journal (`/admin/shopping/journal`), Deep Research (`/admin/shopping/research`). *(Brands, Global Products, Compare, Field Scan, Coverage Gaps, Build Progress, Add Showroom, Brand Types, Closet Research live on the `/admin/shopping` hub, not the sidebar — this is the main length win: 12 → 6.)*
- **Photos & Renders** — Uploads (`/uploads`), Review (`/review`), Photo Edits (`/photo-edits`), Blank Canvas (`/admin/blank-canvas`), Renovation Studio (`/builder`), Render Gallery (`/gallery`).
- **Documents & Research** — Supporting Docs (`/admin/supporting-docs`), Project Records (`/supporting-docs`), **Research Library** (`/admin/research`, renamed from "Research Center" to disambiguate from Shopping's "Deep Research").
- **Home Tour** — Floor Plan (`/floor-plan`), Kitchen Layout (`/kitchen-layout`), Listing Photos (`/listing-photos`), Inspiration Photos (`/inspiration-photos`).
- **System** (collapsed by default) — Analytics (`/admin`), Integrations Usage (`/admin/integrations/usage`), Config (`/admin/config`).
- **Reference / Docs** — keep the existing collapsible docs tree.

### Redundancy/naming resolutions baked in (confirm or adjust)
- **Research Center → Research Library** (general) vs **Deep Research** (shopping-scoped) — keeps both, names them distinctly.
- **Two "Products":** sidebar "Products" = the sourced catalog (`/admin/shopping/products`); the global catalog (`/admin/products`) moves to the hub landing as "All Products (Global)".
- **Two "Floor Plan":** "Live Floor Plan" (`/measure`, interactive) under Plan; "Floor Plan" (`/floor-plan`, static tour) under Home Tour.
- **Supporting Docs** moves out of Photos into **Documents & Research**.
- **Dead `/admin/forecasting`** removed from the sidebar.

Result: collapsed, the sidebar shows ~10 section headers + Mission Control instead of ~40 links; the active section auto-expands.

---

## Part C — Navbar performance: SSR the sidebar + prefetch

### C1. Server-render the sidebar with the correct active item
- In `BaseLayout.astro`: change `<AppSidebar client:only="react" />` → `<AppSidebar client:load currentPath={Astro.url.pathname} />`.
- In `AppSidebar.tsx`: accept `currentPath: string` as a prop and use it instead of `useMemo(() => window.location.pathname, [])` (AppSidebar.tsx:392). Normalize the trailing slash. Keep the existing `hashchange` effect for `currentHash`.
- Verify no browser-only API is touched during render (today: `window` is only read in the guarded `useMemo` and inside `useEffect`s — safe under `client:load` SSR). The three mount fetches (`/api/images/mapping/summary`, `/api/access/status`, `/api/mood-board?shared=true`) stay in `useEffect` — they only hydrate badge counts and no longer gate the highlight.

**Effect:** the correct active item (and the correct auto-expanded section) is in the initial SSR HTML — no waiting for JS. Kills the "old highlight → late new highlight" lag.

### C2. Enable prefetch to kill the click "hang"
- In `astro.config.ts`, add `prefetch: { prefetchAll: true, defaultStrategy: "hover" }`. With `output: "server"` on Cloudflare, hovering/focusing a sidebar link prefetches the SSR HTML so the click navigates near-instantly. (`hover` is conservative; can switch to `viewport` if we want more aggressive prefetch. Mobile taps get a small head start via the browser's tap→navigate gap.)

*(View Transitions / `<ClientRouter/>` intentionally out of scope per the decision — bigger, riskier change.)*

---

## Critical files

| File | Change |
|---|---|
| `src/frontend/pages/admin/showroom/` → `admin/shopping/` | move whole dir (A1) |
| `src/frontend/pages/admin/showroom.astro` → `admin/shopping.astro` | move + rename header + expand hub links (A1, A2) |
| `src/frontend/pages/admin/shopping-journal.astro` → `admin/shopping/journal.astro` | move into hub (A1) |
| `astro.config.ts` | add `redirects` map (A4) + `prefetch` (C2) |
| `src/frontend/components/AppSidebar.tsx` | new collapsible hub-and-spoke IA (B) + `currentPath` prop (C1) |
| `src/frontend/layouts/BaseLayout.astro` | `client:load` + `currentPath={Astro.url.pathname}` (C1) |
| `components/showroom/{ShowroomsDirectoryApp,StoreViewportApp,MaterialViewportApp,ProductViewportApp,CompareApp}.tsx` | update `/admin/showroom` → `/admin/shopping` links (A3) |
| moved `store/[id]`, `product/[id]`, `material/[id]`, `showrooms/[tab]`, `sourcing.astro`, legacy `admin/showrooms/[id]/brands/[brandId].astro` | update `Astro.redirect` targets (A3) |

## Verification

1. `pnpm exec tsc --noEmit` (filtered to changed files) → clean; `node_modules/.bin/astro build` → server **and** client build succeed (the sidebar must SSR without a `window`-undefined crash under `client:load`).
2. Grep guard: `rg "/admin/showroom(/|\"|\`|$)" src/frontend` returns **zero** hits after the rewrite; confirm `"/admin/showrooms/"` (plural legacy) is untouched.
3. Run the app (`/run` skill or dev server) and click through: `/admin/shopping` shows "Sourcing and Shopping tools" with all tool cards incl. Shopping Journal; each moved page loads; old URLs (`/admin/showroom`, `/admin/showroom/showrooms`, `/admin/shopping-journal`) 301 to the new paths.
4. Perf check in the browser: on first paint of any `/admin/*` page the correct sidebar item is already highlighted (view-source shows it in SSR HTML), the active section is expanded, and hovering a link prefetches (Network tab shows the prefetch GET). Confirm mobile viewport: collapsed sidebar is short, only the active section open.
5. Regression: the bulk-backfill "Manage" modal still works on `/admin/shopping/showrooms` (its `/api/showroom-stores/*` calls are unchanged).

## Notes / follow-ups
- Deploy is via `pnpm run deploy` (build → migrate:remote no-op → wrangler deploy), same as before; no DB/migration changes here.
- This will be a large diff (dir move + link rewrite). Recommend committing Part A (rebrand) and Parts B/C (sidebar) as separate commits for reviewability.
