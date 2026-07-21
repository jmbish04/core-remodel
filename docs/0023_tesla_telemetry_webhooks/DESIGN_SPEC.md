# DESIGN_SPEC — 0023 Tesla Telemetry Webhooks (frontend surfaces)

Significant frontend; build in collaboration between **Claude AI Design** + the Claude Code agent.
All pages follow the mandatory shell rule (`<BaseLayout>` → `<main class="container mx-auto px-4 py-8
pb-12">`, a header block with a 24px lucide icon, `class` **not** `className` in `.astro` shells),
canonical example `src/frontend/pages/admin/studio.astro`.

## Pages / islands

1. **`/admin/config/tesla`** (ConfigShell) — master recording Switch, home/work address inputs
   (geocoded, show resolved coords), proximity radii, location-stale seconds. Mirror
   `PropertyAddressConfigApp.tsx` inside `ConfigShell`; add a `config-nav.ts` entry. Add a
   "primary residence" toggle to the permit address config so home coords are shared, not re-entered.

2. **Visit Logs workspace**
   - `/admin/shopping/showrooms/visitlogs` — Pending | Completed tabs, sort/filter, an "all caught up"
     empty state.
   - `/admin/shopping/showrooms/visitlogs/[id]` — full-page finalize: `VisitLogEditor` (reuses
     `OverviewNoteEditor`/PlateJS → markdown+html), GPS evidence panel + mini map + other-visits
     timeline, save-draft / submit / delete.
   - `/admin/shopping/showrooms/visitlogs/new` — `ShowroomAutocomplete` with **OTHER** → new-showroom
     intake modal → bind `store_id`.
   - Shared `VisitStatusBadge` + `VisitTypeChip`. Store viewport gains a **Visits** bento section with
     a PENDING badge + one-click Finalize, plus a "Complete your visit notes" alert for `*_STAGED` rows.

3. **Park-Finds (HITL) page** — `/admin/shopping/showrooms/hitl`: park-event auto-discoveries;
   approve → intake / reject / decide-later; nav item with a TBD count.

4. **Discovery finder** (realtime)
   - `/admin/shopping/showrooms/discovery` — list with status/pending/final badges + revision.
   - `/admin/shopping/showrooms/discovery/[slug]` — rich viewport: MapLibre markers, per-result
     type/hours(open/closing-soon/closed)/rating badges, click-to-dial (`tel:`), click-to-copy address,
     `NavigateTeslaButton`, checkbox bulk-import (intake modal), exclude with per-item AlertDialog +
     optional PlateJS reason, revision switcher, refine controls, "Excluded (N)" disclosure.
   - Both pages are **WebSocket-realtime** (a voice-kicked search appears live; revisions swap in place;
     imported/excluded rows disappear live). Car-friendly layout.
   - `/admin/shopping/showrooms/exclusions` — managed not-interested table with add/remove.

5. **Drive viewport** (`/admin/shopping/drives/[slug]`) — Active/Paused toggle Switch (single-active);
   mark-visited opens a `VisitLogEditor` slide-over (prefill staged; never blocks check-off); detour
   forks rendered as dashed "discovered" nodes linking to discoveries.

6. **Admin usage / safety** — extend `/admin/integrations/usage` (`MapsUsageSection`): per-API Google
   buckets + remaining free quota + a per-API **blocked** badge; a **DO circuit-breaker** status panel
   (tripped state + reason + clear button), reusing the existing "Circuit breaker" badge styling.

7. **Reusable `NavigateTeslaButton`** — status-gated (renders only when `/api/tesla/status` is
   configured); used on drive stops and the showroom viewport action bar.
