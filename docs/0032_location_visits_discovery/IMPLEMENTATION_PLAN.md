# 0032 — Location-Source-Agnostic Visits & Discovery

**Status:** Planning → ready to review
**Owner:** Justin (product), coding agent (implementation)
**Preview changelog:** https://core-remodel.hacolby.workers.dev/admin/changelog/preview/0032-location-visits-discovery
**Supersedes the ingest framing of:** `0022_gps_showroom_drives` (P1–P7), `0023_tesla_telemetry_webhooks` (the streaming-DO-first execution)
**Cross-references (do NOT duplicate):** `0031_drive_list_ops` (drive-sheet UX — separate track), `docs/plans/2026-07-21-drive-visit-state-machine.md` (`tesla_park_sessions` — folded in here)

> **The reframe in one sentence.** 0022/0023 built the visit-capture & discovery vision *on top of* a billable 500 ms Tesla streaming Durable Object. This plan **decouples every user-facing feature from the stream** by introducing a normalized location ingress that any source can feed — a Tessie poll, a phone GPS ping, an AI agent supplying coordinates, or (optionally) the streaming DO — and hangs the whole pipeline off *that*. The stream becomes one optional "fast-path" source, not a dependency.

---

## 1. Why this plan exists

The user's directive: **de-emphasize the streaming DO; make the features around it work with just Tessie polling, phone location, or an AI agent supplying GPS coordinates every so often.**

The good news, confirmed by reading the specs *and* the shipped code: **almost nothing actually needs the stream.** Exactly one step is stream-coupled — automatic *park/drive-away detection* — and even 0022 already routes webhook `drive_state` events through the same comparator. Everything downstream (the decision tree, two-row staging, proximity discovery, the finder, visit/contact CRUD, "what's near me", nav, config) operates on a single `{lat, lng, timestamp, shiftState?}`.

```mermaid
flowchart LR
    subgraph TODAY["What 0022/0023 assumed"]
      S0[500ms TeslaStreamDO<br/>outbound WebSocket<br/>DURATION-BILLED] --> DET0[shift-state transition<br/>detection]
      DET0 --> PIPE0[park pipeline →<br/>visits / discovery / nav]
    end
    subgraph GOAL["What 0032 builds"]
      A[tessie-poll<br/>120s, live] --> ING[[ingestLocationFix<br/>normalized ingress]]
      B[phone GPS<br/>device_location - EXISTS] --> ING
      C[ai-supplied coords<br/>report_location] --> ING
      D[manual - I am here] --> ING
      E[tessie-stream DO<br/>OPTIONAL fast path] --> ING
      ING --> DET[source-agnostic<br/>park/dwell detector]
      DET --> PIPE[same park pipeline →<br/>visits / discovery / nav]
    end
    classDef bill fill:#4a1d2b,stroke:#fb7185,color:#ffe8ee
    classDef exist fill:#1f4d2e,stroke:#4ade80,color:#e8ffe8
    class S0 bill
    class B,A exist
```

---

## 2. Current state — what's already built (verified in-repo)

Legend: 🟢 shipped · 🟡 partial/diverges from spec · 🔴 absent.

```mermaid
flowchart TD
    subgraph SRC["Location sources"]
      P1["🟢 Tessie poll<br/>getLocation / getVehicleState<br/>services/tesla.ts"]
      P2["🟢 Phone/browser fix<br/>device_location table +<br/>POST /device-location"]
      P3["🟢 Telemetry frames<br/>teslaTelemetryEvents (TESLA_DB)"]
      P4["🟢 MCP get_vehicle_location /<br/>get_user_location (best of both)"]
      P5["🔴 AI-supplied coords ingress"]
    end
    subgraph DET["Detection + pipeline"]
      D1["🟢 poller drives matchAndMarkVisited<br/>tesla-poller.ts (120s)"]
      D2["🟢 stream DO drives stage/finalize<br/>tesla-stream.ts"]
      D3["🟡 park→soft / drive-away→staged<br/>visit-sessions.ts (no dwell heuristic)"]
      D4["🔴 unified source-agnostic detector"]
      D5["🔴 proximityScan service (1.d)"]
    end
    subgraph DATA["Data model"]
      T1["🟡 showroom_visit_log<br/>SUBSET of 0022 §5.1"]
      T2["🔴 showroom_store_hitl_queue"]
      T3["🔴 showroom_search / _revision / _result"]
      T4["🔴 showroom_exclusions"]
      T5["🟢 device_location · drive_lists(isActive) · showroom_gaps"]
      T6["🟡 drive_list_stops: kind/suggested/skipped<br/>(no is_detour / hitl_queue_id)"]
    end
    subgraph UI["Surfaces"]
      U1["🔴 Visit Logs workspace"]
      U2["🔴 Park-Finds / HITL page"]
      U3["🔴 Discovery finder pages"]
      U4["🟡 /admin/config/integrations/tesla<br/>(creds+consent; no home/work/radii)"]
      U5["🟢 discovery primitives: whats_near_me,<br/>find_known_showrooms, ShowroomScout"]
    end
```

**Key reusable assets already in the repo** (build on, don't rebuild):
- `services/tesla.ts` — `getLocation`, `getVehicleState`, `sendNavigation`, `tessieConfigured`.
- `device_location` table + `POST /api/showroom-stores/device-location` + newest-row readers (**phone source, done**).
- `services/tesla/visit-sessions.ts` — `stageSoftArrival` / `finalizeSoftArrivals` (two-row core, already source-agnostic in shape — takes a `ParkFix`).
- `services/drive-geo-match.ts` — `haversineMeters`, `initialBearing`, `matchAndMarkVisited` (active-drive-scoped, 250 m).
- `services/google/maps.ts` — `placesNearby`, `placesTextSearchMany`, `reverseGeocode`, `isUnderMonthlyQuota()` + usage log (**Places plumbing + quota gate, done**).
- MCP `whats_near_me` (proximity + undiscovered sweep), `find_known_showrooms` (dedupe/exclusion primitive), `get_user_location` (best-of phone+Tesla).
- `showroom_gaps` table/lifecycle pattern (a proven "queue with decisions" shape to model the HITL queue on).

---

## 3. The architecture — a normalized location ingress

### 3.1 The `LocationFix` contract

Every source normalizes to one shape and calls one function. This is the entire decoupling.

```mermaid
classDiagram
    class LocationFix {
        +latitude: number
        +longitude: number
        +capturedAt: number  (epoch ms)
        +source: LocationSource
        +shiftState?: "P"|"R"|"N"|"D"|null
        +speed?: number
        +headingDeg?: number
        +accuracyMeters?: number
        +vin?: string
        +subjectId: string   (vin | "phone" | "ai")
        +raw?: unknown       (provenance)
    }
    class LocationSource {
        <<enum>>
        tessie-stream
        tessie-poll
        phone
        ai
        manual
    }
    class ingestLocationFix {
        <<service>>
        +ingest(env, fix): Promise~IngestResult~
        1. record (provenance) 
        2. run detector (§3.3)
        3. emit park / drive-away 
        4. run pipeline (§4)
    }
    LocationFix --> ingestLocationFix
    LocationSource --> LocationFix
```

### 3.2 Source adapters — thin, each just builds a `LocationFix`

```mermaid
flowchart LR
    A1["tesla-poller.ts<br/>getVehicleState → fix{shiftState,speed}"] --> ING[[ingestLocationFix]]
    A2["tesla-stream.ts onFrame<br/>extractTelemetryFields → fix"] --> ING
    A3["POST /device-location<br/>phone → fix{no shiftState}"] --> ING
    A4["MCP report_location(lat,lng)<br/>ai → fix{no shiftState}"] --> ING
    A5["POST /api/tesla/manual-here<br/>manual → fix"] --> ING
    ING --> REC["record provenance<br/>(reuse device_location / telemetry;<br/>no new firehose table)"]
    ING --> DET[["park/dwell detector §3.3"]]
```

> **No new high-volume table.** Provenance reuses the existing sinks (`teslaTelemetryEvents`, `device_location`); the ingress writes only *events of interest* (a park session), not every fix.

### 3.3 The source-agnostic park/dwell detector

This generalizes the `tesla_park_sessions` state machine (2026-07-21 plan) so it works **with or without `shiftState`**. That's the crux: a phone or AI fix has no gear, so we fall back to a **dwell heuristic**.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> IDLE : no active drive
    IDLE --> MOVING : fix shows motion\n(speed>0 OR moved > MOVE_EPS_M)
    MOVING --> PARKED : shiftState==P\nOR (speed≈0 / no move) for a fix
    PARKED --> SETTLING : still within PARK_RADIUS_M\nacross fixes
    SETTLING --> PARKED_CONFIRMED : dwell ≥ DWELL_MIN\n(→ PARK EVENT)
    PARKED_CONFIRMED --> MOVING : shiftState P→D\nOR moved > DEPART_RADIUS_M\n(→ DRIVE-AWAY EVENT)
    PARKED --> IDLE : home/work OR drive deactivated
    SETTLING --> MOVING : moved before DWELL_MIN\n(discarded, no visit)

    note right of PARKED_CONFIRMED
      PARK EVENT fires the decision tree (§4).
      Trigger priority:
        1. shiftState transition (stream/poll) — instant
        2. dwell heuristic (phone/ai/poll w/o gear)
      Same event either way.
    end note
```

**Detector state** lives in KV (`CACHE`, key `loc:detector:<subjectId>`), never a growing table — mirrors the existing `tesla:last-shift:<vin>` pattern. Constants (config-driven, §7):
- `DWELL_MIN` (default **5 min**, config-adjustable — a real showroom stop, not a red light; low enough to catch a quick slab-yard peek). CONFIRMED 2026-07-26.
- `PARK_RADIUS_M` (default 60 m — "same spot across fixes").
- `DEPART_RADIUS_M` (default 120 m — "the car left").
- `MOVE_EPS_M` (default 40 m — GPS jitter floor).

A **park session** row (`park_sessions`, §5.4) is the durable anchor so app-close/phone-sleep can't lose an in-flight visit — exactly the #178 design, generalized past Tesla.

### 3.4 Where the streaming DO fits now

```mermaid
flowchart TD
    Q{Is the streaming DO worth<br/>running right now?} -->|"active drive ∧ in-window ∧<br/>toggle on (existing gating)"| ON[DO connects → emits<br/>fixes at 500ms<br/>fast, precise, billable]
    Q -->|otherwise| OFF[DO dormant]
    ON --> ING[[ingestLocationFix]]
    OFF --> POLL[tessie-poll 120s → fix] --> ING
    OFF --> PHONE[phone ping → fix] --> ING
    OFF --> AI[ai report_location → fix] --> ING
    ING --> V[Visits / discovery / nav<br/>work identically]
    classDef bill fill:#4a1d2b,stroke:#fb7185,color:#ffe8ee
    class ON bill
```

The DO keeps all its existing safety (circuit breaker, native alarms, write budget) — but it's now **strictly optional**. Turn it off and the poller + phone + AI keep every feature alive at ~120 s granularity. This is the cost lever the user asked for.

---

## 4. The park pipeline — unchanged logic, new trigger

Once `ingestLocationFix` emits a **PARK** or **DRIVE-AWAY** event, the existing 0022 decision tree runs verbatim — it only ever needed one `{lat,lng}`.

```mermaid
flowchart TD
    P[PARK EVENT<br/>from ANY source] --> A{1.a home/work radius?}
    A -- yes --> A1[all active drives → paused<br/>day is done] --> Z[stop]
    A -- no --> B{1.b within range of a stop<br/>on the ACTIVE drive?}
    B -- yes --> B1[visit_log SOFT_ARRIVAL<br/>store_id + drive + stop] --> B2[check stop off] --> W[await DRIVE-AWAY]
    B -- no --> C{1.c near ANY registered showroom?}
    C -- yes --> C1[visit_log SOFT_ARRIVAL<br/>store_id = matched] --> W
    C -- no --> D[1.d proximityScan lat,lng,radius]
    D --> D0{remodel candidate?}
    D0 -- no --> Z
    D0 -- yes --> D1[hitl_queue row TBD] --> D2[detour stop is_detour+hitl_queue_id] --> D3[visit_log SOFT_ARRIVAL hitl_queue_id] --> W
    W --> X[DRIVE-AWAY: append STAGED row<br/>+ departure + dwell + soft_arrival_id]
```

**Drive-away** = the detector's `PARKED_CONFIRMED → MOVING` transition (gear change, or the car moved > `DEPART_RADIUS_M`), so a poll/phone stream closes the dwell just as well as the 500 ms stream.

---

## 5. Data model deltas

### 5.1 Reconcile `showroom_visit_log` to 0022 §5.1 (it's currently a subset)

```mermaid
erDiagram
    showroom_visit_log {
        int id PK "EXISTING"
        int store_id FK "EXISTING (nullable)"
        int hitl_queue_id FK "ADD — XOR with store_id"
        int drive_list_id FK "EXISTING"
        int stop_id FK "EXISTING (=drive_list_stop_id)"
        int arrival_at "EXISTING (=timestamp_arrival)"
        int departure_at "EXISTING"
        int dwell_seconds "EXISTING"
        text status "EXISTING: AI_STAGED|TESLA_SOFT_ARRIVAL|TESLA_STAGED|SUBMITTED"
        text visit_type "ADD — engagement depth: SOFT_ARRIVAL | BROWSED_NO_CONTACT | BRIEF_NO_HELP | FULL_SESSION | APPOINTMENT"
        text type "EXISTING but MISNAMED (contact axis) → migrate to visit_type; contact axis lives on contact_log"
        int rating "EXISTING — ADD CHECK 1..5"
        text notes_markdown "EXISTING"
        text notes_html "EXISTING"
        real latitude "EXISTING (=arrival_latitude)"
        real longitude "EXISTING"
        real match_distance_m "ADD — attestation strength"
        text gps_source "EXISTING — widen enum to add tessie-poll|ai"
        text provenance_json "ADD — raw fix + active-drive id + match reasoning"
        int soft_arrival_id FK "EXISTING (partial-unique)"
    }
```

**Reconciliation decisions to confirm with the user (flagged, not silently chosen):**
- **D-1 (CONFIRMED 2026-07-26).** Two separate entities, cleanly split:
  - **`showroom_visit_log.visit_type` = engagement depth of the visit** — `SOFT_ARRIVAL` (auto-staged, not yet classified) · `BROWSED_NO_CONTACT` (walked through, spoke to no one) · `BRIEF_NO_HELP` (asked someone, got pointed, no real engagement) · `FULL_SESSION` (worked the floor, pulled samples, real consultation) · `APPOINTMENT` (scheduled). This is the quality signal that matters for the future sale of the app.
  - **`showroom_store_contact_log` = who/how you communicated** — `type` = `PHONE | EMAIL | SHOWROOM_IN_PERSON`, PLUS an **optional `showroom_visit_log_id` FK** (0022 §5.3). So an in-person contact made *during* a visit links back to that visit and carries `type = SHOWROOM_IN_PERSON`; a phone/email contact stands alone with a null visit link. This lets "who did I actually talk to on the floor that day" be a first-class, queryable fact.
  - Migrate the mislabeled existing `type` values onto the right axis.
- **D-2 (CONFIRMED 2026-07-26).** Add `hitl_queue_id`. The "exactly one of store_id / hitl_queue_id" rule is enforced **only once the visit is confirmed** (status `SUBMITTED`, and for `TESLA_STAGED`/`DRAFT` where a target is known); while a row is still an unconfirmed `TESLA_SOFT_ARRIVAL`/`AI_STAGED` auto-arrival, "neither yet" is allowed. Implemented as a partial CHECK (`status IN (...) → the XOR holds`) plus service-layer validation on finalize.
- **D-3.** `match_distance_m` + `provenance_json` are additive/nullable — safe.

### 5.2 New tables (0022 §5.2 / §5.7)

```mermaid
erDiagram
    showroom_store_hitl_queue ||--o{ showroom_visit_log : "discovery visit"
    showroom_store_hitl_queue |o--o| showroom_stores : "approve → store"
    drive_list_stops |o--o| showroom_store_hitl_queue : "detour points at discovery"
    showroom_search ||--o{ showroom_search_revision : "numbered"
    showroom_search ||--o{ showroom_search_result : "results"
    showroom_exclusions |o--o{ showroom_search_result : "hides"

    showroom_store_hitl_queue {
        int id PK "NEW"
        text name
        text description "AI one-liner"
        real latitude
        real longitude
        text place_id
        int store_id FK "on approve"
        text user_decision "PROCESS|DO_NOT_PROCESS|TBD"
        int drive_list_id FK
        text proximity_scan_json
        text category_guess
    }
    showroom_search {
        int id PK "NEW"
        text slug UK
        text params_json
        text status "running|ready|refining|final|error"
        int current_revision
    }
    showroom_search_result {
        int id PK "NEW"
        int search_id FK
        int revision_id FK
        text place_id
        text name
        real distance_m
        int in_directory
        int is_excluded
        int matched_exclusion_id FK
    }
    showroom_exclusions {
        int id PK "NEW"
        text place_id "match key"
        text name
        real latitude
        real longitude
        text reason_markdown "PlateJS"
        text source "manual|ai"
    }
```

Plus the small existing-table adds: `drive_lists += paused` (status enum widen), `drive_list_stops += is_detour + hitl_queue_id`, `showroom_stores += is_identified_by_proximity_scan + proximity_scan_json`, `contact_log += showroom_visit_log_id + type`. (`drive_list_stops` already has `kind/suggested/skipped` from 0031 — additive, no conflict.)

### 5.3 Migrations
All via `pnpm run db:generate` → `migrate:remote` (app DB) and `db:generate:tesla` → `migrate:tesla:remote` (`TESLA_DB`). **Never hand-author.** Every add is additive/nullable so concurrent branch previews keep working. CHECK constraints via Drizzle `check()` in the table builder; verify the generated SQL before applying.

### 5.4 New `park_sessions` (the detector anchor)
Generalizes #178 `tesla_park_sessions`, keyed on `subject_id` (vin|phone|ai) not just VIN: `id`, `subject_id`, `drive_list_id?`, `stop_id?`, `store_id?`, `hitl_queue_id?`, `latitude/longitude`, `source`, `parked_at`, `departed_at?`, `dwell_seconds?`, `status (parked|settled|discarded)`, `visit_log_id?`. Partial-unique on `(subject_id)` where `status='parked'` (one open park per subject).

---

## 6. Phasing & ownership

```mermaid
flowchart TD
    L0["L0 · LocationFix ingress<br/>+ source adapters"]:::mine
    L1["L1 · source-agnostic<br/>park/dwell detector + park_sessions"]:::mine
    V1["V1 · visit_log schema<br/>reconcile to §5.1"]:::mine
    V2["V2 · Visit Logs workspace<br/>REST + MCP CRUD + store section"]:::mine
    C1["C1 · Tesla config finish<br/>home/work, radii, stale, dwell"]:::mine
    D1["D1 · proximityScan + HITL queue<br/>+ exclusions table"]:::shared
    D2["D2 · Discovery finder<br/>search tables + realtime DO + pages + voice"]:::other
    N1["N1 · multi-waypoint nav<br/>+ NavigateTeslaButton"]:::other
    K1["K1 · real-time voice MCP keepalive<br/>(P7-INFRA-01 spike)"]:::other

    L0 --> L1 --> V1 --> V2
    L0 --> C1
    V1 --> D1
    D1 --> D2
    C1 --> D1
    L0 -.-> N1
    V2 -.-> D2

    classDef mine fill:#1f3a5f,stroke:#60a5fa,color:#e6f0ff
    classDef shared fill:#3b2f0b,stroke:#fbbf24,color:#fff7e0
    classDef other fill:#3a2a3f,stroke:#c084fc,color:#f5e8ff
```

| Phase | Scope | Owner | Maps to |
|---|---|---|---|
| **L0** | `LocationFix` type, `ingestLocationFix`, adapt poller/stream/phone, add `report_location` MCP + `manual-here` route | **This pass (mine)** | 0023 ING-03 seam; new |
| **L1** | Park/dwell detector (shiftState OR dwell), `park_sessions` table, wire park/drive-away → pipeline | **This pass (mine)** | #178; 0022 §6.2 P3-SVC-01 |
| **V1** | `showroom_visit_log` reconcile (visit_type, hitl_queue_id+XOR, match_distance_m, provenance_json, rating CHECK, gps_source enum) | **This pass (mine)** | 0022 §5.1 / 0023 P1-DB-01 |
| **V2** | Visit Logs workspace (list/detail/new), REST CRUD, MCP CRUD (create/get/list/update/delete/stage/finalize), store viewport "Visits" section | **This pass (mine)** | 0022 P1 + §14.1 |
| **C1** | `/admin/config/tesla` completion: home/work geocode, radii, `tesla_location_stale_seconds`, `DWELL_MIN` etc. | **This pass (mine)** | 0022 P2 |
| **D1** | `proximityScan` service (reuse `placesNearby`+`find_known_showrooms`), `showroom_store_hitl_queue`, `showroom_exclusions`, decision 1.d, Park-Finds page | **Shared** (service mine, page could be another pass) | 0022 P4 |
| **D2** | `showroom_search/_revision/_result`, `find_showrooms` orchestration, discovery realtime DO, finder pages, voice CRUD parity | **Another agent / later pass** | 0022 P7 |
| **N1** | Multi-waypoint `navigate-drive` + waypoints spike, `NavigateTeslaButton` shared component | **Another agent / later pass** | 0022 P5 |
| **K1** | Real-time voice MCP keepalive spike + fix | **Another agent / later pass** | 0022 P7-INFRA-01 |

> **My pass (0032)** owns L0→L1→V1→V2→C1 (+ the D1 *service*) — the source-agnostic foundation plus the Visit Logs workspace, which is the user's stated #1 priority and "ships value even with GPS off." D2/N1/K1 are scoped and handed off in `TRACKING.json`.

---

## 7. Config keys (`project_system_variables`, category `tesla`)
`tesla_record_telemetry` (master) · `tesla_primary_residence_address` + `tesla_home_lat/_lng` · `tesla_work_address` + `tesla_work_lat/_lng` · `tesla_proximity_radius_m` (250) · `tesla_home_work_radius_m` (150) · `tesla_proximity_scan_enabled` · `tesla_location_stale_seconds` (300) · **new:** `loc_dwell_min_seconds` (300 = 5 min) · `loc_park_radius_m` (60) · `loc_depart_radius_m` (120). Reuses `GET/POST /api/admin/config`.

---

## 8. Cost & safety
- **The whole point:** with the DO off, cost is ~1 Tessie cached read / 120 s while a drive is active + the same read on a phone/AI ping. No 500 ms firehose, no duration-billed socket.
- **Places/AI** spend stays confined to park-event `proximityScan` (rare) + user-initiated `find_showrooms`, both behind the existing `isUnderMonthlyQuota()` hard-disable.
- Detector state is KV (self-replacing), not a growing table — no `$700`-class runaway surface.
- Deferred (needs a cost model): always-on drive-by scanning with no active drive (0022 `PX-DEFER-01`).

---

## 9. Verification plan
- **L0/L1:** unit-test the detector with synthetic fix sequences per source — a poll-only sequence (no shiftState) still fires park via dwell; a phone sequence fires drive-away via `DEPART_RADIUS_M`; sub-`DWELL_MIN` park is `discarded`.
- **V1:** migration applies on local D1; XOR/CHECK reject bad rows; existing rows migrate cleanly (visit_type backfill).
- **V2:** QC script drives the visit-log REST CRUD + MCP parity; workspace renders Pending-first + empty state.
- **End-to-end (real):** with the **DO off**, take a drive with phone location on (or the poller) → a visit stages on arrival and finalizes on drive-away → appears in Visit Logs. This proves the decoupling on real hardware.
- Each phase: `scripts/qc/pr_<n>.mjs` against preview + prod, changelog entry with QC output + remote-migration status, changelog link in the PR body.

---

## 10. Decisions (all CONFIRMED 2026-07-26)
1. **D-1 — visit_type = engagement depth; contact_log stays separate + gains an optional visit FK.** ✅ (§5.1)
2. **D-2 — "exactly one of store_id / hitl_queue_id" enforced only once confirmed; neither-yet allowed while an unconfirmed auto-arrival.** ✅ (§5.1)
3. **DWELL_MIN = 5 min, config-adjustable.** ✅ (§3.3)
4. **Phone is a first-class source** — a phone fix alone can stage a visit (no Tesla required). ✅
5. **AI-supplied coords via a dedicated `report_location` MCP tool** that feeds the detector (so "I'm at the stone place" stages the visit like the car would). ✅
6. **D2 / N1 / K1 are a separate later pass** so 0032 (L0–V2, C1, D1) stays independently shippable. ✅
