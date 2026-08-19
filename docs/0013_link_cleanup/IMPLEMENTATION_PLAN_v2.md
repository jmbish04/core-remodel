# Rebrand showroom→shopping, normalize admin routes, cleanup sidebar IA, fix navbar perf

## Context

Four related fixes to the `/admin` area of core-remodel:

1. **Showroom→shopping rebrand.** The sourcing suite under `/admin/showroom/*` (landing "Showroom Planner") becomes the shopping hub at `/admin/shopping/*`, landing header **"Sourcing and Shopping tools"**.
2. **Admin-route normalization (new, per user).** Invariant: **every page shown under an "Admin -" sidebar grouping must live under `/admin/`.** Today several don't — `/uploads`, `/review`, `/photo-edits`, `/builder`, `/gallery` (Photos), `/budget-tracker`, `/budget-dashboard` (Budget), `/bid-portfolios` (Contractors), `/measure`, `/measurements` (Planning). These move to `/admin/<slug>`. Pages under the **non-admin** groups ("Home", "Gallery", "Workspace") stay at root.
3. **Sidebar cleanup.** ~40 links across 7 always-expanded sections → collapsible hub-and-spoke IA (only the active section expands). Removes redundancy (two "Products", two "Floor Plan", "Research Center" vs "Deep Research", Supporting Docs mis-filed, dead `/admin/forecasting`, Shopping Journal missing from the hub).
4. **Navbar performance.** Sidebar is `client:only` (no SSR HTML), active-highlight computed client-side at mount, MPA nav with no prefetch → the "hang" + seconds-late highlight. Fix: SSR the sidebar with the server-known path + Astro prefetch.
5. **Dynamic sitemap (new, per user).** A sitemap built at runtime from the `pages/**` foldering (via `import.meta.glob`), like `/openapi.json` is built from routes — so it always lists every available URL and auto-reflects the reorg above.

Locked with user: full tree move, hub-and-spoke + collapsible, SSR-sidebar + prefetch (no View Transitions), **and** the admin-route normalization above.

> Scope guard: **page routes only.** The API (`/api/showroom-stores/*`), DB tables (`showroom_*`), and React component folders (`components/showroom/*`) are NOT renamed. The bulk-backfill "Manage" feature keeps calling `/api/showroom-stores/*` unchanged.

---

## Part A — Route moves (Astro file-based routing)

### A1. Showroom → shopping tree
- `pages/admin/showroom/` → `pages/admin/shopping/` (all ~18 pages: schedule, gaps, intake, products, research, sourcing, compare, scan, progress, `showrooms.astro`, `showrooms/[tab].astro`, `product/[id]`, `material/[id]`, `store/[id]`, `store/[id]/[section]`).
- `pages/admin/showroom.astro` → `pages/admin/shopping.astro` (landing).
- `pages/admin/shopping-journal.astro` → `pages/admin/shopping/journal.astro`.
- Legacy plural `pages/admin/showrooms/[id]/brands/[brandId].astro` stays; only its internal redirect target updates.

### A2. Normalize admin-grouped root pages → `/admin/<slug>` (NEW)
Move each single-file page (and the one companion dir):
| From | To | Group |
|---|---|---|
| `pages/measure.astro` | `pages/admin/measure.astro` | Plan |
| `pages/measurements.astro` | `pages/admin/measurements.astro` | Plan |
| `pages/budget-tracker.astro` | `pages/admin/budget-tracker.astro` | Budget |
| `pages/budget-dashboard.astro` | `pages/admin/budget-dashboard.astro` | Budget |
| `pages/bid-portfolios.astro` + `pages/bid-portfolios/new.astro` | `pages/admin/bid-portfolios.astro` + `pages/admin/bid-portfolios/new.astro` | Contractors |
| `pages/uploads.astro` | `pages/admin/uploads.astro` | Photos |
| `pages/review.astro` | `pages/admin/review.astro` | Photos |
| `pages/photo-edits.astro` | `pages/admin/photo-edits.astro` | Photos |
| `pages/builder.astro` | `pages/admin/builder.astro` | Photos |
| `pages/gallery.astro` | `pages/admin/gallery.astro` | Photos |

**Stay at root (non-admin groups):** `/` (Mission Control), `/floor-plan`, `/kitchen-layout`, `/listing-photos`, `/inspiration-photos` (Gallery), `/supporting-docs` (Workspace/Records). `/admin/*` pages already correct (planning/*, permits, contracts, estimates, truth-table, dialer, contractor-schedule, blank-canvas, supporting-docs, research, brands, products, companies, integrations/usage, config) are untouched.

**Flagged decision — `/rooms/closets` ("Closet Research", under Admin-Shopping):** the `/rooms/` namespace has siblings (`[slug].astro`, `beta/`, `closets.astro`). Default proposal: **move to `pages/admin/shopping/closets.astro`** (`/admin/shopping/closets`) to honor the invariant, with a redirect from `/rooms/closets`. Alternative: leave the URL and just link it from the shopping hub. Confirm on review.

### A3. Update internal references
Careful find/replace across `src/frontend/**` (counts are small — 1–5 refs each):
- Prefix `"/admin/showroom"` → `"/admin/shopping"` **only** when followed by `/`, `"`, `` ` ``, or end — must NOT touch plural `"/admin/showrooms/..."`.
- Each normalized root URL `"/uploads"`, `"/review"`, `"/photo-edits"`, `"/builder"`, `"/gallery"`, `"/budget-tracker"`, `"/budget-dashboard"`, `"/bid-portfolios"`, `"/measure"`, `"/measurements"` → `"/admin/<slug>"`.
- Known sites: `AppSidebar.tsx` (rewritten in Part B); `components/showroom/{ShowroomsDirectoryApp,StoreViewportApp,MaterialViewportApp,ProductViewportApp,CompareApp}.tsx`; `Astro.redirect(...)` targets inside the moved dynamic pages; the legacy `admin/showrooms/[id]/brands/[brandId].astro`.
- Also update the few **backend/out-of-frontend** refs (grep found: `/uploads`×1, `/measure`×2, `/review`×2 outside `src/frontend` — likely API redirects/email/QR); redirects (A4) backstop anything missed.

### A4. Redirects (preserve old URLs — bookmarks, QR codes, prod links)
Add a `redirects` map to `astro.config.ts` (none exists today; `output:"server"` runs them on the Worker):
```js
redirects: {
  "/admin/showroom": "/admin/shopping",
  "/admin/showroom/[...rest]": "/admin/shopping/[...rest]",
  "/admin/shopping-journal": "/admin/shopping/journal",
  "/uploads": "/admin/uploads", "/review": "/admin/review",
  "/photo-edits": "/admin/photo-edits", "/builder": "/admin/builder",
  "/gallery": "/admin/gallery", "/budget-tracker": "/admin/budget-tracker",
  "/budget-dashboard": "/admin/budget-dashboard", "/bid-portfolios": "/admin/bid-portfolios",
  "/measure": "/admin/measure", "/measurements": "/admin/measurements",
  // "/rooms/closets": "/admin/shopping/closets",  // if the flagged move is approved
}
```

### A5. Landing page (`admin/shopping.astro`)
- `<h1>` → **"Sourcing and Shopping tools"**.
- Expand the `links` array into the **hub-and-spoke home** for all shopping tools: rewrite hrefs to `/admin/shopping/*` and add the ones missing today — Shopping Journal (`/admin/shopping/journal`), Coverage Gaps, Field Scan, Compare, Global Products (`/admin/products`, "All Products (Global)"), Closet Research, Brand Types (`/admin/brands/types`).

---

## Part B — Sidebar cleanup: hub-and-spoke + collapsible (respects the `/admin` invariant)

Rewrite the nav model in `AppSidebar.tsx`. Each section = a **collapsible group** (reuse the existing docs-tree collapse pattern); **only the section containing the active path auto-expands** (computed from the SSR `currentPath` prop, Part C). Persist open/closed per-section in `localStorage` (optional).

**Admin groups — every URL under `/admin/*`:**
- **Plan** — Live Floor Plan `/admin/measure`, Measurements `/admin/measurements`, Mood Boards `/admin/planning/moodboards`, Decision Room `/admin/planning/decision-room`.
- **Budget** — Budget Tracker `/admin/budget-tracker`, Triage Matrix `/admin/budget-dashboard`, Labor & Materials Costs `/admin/truth-table`. *(drop dead `/admin/forecasting`.)*
- **Contractors** — Companies `/admin/companies`, Estimates `/admin/estimates`, Contracts `/admin/contracts`, Bid Portfolios `/admin/bid-portfolios`, Schedule `/admin/contractor-schedule`, Permits `/admin/permits`, Prospect Dialer `/admin/dialer`.
- **Shopping & Sourcing** — hub **Sourcing & Shopping tools** `/admin/shopping` + Showrooms `/admin/shopping/showrooms`, Materials Schedule `/admin/shopping/schedule`, Products `/admin/shopping/products`, Shopping Journal `/admin/shopping/journal`, Deep Research `/admin/shopping/research`. *(Brands, Global Products, Compare, Field Scan, Coverage Gaps, Build Progress, Add Showroom, Brand Types, Closet Research → on the hub landing, not the sidebar. 12→6.)*
- **Photos & Renders** — Uploads `/admin/uploads`, Review `/admin/review`, Photo Edits `/admin/photo-edits`, Blank Canvas `/admin/blank-canvas`, Renovation Studio `/admin/builder`, Render Gallery `/admin/gallery`.
- **Documents & Research** — Supporting Docs `/admin/supporting-docs`, **Research Library** `/admin/research` (renamed from "Research Center" to disambiguate from Shopping's "Deep Research").
- **System** (collapsed by default) — Analytics `/admin`, Integrations Usage `/admin/integrations/usage`, Config `/admin/config`.

**Non-admin groups — root URLs, user-facing:**
- **Mission Control** `/` (ungrouped, top).
- **Home Tour** — Floor Plan `/floor-plan`, Kitchen Layout `/kitchen-layout`, Listing Photos `/listing-photos`, Inspiration Photos `/inspiration-photos`.
- **Records** — Project Records `/supporting-docs`.
- **Reference / Docs** — keep the existing collapsible docs tree.

Collapsed, the sidebar is ~10 section headers + Mission Control instead of ~40 links; the active section auto-expands. Naming/dedup calls (Research Library vs Deep Research; Products vs All-Products-Global on the hub; Live Floor Plan vs Floor Plan) are proposals — adjust on review.

---

## Part C — Navbar perf: SSR the sidebar + prefetch

- **C1.** `BaseLayout.astro`: `<AppSidebar client:only="react" />` → `<AppSidebar client:load currentPath={Astro.url.pathname} />`. `AppSidebar.tsx`: take `currentPath: string` as a prop, drop `useMemo(() => window.location.pathname, [])` (line 392), normalize trailing slash, keep the `hashchange` effect. Verify SSR-safety (today `window` is only touched in the guarded memo + `useEffect`s — safe under `client:load`). The 3 mount fetches stay in `useEffect` (badge counts only; they no longer gate the highlight). → correct active item **and** correct expanded section in the initial SSR HTML.
- **C2.** `astro.config.ts`: add `prefetch: { prefetchAll: true, defaultStrategy: "hover" }` → hovering a link prefetches the SSR HTML, killing the click "hang". (View Transitions intentionally out of scope.)

---

---

## Part E — Dynamic sitemap (reflects page foldering, always complete)

Mirror the `/openapi.json` pattern (built dynamically from registered routes) but for **page routes**, derived from the actual `src/frontend/pages/**` file tree via Vite's `import.meta.glob` — so it can never drift: every deploy re-enumerates the folder structure. Together with `/openapi.json` (API routes) this gives full URL coverage (pages + API).

- **Shared builder** `src/frontend/lib/sitemap.ts` → `getSiteRoutes()`:
  - `const files = import.meta.glob('/src/frontend/pages/**/*.astro', { eager: false })` — use the **keys** (file paths) only; no module loading needed.
  - Derive each route from its path: strip `/src/frontend/pages` + `.astro`; `index` → parent (`/index`→`/`, `admin/index`→`/admin`); keep `[param]`/`[...rest]` segments and flag `dynamic: true` with the param names; skip `_`-prefixed files, `404.astro`, and the sitemap files themselves.
  - Return `{ path, file, dynamic, params[] }[]`, sorted, grouped by top folder segment.
- **`pages/sitemap.json.ts`** (`export const GET`) → JSON inventory of **all** routes (static + dynamic patterns flagged) — the machine-readable "always complete" list, the sitemap analogue of `openapi.json`.
- **`pages/sitemap.xml.ts`** (`export const GET`) → standard XML sitemap of the **static** (non-dynamic) URLs using the `site` config, for crawlers/tools.
- **`pages/sitemap.astro`** → human-readable page: the route tree grouped by folder (renders `getSiteRoutes()`), with dynamic routes shown as patterns. Uses `BaseLayout`.
- **Navbar link:** add `{ href: "/sitemap", label: "Sitemap" }` to the observability/docs link list in `components/Navigation.tsx` (next to OpenAPI Spec / Scalar / Swagger), per the cloudflare-jedi observability convention.

Note: API routes (`/api/*`) intentionally aren't in this sitemap — they're page-less Hono routes already enumerated by `/openapi.json`. The sitemap covers everything under `pages/` (the foldering), which is exactly what "reflect their foldering" means, and it will automatically show the post-reorg `/admin/*` structure.

---

## Critical files
- `pages/admin/showroom/` → `pages/admin/shopping/`; `admin/showroom.astro` → `admin/shopping.astro`; `admin/shopping-journal.astro` → `admin/shopping/journal.astro` (A1).
- Root→admin moves per the A2 table (10 pages + `bid-portfolios/new`).
- `astro.config.ts` — `redirects` map (A4) + `prefetch` (C2).
- `AppSidebar.tsx` — new collapsible hub-and-spoke IA (B) + `currentPath` prop (C1).
- `BaseLayout.astro` — `client:load` + `currentPath` (C1).
- `components/showroom/{ShowroomsDirectoryApp,StoreViewportApp,MaterialViewportApp,ProductViewportApp,CompareApp}.tsx` + moved dynamic pages' `Astro.redirect` targets (A3).
- `lib/sitemap.ts` (new), `pages/sitemap.{json.ts,xml.ts,astro}` (new), `components/Navigation.tsx` (add Sitemap link) — Part E.

## Verification
1. `pnpm exec tsc --noEmit` (changed files) clean; `node_modules/.bin/astro build` succeeds — **server + client** (sidebar must SSR without a `window`-undefined crash under `client:load`).
2. Grep guards after rewrite: `rg "/admin/showroom(/|\"|\`|$)" src/frontend` → 0; and none of the ten normalized root URLs (`"/uploads"`, `"/gallery"`, `"/measure"`, …) remain as links inside admin sidebar groups; plural `"/admin/showrooms/"` untouched.
3. Run app: `/admin/shopping` shows "Sourcing and Shopping tools" with all tool cards incl. Shopping Journal; every moved page loads at its new `/admin/*` URL; old URLs (`/uploads`, `/gallery`, `/measure`, `/admin/showroom/*`, `/admin/shopping-journal`, …) 301 to new paths.
4. Perf: view-source of any `/admin/*` page shows the correct highlighted item + expanded section in the SSR HTML (before JS); Network tab shows prefetch GET on hover; mobile viewport shows a short collapsed sidebar with only the active section open.
5. Regression: bulk-backfill "Manage" modal still works on `/admin/shopping/showrooms` (its `/api/showroom-stores/*` calls unchanged).
6. Sitemap: `GET /sitemap.json` lists every page route incl. the new `/admin/*` structure (dynamic routes flagged); `/sitemap.xml` returns valid XML of static URLs; `/sitemap` page renders the tree; adding/removing a page file and rebuilding changes the output with no code edits (proves it's dynamic). "Sitemap" link present in the nav.

## Notes
- Large diff (two dir moves + 10 page moves + link rewrite). Suggest 3 commits: (1) route moves + redirects, (2) sidebar IA, (3) perf. Deploy via `pnpm run deploy` (build → migrate:remote no-op → wrangler deploy); no DB/migration changes.
- One open item to confirm on review: the `/rooms/closets` → `/admin/shopping/closets` move (A2 flagged).
