# Workflow: Implement Feature

## Objective

Ship feature work by extending the existing single Cloudflare Worker systems in
place. Prefer current routers, agents, services, schemas, and workflows over
parallel implementations.

## Shared Steps

1. Read the relevant docs under `docs/` and update the feature spec before code
   changes when the request requires a shared agent handoff.
2. Inspect existing route, schema, service, agent, workflow, and frontend
   surfaces for the same domain.
3. Add D1 tables as one file per table under the closest existing schema
   namespace, export through that namespace index, then run
   `pnpm run db:generate`.
4. Register API changes on existing Hono routers with Zod validation and unique
   OpenAPI operation IDs.
5. Invoke Durable Objects and Agents through typed methods or native RPC. Do not
   route agent method calls through `stub.fetch(new Request(...))`.
6. Reuse shared Cloudflare service helpers before creating new clients.
7. Run focused lint/type/build verification and record any repo-wide baseline
   failures separately from feature-specific failures.

## Extension: Sourcing Deep Research

This extension covers `docs/0007_sourcing_deep_research/`.

### Phase 1 - Docs

1. Maintain `PRD.md`, `TASKS.json`, and `PROMPT.md` in
   `docs/0007_sourcing_deep_research/`.
2. Keep the action to endpoint contract explicit for frontend agents.

### Phase 2 - Schema

1. Add showroom sourcing tables under `src/backend/db/schema/showroom/`.
2. Re-export all new tables from `src/backend/db/schema/showroom/index.ts`.
3. Generate migrations with `pnpm run db:generate`; never hand-edit generated
   migration SQL.

### Phase 3 - Agent Orchestration

1. Extend `ShowroomResearchAgent` and `ResearchAgent`; do not build a parallel
   research worker.
2. Put sweep implementation details under
   `src/backend/ai/agents/ShowroomResearchAgent/methods/`.
3. Invoke agents via `getAgentByName(env.SHOWROOM_RESEARCH_AGENT,
   "showroom-research")` followed by a typed method call.
4. Route Gemini calls through the shared AI Gateway helper exported from
   `src/backend/services/render/providers/gemini-stage-provider.ts`.
5. Route Browser Rendering through
   `src/backend/ai/tools/browser-rendering.ts`.
6. Upload scraped image buffers through `ImageProcessorService`.
7. Embed synthesized summaries, warranty notes, and reviews into
   `RESEARCH_INDEX` with target metadata.

### Phase 4 - API Surface

1. Mount draft prompt and deep sweep actions on the existing research/showroom
   routers.
2. Use `@hono/zod-openapi` routes where new endpoints must appear in
   `/openapi.json`.
3. Return raw draft prompt strings for user review.
4. Return count-bearing sweep results for citations, sources, images, chunks,
   and warnings.

### Phase 5 - Autonomous Monitor

1. Use the existing scheduled handler and master tick instead of adding an
   unrelated scheduler.
2. Query D1 for category coverage and active homeowner rejections.
3. Trigger a new category sweep when coverage is empty or thin, or when mapped
   showrooms are rejected.
4. Append homeowner rejection notes as negative constraints in template literal
   prompt context.
5. Throttle automatic sweeps per category.

### Phase 6 - Verification

1. Run an agent invocation anti-pattern scan.
2. Run `pnpm run db:generate`.
3. Run `pnpm run cf-typegen`.
4. Run focused lint and build checks.

## Extension: Google Places Intake & Maps Usage

This extension covers the Google Places (New) autocomplete intake form and the
Google Maps API monthly-quota usage dashboard. It was implemented by **extending
existing infrastructure in place** — no parallel `showrooms` or `Maps_usage`
tables were created. See `.agents/rules/questionnaire-conventions.md` §8.

### D1 schema

1. `google_maps_usage_log` (`src/backend/db/schema/system/google-maps-usage.ts`)
   is the single append-only Maps usage log. It gained three nullable columns:
   `endpoint` (normalized sub-operation, e.g. `autocomplete`/`details`),
   `session_token` (Places Autocomplete session bundling), and `status_code`
   (upstream HTTP status). Columns are nullable so the legacy
   `logUsage(apiType, req, res)` callsites keep working. Migration:
   `drizzle/0055_glossy_hex.sql`. Do NOT add a second usage table.
2. The Showroom Intake Form writes to the existing `showroom_stores` table via
   `POST /api/showroom-stores`; it does not introduce a new showroom entity.
   `createStoreSchema` gained an optional `categoryIds: number[]` that the POST
   handler fans out into `showroom_store_category_mapping` rows.

### Service layer

1. `GoogleMapsService` (`src/backend/services/google/maps.ts`) is the single
   choke point for all Maps traffic. It owns the circuit breaker
   (`isUnderMonthlyQuota()` against `MAPS_MONTHLY_FREE_TIER_LIMIT = 10000`,
   counted month-to-date), the `getMonthlyUsage()` aggregate (grouped by
   `endpoint`, filtered with `strftime('%Y-%m', datetime(timestamp,'unixepoch'))`
   because `timestamp` is stored in Unix **seconds**), and the Places New
   proxies `placesAutocomplete()` / `placeDetails()`.
2. The Google Maps API key stays server-side (`getGoogleMapsApiKey(env)` →
   `env.GOOGLE_MAPS_API`). It is NEVER returned to the client. All Places calls
   go through the Hono proxy, and every call logs usage via
   `c.executionCtx.waitUntil(...)` so logging never blocks the response.
3. `placeDetails()` sends a strict, comma-joined `X-Goog-FieldMask`; extend that
   mask (never drop fields) when the intake form needs more data.

### API surface

1. `placesRouter` (`src/backend/api/routes/places.ts`) mounts at `/api/places`,
   gated by `requireAccessAuth`: `GET /autocomplete?q=&sessionToken=` and
   `GET /details/{placeId}?sessionToken=`. Quota trips return `429`; upstream
   failures return `502`.
2. `adminIntegrationsRouter` (`src/backend/api/routes/admin-integrations.ts`)
   mounts at `/api/admin/integrations` (already covered by the `/api/admin/*`
   auth middleware): `GET /usage` returns `{ month, limit, total_requests,
   percentage_used, by_endpoint, plan }` with `autocomplete`/`details` always
   present.

### Frontend

1. `ShowroomIntakeApp` (`src/frontend/components/showroom/intake/`) is a
   react-hook-form + zod island: debounced Combobox autocomplete → details →
   `mapPlaceToIntake` / `formatOpeningHours` / `inferCategoryLabels` mapper →
   fully editable review form → `POST /api/showroom-stores`. Mounted at
   `/admin/showroom/intake`.
2. `AdminIntegrationsUsageApp` (`src/frontend/components/admin/`) renders the
   two fixed quota rows (85% warn, 100% breaker) + a Monolith recharts summary,
   with a "Current Plan: Free Tier" badge. Mounted at
   `/admin/integrations/usage`.

## Extension: Brands, Showroom Icons & Overview Notes

Adds a brands taxonomy, auto-scraped favicons, showroom Instagram links, and a
PlateJS overview note. Everything extends existing infra in place. See
`.agents/rules/questionnaire-conventions.md` §9.

### D1 schema (migration `0056_lean_captain_america.sql`)

1. `showroom_stores` gained `instagram_url`, `icon_cf_images_url` (server-managed
   favicon), `overview_note_html`, `overview_note_markdown` (PlateJS dual
   serialization — HTML for render, Markdown as source of truth).
2. `showroom_store_products` gained a nullable `brand_id` FK → `brands.id`.
3. New `brands` domain (`src/backend/db/schema/brands/`): `brands`,
   `brand_types_def`, `brand_type_mappings` (unique `(brand_id, type_id)`;
   carries `brand_icon_cf_images_url` per the product spec, mirrored from
   `brands.icon_cf_images_url`), `showroom_brand_mappings` (unique
   `(showroom_id, brand_id)`). Cross-domain FK columns import the referenced
   table's LEAF file directly (`../showroom/stores`, `../brands/brands`), never
   the domain barrel, to avoid a circular module graph.

### Favicon service

`FaviconService` (`src/backend/services/favicon/`) is the single choke point for
brand/showroom icon extraction: `resolveFaviconUrl` (fetch HTML → parse
`<link rel~=icon>`/`apple-touch-icon`, fallbacks `/favicon.ico` then Google
`s2/favicons`) → `fetchIconBlob` (image-type + size guard) → upload via the
shared `ImageProcessorService.uploadToCloudflareImages` (creds from
`resolveCloudflareImagesCredentials`). `hydrateShowroomIcon` / `hydrateBrandIcon`
persist the delivery URL. It NEVER throws — it runs inside
`c.executionCtx.waitUntil(...)`, fired on showroom/brand create and on
website-URL change.

### API

1. `showroom-stores.ts`: create/update accept `instagramUrl`,
   `overviewNoteHtml`, `overviewNoteMarkdown` (icon is server-managed);
   `GET /:id` returns a `brands` array; `GET/POST /:id/brands` +
   `DELETE /:id/brands/:brandId` manage showroom↔brand mappings; products accept
   `brandId`.
2. `brandsRouter` (`src/backend/api/routes/brands.ts`, mounted `/api/brands`,
   auth-gated): brand-types CRUD (`/types`), brands CRUD, and brand↔type
   mapping (`/:id/types`). Website-URL changes trigger `waitUntil` favicon
   hydration.

### Frontend

1. `ShowroomCard` (in `ShowroomsDirectoryApp`) shows the favicon as its logo and
   a conditional Instagram link.
2. `StoreViewportApp` renders favicon + Instagram + the HTML overview note (with
   inline PlateJS edit → `PUT`) + showroom↔brand chips.
3. `ShowroomIntakeApp` adds an Instagram field + the overview-note editor.
4. `OverviewNoteEditor` (`src/frontend/components/showroom/`) is the shared
   PlateJS editor: seeds from Markdown, emits `{ html, markdown }` on change
   (`@platejs/markdown` serialize + a scoped markdown→HTML converter). Pins are
   exact (`@platejs/markdown`, `@platejs/basic-nodes`, `@platejs/list`).
5. `BrandsDirectoryApp` + `BrandTypesAdminApp` (`src/frontend/components/brands/`)
   at `/admin/brands` and `/admin/brands/types`.

## Extension: Showroom Visit Capture, Associations, Notes & Photos

Migration `0057`. Adds visit rating, business-card POC capture with AI
extraction, brand/product associations, titled rich notes, visit photos, a
URL-routed showrooms directory, and a bento viewport.

### D1 schema (0057)

- `showroom_stores`: `rating`, `rating_context_html`, `rating_context_markdown`
  (latest-visit; note the `store_rating` history table also exists).
- `store_notes`: `title`, `content_html`, `content_markdown` (PlateJS dual);
  `note` is now nullable; `is_active` soft-delete.
- `showroom_images`: `note_html`, `note_markdown` (polaroid-back note).
- NEW `showroom_pocs` (business-card front/back URLs + `extracted_json`),
  `showroom_product_mappings` (unique `(showroom_id, product_id)`).

### Services & API

- `BusinessCardService` (`src/backend/services/business-card/`): CF Images
  upload + Workers-AI VLM structured extraction of contact fields from card
  images (routed through AI Gateway). Reuse it — do not add a second card parser.
- `showroom-stores.ts` sub-routes: `PUT /:id/visit-rating`; POC
  (`GET /:id/pocs`, `POST /:id/pocs/extract-card` → upload+extract WITHOUT
  persisting, `POST /:id/pocs`); notes (`GET/POST /:id/notes`,
  `PUT/DELETE /notes/:noteId`); photos (`GET/POST /:id/photos`,
  `PUT /photos/:imageId/note`); product mappings
  (`GET/POST /:id/mapped-products`, `DELETE .../:productId`). `GET /:id` `brands`
  is the DISTINCT UNION of `showroom_brand_mappings` + mapped-products' `brandId`
  (each carries `source: "direct" | "product"`).
- `showroom-products.ts` (`/api/showroom-products/search?q=`) + brand
  autocomplete (`GET /api/brands?search=`) power the associate modals.

### Frontend

- Directory (`ShowroomsDirectoryApp`): URL-routed tabs
  (`/showrooms` → map default, `/showrooms/[tab]`), single-column cards, colorful
  list category-group icons, directory grouped by `hubName` with full `tel:`
  phone + conditional globe/IG. Coverage gaps moved to `/admin/showroom/gaps`.
- Viewport (`StoreViewportApp` + `store/[id]/[section].astro`): enriched hero
  (favicon, card info, visit rating) + action bar + URL-routed bento
  (`brands-products` / `notes` / `photos`). Self-contained components under
  `src/frontend/components/showroom/{visit,associate,notes,photos,bento}/`.
- Create endpoints return WRAPPED rows (`{ brand }`, `{ product }`) — consumers
  must read `resp.brand.id` / `resp.product.id`, never a top-level `id`.
