# Spec — Showroom Enrichment Pipeline (Phase 5)

Sitemap-driven crawl of a showroom's website to capture the whole page, confirm contact (phone/email/mailing address), hours, socials, and **extract all possible brands**, plus full-page screenshots + favicon. Triggered per store; runs on the `ShowroomResearchAgent` DO.

## Pipeline
`POST /api/showroom-stores/:id/enrich` → `ShowroomResearchAgent.enrichStore()`:
1. Load store from D1.
2. **Crawl** the site via Browser Rendering `/crawl` (sitemap-first, limit ~20, depth 2, async poll).
3. **AI triage** — pick the ~8 pages most likely to hold contact/hours/brands/about (Workers AI classifier over the crawled page list).
4. **Screenshot** each triaged page (Browser Rendering `/screenshot`, full-page) → upload to **Cloudflare Images** → insert `showroom_images` row with `imageKind: "page-screenshot"`.
5. **Extract** structured data per page via `/json` (JSON-schema: phone, email, address, hours{mon..sun,notes}, socials{instagram,facebook,pinterest,youtube,tiktok,linkedin,yelp,houzz}, brands[{name,url,confidence}]).
6. **Merge** extractions (first non-null wins for scalars; union + dedupe brands by lowercased name, keep highest confidence).
7. **Favicon** via `/content` HTML → parse `<link rel=icon>` (regex; no DOMParser in Workers) → download → upload to CF Images.
8. **Persist** fill-blanks to D1: `showroom_stores` (phone/email/address/hours_json/social_*/favicon_url/last_enriched_at) + `showroom_store_brands` rows.

## Schema changes
- `showroom_stores` (+): `favicon_url`, `hours_json`, `social_{instagram,facebook,pinterest,youtube,tiktok,linkedin,yelp,houzz}`, `last_enriched_at`.
- **new** `showroom_store_brands`: `id`, `storeId` (FK cascade), `brandName`, `brandUrl?`, `sourceUrl?`, `confidence` (0-100), `createdAt`; indexes on `storeId` + `brandName`.
- `showroom_images.imageKind` enum (+) `"page-screenshot"`.

## New Browser-Rendering helpers (`src/backend/ai/tools/browser-rendering.ts`)
- `crawlSite(env, url, opts)` — wraps `/crawl` init → poll → fetch (returns `{ jobId, status, pages[] }`).
- `screenshotPage(env, url, opts)` → PNG `ArrayBuffer`; `screenshotAndUpload(env, url, meta?, opts?)` → CF Images delivery URL.
- `fetchFavicon(env, url)` → `{ data, contentType, sourceUrl } | null` (regex parse + `/favicon.ico` fallback).

## Agent + API
- `enrichStore(input: EnrichStoreInput): EnrichStoreResult` `@callable()` on `ShowroomResearchAgent`, delegating to `methods/enrich-store.ts` (triage / merge / favicon-upload helpers colocated).
- Route `POST /:id/enrich` on the showroom-stores router → `getAgentByName(...).enrichStore(...)`.

## References (existing patterns to reuse)
CF Images upload (base64→FormData), `/snapshot`, `/json` JSON-schema extraction, `/content` HTML, `@callable()` + Workers-AI `kimi-k2.6` call — all in `browser-rendering.ts` / `ShowroomResearchAgent/methods/deep-sweep.ts`, plus `scripts/browser-render/*` (crawler bash, favicon.py, full-page screenshot py).

> The user provided a complete file-by-file handoff (signatures, JSON schemas, DB ops) — follow it when implementing; this is the condensed contract.
