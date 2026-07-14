# 0018 — MCP showroom search (Google Places discovery)

**Status:** PLAN — for review, execute in the fresh MCP session/worktree. No code yet.
**Author:** Claude (cloudflare-jedi + mcp-builder)
**Date:** 2026-07-08
**Builds on:** 0015 MCP server + the existing showroom tools (`src/backend/mcp/tools/showrooms.ts`).

---

## 1. Objective

Give Claude an MCP tool that **kickstarts showroom discovery** by exposing Google Places text-search results. During a chat, Claude can search ("tile showrooms near San Francisco", "European kitchen cabinetry Bay Area"), review candidates with Justin, and then persist the chosen ones as showrooms via the existing `create_showroom` — so the agent drives the whole find → vet → add flow.

---

## 2. Reuse — the Places plumbing already exists

- **`GoogleMapsService`** (`src/backend/services/google/maps.ts`): monthly free-tier **quota gate** (`isUnderMonthlyQuota()`), **usage logging** (`google_maps_usage_log` / `logUsage("places:searchText", …)`), and `getGoogleMapsApiKey(env)` (secret `GOOGLE_MAPS_API`). Existing `/api/places/*` proxy shows the pattern.
- **`placesTextSearch(query)`** already calls `places:searchText` — BUT it is hardwired to `maxResultCount: 1` and returns only the top match (built for backfilling a known store). Discovery needs *many* candidates.
- **`showroomStores.placeId`** is a unique column → we can flag candidates already in the DB and avoid duplicates.

So this is mostly a thin MCP wrapper + one new multi-result service method.

---

## 3. What to build

### 3.1 Service: multi-result text search
Add `placesTextSearchMany(query, opts?)` to `GoogleMapsService` (or generalize `placesTextSearch` with a `maxResultCount` param — keep the existing single-result method working for backfill):
- POST `https://places.googleapis.com/v1/places:searchText`, `textQuery: query`, `maxResultCount: min(opts.maxResults ?? 10, 20)`, optional `locationBias`/`locationRestriction` from `opts.near` (a Bay-Area city name → geocode, or lat/lng), optional `includedType`.
- Field mask: `places.id, places.displayName, places.formattedAddress, places.rating, places.userRatingCount, places.nationalPhoneNumber, places.websiteUri, places.location, places.primaryType, places.types`.
- **Quota-gate** with `isUnderMonthlyQuota()` (throw `MAPS_QUOTA_EXCEEDED`) and **`logUsage(...)`** exactly like the existing method.
- Return an array of candidates.

### 3.2 MCP tools (extend `src/backend/mcp/tools/showrooms.ts`, category `"showrooms"`)

| Tool | Ann | Purpose |
|---|---|---|
| `search_showrooms` | R (openWorldHint:true) | Text-search Google Places for candidate showrooms. Args: `query` (required), `near?` (city / "lat,lng"), `maxResults?` (default 10, cap 20), `includedType?`. Returns candidates: `{ placeId, name, address, rating, userRatingCount, phone, website, primaryType, location, alreadyInDb, existingShowroomId? }`. Cross-references `showroomStores.placeId` so Claude can skip dupes. Surfaces `MAPS_QUOTA_EXCEEDED` clearly. |
| `import_showroom_from_place` | W (idempotent) | Convenience: create a showroom from a `placeId` (calls `placeDetails` to populate name/address/phone/website/hours/rating/socials + stores `placeId`). If a showroom with that `placeId` already exists, returns it (`created:false`). Otherwise inserts and returns `{ created:true, showroomId, url }`. |

`search_showrooms` is discovery (read/openWorld — it hits an external API). `import_showroom_from_place` is the one-step "add this one"; alternatively Claude can pass the returned fields to the existing `create_showroom`. Both follow the 0015 `defineTool` contract (hand-written Zod v4, annotations, examples).

---

## 4. Flow it enables

1. Justin: "find me stone/slab showrooms around San Francisco."
2. Claude → `search_showrooms({ query: "stone slab countertop showroom", near: "San Francisco, CA", maxResults: 12 })` → 12 candidates, dupes flagged.
3. They discuss; Justin picks 4.
4. Claude → `import_showroom_from_place` (or `create_showroom`) for each → rows exist, `placeId` stored (so later Places enrichment/backfill dedupes cleanly).
5. Downstream: `add_showroom_note`, `add_showroom_poc`, `link_brand_to_showroom`, etc. (0015) — and the existing sourcing/enrichment workflows can take it from there.

---

## 5. Guardrails
- **Quota:** every call gated by `isUnderMonthlyQuota()` + logged to `google_maps_usage_log` (cost attribution + the existing maps dashboard). If over quota → actionable `MAPS_QUOTA_EXCEEDED` message, no silent spend.
- **No new secret / binding / migration / DO** — reuses `GOOGLE_MAPS_API`, the maps service, and the existing `showroomStores` table. This one **needs no schema change**, so it has zero migration-numbering entanglement with the email `0083` / 0016 / 0017 trees.
- Auth: inherits the MCP connector's `remodel` scope (read for search, write for import).

---

## 6. Phasing
Single phase (~half a day): add `placesTextSearchMany`, add the two tools to `tools/showrooms.ts`, verify via Inspector/bearer (`search_showrooms` returns candidates with dupe flags; `import_showroom_from_place` creates + dedupes by `placeId`). Docs page (`/connect/tools`) auto-updates. No UI work.

---

## 7. Open questions
1. **`near` handling:** accept a free-text place ("San Francisco") and let Places bias by text, or require lat/lng / a Bay-Area-city pick from `bay_area_cities`? (Recommend: free-text `near` folded into the query + optional `locationBias` later.)
2. **Autocreate vs review-only:** keep `import_showroom_from_place` (one-step add) OR force everything through `create_showroom` for an explicit review step? (Recommend: offer both; `search_showrooms` is read-only so nothing persists without an explicit create/import.)
3. **Result cap / cost:** default 10, hard cap 20 per call — OK, or lower to protect quota?
