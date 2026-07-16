# 0022 — UX Spec (for Claude AI Design)

**Read first:** this is the design contract for the GPS Showroom Drives & Visit Logs feature. Build against the **Monolith** design system already in this app: dark theme always (`<html class="dark">`), theme tokens only, **no traditional 1px borders** (use `ring-1 ring-border/40`, `divide-y divide-border/40`, `bg-card`), high-contrast Inter typography, shadcn/ui + Recharts (OKLCH chart palette). Every page has the `<Navbar />` + collapsible sidebar and is mobile-responsive. Data tables get sort + filter. Never use `window.alert/confirm/prompt` — use shadcn `Dialog`/`AlertDialog`. No mock data — everything binds to the real endpoints in PRD §7.

**Rich text everywhere:** all note fields use the existing **PlateJS** editor `OverviewNoteEditor` (`src/frontend/components/showroom/OverviewNoteEditor.tsx`), which emits `{ markdown, html }`. Persist **both**. Do not introduce a plain `<textarea>` for notes.

**Two device contexts to design for:**
- **Desktop / "back at the computer"** — triage + finalize. Dense, keyboard-friendly, the primary place logging gets *finished*.
- **On the road (Tesla center screen ~yy landscape, or phone portrait)** — big tap targets, one primary action per card, glanceable. The drive viewport and the Tesla buttons must be thumb-usable while parked.

---

## 0. Reusable components (build these first)

### `NavigateTeslaButton` (shared)
- Props: `{ storeId?, stopId?, slug?, lat?, lng?, address?, label? }`. Resolves a destination and POSTs `/api/tesla/navigate` (single) — see PRD §7.
- Visual: secondary shadcn `Button`, **Tesla "T" glyph** (reuse the inline `TeslaIcon` already in `DriveViewportApp.tsx`) + label "Tesla". Spinner while in flight; `toast.success("Sent to Tesla — starting navigation")` / `toast.error(...)`.
- **Only renders when Tesla is configured** (`GET /api/tesla/status` → `{configured}`). Lives beside the existing Google-Maps "Navigate" link, never replacing it.
- Used on: drive-list stop cards (already there — refactor to this shared component), showroom viewport action bar, showroom directory card (optional).

### `VisitStatusBadge`
- Maps `status` → chip: `TESLA_STAGED`/`AI_STAGED` → "Staged" (amber, dashed ring), `DRAFT` → "Draft" (muted), `SUBMITTED` → "Logged" (primary/solid). `TESLA_SOFT_ARRIVAL` type → tiny "GPS arrival" pill (car glyph).
- Also a `VisitTypeChip` for the `type` enum (walk-in / appointment / etc.) with plain-language labels (see microcopy §6).

### `VisitLogEditor`
- The finalize form used on the detail page, the drive-viewport slide-over, and the store-viewport modal. Fields: **Type** (segmented control), **Rating** (5-star, optional), **Arrival** / **Departure** datetime (prefilled when staged; departure editable), **Notes** (`OverviewNoteEditor` → markdown+html), **Contacts** (optional inline "log an in-person contact" → writes `showroom_store_contact_log` with `type=SHOWROOM_IN_PERSON` + `showroom_visit_log_id`). Save → `PATCH /api/showroom-visit-logs/:id`. "Save draft" (→ `DRAFT`) and "Submit" (→ `SUBMITTED`) are distinct actions.
- When opened on a `*_STAGED` row, banner: *"Prefilled from your Tesla — check and submit."* with the GPS provenance (arrival time, dwell if departure known, distance-from-store) shown as read-only evidence.

### `ShowroomAutocomplete` (with OTHER)
- Async lookup against showroom directory (reuse the search used in `ShowroomsDirectoryApp`/existing store search). Renders name + city.
- Last option is always **"➕ Other — not in my directory"**. Selecting it opens the existing new-showroom intake modal (`ShowroomIntakeApp` flow / `POST /api/showroom-stores` with a Place). On successful create, the returned `store_id` is bound back to the parent form and the field shows the new store as selected.

---

## 1. UPDATE — Showroom viewport (`StoreViewportApp.tsx`, `/admin/shopping/store/[id]/[section]`)

**Add a "Visits" bento section** (new `SectionKey: "visits"`, add to `VALID_SECTIONS` in the component and both `[id].astro` / `[id]/[section].astro`).

- **Visits section content:** vertical timeline of `GET /api/showroom-stores/:id/visit-logs`, newest first. Each row: date, `VisitTypeChip`, `VisitStatusBadge`, rating stars, a snippet of the note (rendered from `html`), dwell duration if arrival+departure known, and a small "via GPS" marker when `gps_source` is Tesla.
  - **PENDING rows** (non-`SUBMITTED`) float to the top under a "Needs finalizing (N)" subheader with a primary **Finalize** button → opens `VisitLogEditor` in a shadcn `Dialog` (or routes to the full-page finalize — either is fine; Dialog is faster for one-off edits).
  - **Empty:** "No visits logged yet. Record your first visit or turn on Tesla tracking to auto-stage them." + a "Record visit" button.
- **Action bar (existing latest-visit block, `StoreViewportApp.tsx` ~L1112–1169):** add `NavigateTeslaButton` next to the existing buttons. Keep "Record visit" (it now writes a `showroom_visit_log`, not just the snapshot).
- **Header badge:** if the store has ≥1 pending visit, show a small amber "· 1 to finalize" chip near the store title so it's visible without opening the section.
- **Staged-visit alert banner:** if the store has a `TESLA_STAGED`/`AI_STAGED` visit, show a prominent shadcn `Alert` at the top of the viewport — *"Complete your visit notes"* + the arrival date + a **Finalize** CTA that opens `VisitLogEditor` prefilled. This is stronger than the chip alone for the "GPS beat me to it, now fill it in" moment; show the banner **and** the chip.

## 2. UPDATE — Drive viewport (`DriveViewportApp.tsx`, `/admin/shopping/drives/[slug]`)

- **Active toggle (top of page):** a shadcn `Switch` labeled **"Driving this list"** near the title. On → `PATCH /api/drive-lists/:slug/active {active:true}` (server demotes any other active drive to `paused`; toast: *"Now your active drive — others paused"*). Off → `paused`. Show a subtle "Active" pill when on. This is the switch that gates the whole telemetry pipeline, so make its state unmistakable.
- **"Send drive to car" button (top):** `NavigateTeslaButton` variant labeled **"Send drive to Tesla"** → `POST /api/tesla/navigate-drive` with the slug. Sends **unvisited** stops as waypoints. Disabled with tooltip if 0 unvisited or Tesla not configured. After a stop is marked visited, the app re-sends remaining (silent) — surface a tiny "route updated" toast.
- **Mark-visited → record visit flow (the core friction win):** when the user taps a stop's circle to mark it **visited**, open a compact **record-visit slide-over** (`VisitLogEditor`) for that stop:
  - If a `TESLA_STAGED`/`TESLA_SOFT_ARRIVAL` row already exists for this stop (GPS beat them to it), **prefill** it and title the sheet *"Confirm your visit"* with the GPS evidence.
  - If not, it's a fresh `DRAFT` seeded with `timestamp_arrival = now`, store/drive/stop bound.
  - Actions: "Save draft" (keep it in the queue) or "Submit." Either way the stop stays checked. Never block the check-off on finishing the note — the note can be finished later in Visit Logs.
- **Per-stop `NavigateTeslaButton`** already exists — refactor to the shared component; no visual change.
- **Detour forks:** a discovery (HITL) tied to this drive renders as a distinct **dashed "detour" node** (reuse the optional-fork styling) labeled with the guessed name + a "Discovered — review" chip linking to the discoveries page.

## 3. NEW — Visit Logs workspace

### 3.1 List — `/admin/shopping/showrooms/visitlogs`
- **Nav:** add "Visit Logs" to the `shopping` group in `nav-groups.ts`.
- **Tabs:** `Pending` (default, first) | `Completed`. Pending = `TESLA_STAGED|AI_STAGED|DRAFT`; Completed = `SUBMITTED`. Counts in the tab labels.
- **Pending tab:** cards/table sorted by arrival desc. Each item: showroom name (or discovery name + "unregistered" tag), `VisitStatusBadge`, `VisitTypeChip`, arrival date, drive-list link if any, and a prominent **Finalize** action → detail page. Bulk-friendly: a compact table with sort + filter (by type, by drive, by store). Row click → detail.
  - **Empty pending:** a genuinely rewarding state — big check glyph, **"You're all caught up 🎉 No visits waiting to be logged."** subtext *"New visits will show up here after you drive with Tesla tracking on."* + secondary "Log a visit manually."
- **Completed tab:** same table, read-only rows, click → detail (view/edit). Filter by store, date range, rating.
- **Top-right:** primary **"+ New visit log"** → `/admin/shopping/showrooms/visitlogs/new`.
- **Loading:** skeleton rows. **Error:** inline alert with retry.

### 3.2 Detail / Finalize — `/admin/shopping/showrooms/visitlogs/[id]`
- Full-page `VisitLogEditor`. If the row is `*_STAGED` or `DRAFT`, fields are prefilled and the GPS-provenance evidence panel shows arrival/departure/dwell/distance + a mini map (reuse `DriveRouteMap`/MapLibre with one marker — no API key).
- Left: the form. Right (desktop) / below (mobile): evidence panel + "Other visits to this showroom" mini-timeline for context (catch inconsistent quotes).
- Sticky action bar: **Save draft** · **Submit** · (overflow) **Delete** (AlertDialog confirm). Submit transitions to `SUBMITTED`, updates the store snapshot per PRD Q1, and returns to the Pending list with a toast *"Logged — nice."*.
- If the visit is tied to a discovery (`hitl_queue_id`, unregistered), show a callout: *"This place isn't in your directory yet"* + **"Add it"** (→ intake, then rebinds the visit to the new `store_id`).

### 3.3 New — `/admin/shopping/showrooms/visitlogs/new`
- Full-page create form. **Showroom** field = `ShowroomAutocomplete` (with **OTHER** → intake modal, §0). **Type**, **Rating**, **Arrival** (default now) / **Departure**, **Notes** (PlateJS). Optional "attach to a drive list."
- Submit → `POST /api/showroom-visit-logs` (status defaults `DRAFT` unless "Submit" pressed → `SUBMITTED`).
- Guardrail: require either a selected store or a completed OTHER intake before submit.

## 4. NEW — Park-Scan Queue (HITL) — `/admin/shopping/showrooms/hitl`
> Naming: this is the **park-event auto-discovery** queue (places the car parked near). The on-demand **Discovery** search is a separate surface at `/discovery` (§4b) — don't conflate them.
- The proximity-scan review queue (`GET /api/showroom-hitl-queue?decision=TBD`). Nav item under `shopping` ("Park Finds", with a count badge when TBD > 0).
- Card per candidate: guessed name, category chip, distance/where (mini map marker), the drive it was found on, the AI one-liner, and any Places info. Actions: **Add to directory** (`PATCH …/:id {user_decision:PROCESS}` → runs intake, links `store_id`, toast *"Added — enriching in background"*) · **Not relevant** (`DO_NOT_PROCESS`, with an optional reason) · **Decide later** (leaves TBD).
- **Empty:** "Nothing new discovered. As you drive past remodel showrooms with tracking on, they'll collect here."
- This is where the "organic discovery" delight lives — copy should feel like *found treasure*, not a chore. Subtle count badge in nav so it's a pleasant surprise, not nagging.

## 4b. NEW — Discovery (worker-orchestrated search) — `/admin/shopping/showrooms/discovery`
The on-the-road "find me something nearby" surface. The AI *orchestrates* via `find_showrooms`; **the worker renders here** from D1 (`showroom_search` + `_revision` + `_result`). Nav item "Discovery" under `shopping`. **Both pages are realtime over WebSocket (§14.5)** — no manual refresh.

### 4b.1 Discovery list — `/discovery`
- Rows = discovery slugs, newest-first: title, timestamp, result count, **status badge** — `running` (live spinner), **`pending`** (ready but not yet finalized by the AI/user — the default for a fresh slug), `refining`, **`final`**, `error`. Revision number shown.
- **Realtime:** a slug started by voice **appears as a new row while the user is parked**; status/counts update live; a slug finalized or a result removed reflects instantly. No refresh.
- "+ New search" (near / current-location, radius, optional query, broad toggle). Click a row → the slug viewport.

### 4b.2 Discovery slug viewport — `/discovery/[slug]`
A **rich shadcn page modeled on the existing showroom directory listing** — a **map with markers** for every result, plus a directory-style card/list. Realtime: results appearing, being imported, or excluded animate in/out live.
- **Map** (MapLibre, no key): a numbered/typed marker per result; click a marker ↔ highlights its card; fit-bounds to the set; the search point marked distinctly.
- **Per-result card** (mirror the directory card UX): name; **type badge(s)** (from `primary_type`/`category_guess`); **hours badge** computed from `opening_hours_json` **relative to the search time** — `Open` / `Closing soon` / `Closed` / `Closed weekends` (so a 3:30pm search clearly shows the places that shut at 3pm or close at 4pm); **rating stars** + count when available; **phone** as a click-to-dial `tel:` chip; **full address** shown, **click-to-copy** (toast "Address copied"); **`NavigateTeslaButton`** (send to car); "open in Maps"; an `in-directory` pill when already registered.
- **Bulk import:** checkbox per result + a select-all; a sticky action bar "Import N to directory" opens the **same intake modal** the directory uses (pre-filled per selected place), creating stores; imported rows get an "In directory" state and drop out of the "new" set. Available to the AI too (`import_search_results`).
- **Exclude → not-interested:** a per-card "Not interested" action. **Requires confirmation per showroom** (prevent accidental) — the confirm dialog includes an **optional PlateJS reason** editor ("why exclude?"). On confirm → `showroom_exclusions` (reason markdown+html) and the row **disappears from the slug** live. Never a bare browser confirm — shadcn `AlertDialog` + embedded `OverviewNoteEditor`.
- **Refine controls** (top; also drivable by voice): exclude categories (multiselect), exclude specific stores, "hide ones already in my directory," radius, `usePlaces` toggle. Apply → `POST …/refine` (a **new revision** in place; status `refining`→`ready`). A **revision switcher** lets the user view prior revisions. Screen refine and voice refine stay in lockstep (both append revisions).
- **"Why isn't X here?"** an "Excluded (N)" disclosure lists results the worker auto-hid because they matched the not-interested list, each with the exclusion reason — so the answer is visible on-page too, not just via the model.
- **Header:** search params + `used_places`/quota note (e.g. "Places skipped — free tier reached") + point on the map.
- **Mobile / car:** glanceable, tappable at Tesla-screen width — the surface opened while parked mid-conversation.

## 4c. NEW — Not-interested list — `/admin/shopping/showrooms/exclusions` (or a tab on Discovery)
Simple managed table of `showroom_exclusions`: name, address, place_id, reason, category, source (manual/ai), date. Add (manual form) / remove. Copy: *"Places you've ruled out — they won't show up in Finder or discoveries again."* Small nav or a tab; low-traffic.

## 5. NEW — Tesla config — `/admin/config/tesla`
- Mirror `PropertyAddressConfigApp.tsx` inside `ConfigShell`; add to `config-nav.ts`.
- **Recording card:** big shadcn `Switch` **"Record Tesla telemetry"** (`tesla_record_telemetry`) with clear on/off helper: *"When on, your car streams location to this app while you drive. Turn it off to stop recording."* Include a live status line (last frame received, from `TESLA_DB`).
- **Home & Work card:** address inputs (`tesla_primary_residence_address`, `tesla_work_address`) with a resolved-coords confirmation ("📍 resolved"). Helper: *"When you park at home or work, your active drive is paused — the day's done."* A **"Use my permit project address as home"** shortcut.
- **Proximity card:** `Switch` "Discover showrooms I park near" (`tesla_proximity_scan_enabled`), radius inputs (proximity, home/work) with sane defaults and unit hints.
- Save = optimistic POST to `/api/admin/config` (array upsert). Toggles save immediately; toast on save.

---

## 6. Microcopy / voice (ux-copy)
Voice: **plain, dry, a little warm.** Never corporate. The user is the operator; talk to them like a competent partner.

| Surface | Copy |
|---|---|
| Empty pending queue | **"You're all caught up 🎉"** / "No visits waiting to be logged." |
| Staged banner | "Prefilled from your Tesla — check and submit." |
| Submit toast | "Logged — nice." |
| Active drive toast | "Now your active drive. Others paused." |
| Discovery approve | "Added to your directory — enriching in the background." |
| Discovery empty | "Nothing new discovered yet." |
| Tesla not configured (button hidden) | *(button simply absent — no dead UI)* |
| Send drive to car | "Sent {n} stops to your Tesla." |
| Home/work pause | "Parked at home — drive paused. See you tomorrow." |
| Type labels | Walk-in (quiet) · Walk-in (talked to sales) · Appointment · GPS arrival · Staged |

Star rating, dates, and distances use existing formatting utilities. Distances shown human ("~0.1 mi away"), not raw meters.

---

## 7. Responsive / on-the-road
- Drive viewport + `VisitLogEditor` slide-over must work at Tesla-screen width and phone portrait: single column, ≥48px tap targets, primary action pinned bottom, the star rating and type as big segmented controls (not tiny dropdowns).
- Visit Logs list collapses table → stacked cards on mobile.
- Test dark mode contrast on the car's bright screen — lean to higher contrast than desktop default.

---

## 8. Orchestration (how this design gets built)
This UX spec is handed to **Claude AI Design** to produce the screens in parallel with backend work. Flow:
1. The coding agent (backend) creates the schema + endpoints first (PRD §5–7) so the design has real contracts.
2. Claude AI Design builds screens from this file, section by section, reusing existing Monolith components. The **user reviews** iterations directly with the design agent.
3. When the user tells the design agent **"design approved,"** the design agent notifies the coding-agent orchestrator that the frontend is ready for implementation/rebuild against the live endpoints.
4. The coding agent rebuilds the approved screens as Astro + React islands wired to the real APIs (no throwaway HTML), matching AGENTS.md conventions.

Screens to deliver: (1) Visit Logs list [Pending/Completed/empty], (2) Visit Log detail/finalize [staged + fresh states], (3) New visit log [+ OTHER intake], (4) Discoveries queue [+ empty], (5) Tesla config, (6) Showroom viewport "Visits" section, (7) Drive viewport active-toggle + record-visit slide-over + send-to-car. Provide DATA / EMPTY / LOADING / ERROR states and a mobile variant for the drive + visit-log screens.
