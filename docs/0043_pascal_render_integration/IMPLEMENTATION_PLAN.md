# 0043 — Pascal ⇄ Core-Remodel Rendering Integration

**Status:** Phase 4 in progress · **Slug:** `pascal-core-remodel-integration` · **Owner branch:** `codex/pascal-core-remodel-continuation`
**Companion repo:** `jmbish04/editor` (Pascal, deployed `https://3d-remodel.vercel.app`)

---

## 1. Context & problem

The user wants to explore renovation **layouts** in a real 3D/2D editor — e.g. *"try a few
island placements upstairs"* and *"a few kitchen-table-next-to-island layouts"* — where each idea
is its own editable floorplan, and snapshots of each get captured back into the project.

Pascal (`jmbish04/editor`, a fork of `pascalorg/editor`) is a client-side WebGPU/Three.js scene
editor. It **cannot** run on
Cloudflare Workers (SSR + WebGPU), so it lives on Vercel. Its stock build is **local-only**
(*"scenes are not saved"*, IndexedDB) — no backend, no API. So there is **no wire to integrate with
yet on either side**; both must be built.

**Division of ownership (fixed):**

- **Core-Remodel (this worker) = system of record + durable scene store.** Owns projects,
  studies, variants, the scene-graph JSON, measurements, provenance, permissions. Never runs
  Three.js.
- **Pascal (Vercel) = thin rendering client.** Owns geometry→mesh rendering and visual editing.
  Its function filesystem is ephemeral, so it **must** use a remote storage adapter pointed at this
  worker.

```mermaid
flowchart LR
  subgraph Claude["AI (Claude via MCP)"]
    A[intent: 'try island placements upstairs']
  end
  subgraph Worker["Core-Remodel Worker (system of record)"]
    MCP["/mcp tools"]
    REST["/api/pascal/v1/* scene store"]
    GEN[deterministic generator]
    D1[(D1: pascal_* tables)]
  end
  subgraph Vercel["Pascal editor (Vercel, thin client)"]
    ADP[remote storage adapter]
    UI[WebGPU editor UI]
  end
  A --> MCP --> GEN --> D1
  REST <--> D1
  ADP -- "Bearer WORKER_API_KEY (server-only)" --> REST
  UI --> ADP
  MCP -. "capture_scene_screenshot (Browser Rendering)" .-> UI
  classDef store fill:#1f3a5f,stroke:#60a5fa
  class D1,REST store
```

---

## 2. Grounded reality (verified against the tree, 2026-07-31)

- **No geometry is stored.** `rooms` has percent-of-image annotations only:
  `floorplanBboxXPct/YPct/WPct/HPct`, `floorplanXPct/YPct` (dot), plus scalar
  `lengthFeet/Inches`, `widthFeet/Inches`, `areaSqFt` (`src/backend/db/schema/home/rooms.ts:88-101`).
  `measurements` stores element-scoped scalars (`elementType` = wall/door/window/stair/…, with
  `lengthFeet/Inches`, `heightFeet/Inches`, unstructured `spanJson`) — **no coordinates, no wall
  endpoints, no adjacency** (`src/backend/db/schema/home/measurements.ts:106-168`).
  → **Deterministic generation can only emit rectangles at exact measured sizes, positioned by the
  floorplan bbox.** True walls/adjacency are the user's job in the editor. This is stated as a
  limitation everywhere, not hidden.
- **Existing "render" tools are AI image generation** (Gemini/Fal nano-banana), unrelated to this.
  This feature adds a **new** `pascal` domain; it does not touch the image pipeline.
- **REST pattern:** Hono + `@hono/zod-openapi`; routers in `src/backend/api/routes/*`, mounted in
  `src/backend/api/index.ts` (`app.use(prefix, requireAccessAuth)` then `app.route(prefix, router)`).
- **Auth:** `WORKER_API_KEY` bearer via `isRequestAuthenticated` (`src/backend/utils/access.ts:144`),
  `x-worker-api-key`/`Authorization: Bearer`, cookie = `SHA-256(key)`. Constant-time compare.
- **Browser Rendering:** REST only via `CF_BROWSER_RENDER_TOKEN` secret
  (`src/backend/ai/tools/browser-rendering.ts:59-69`, `POST …/browser-rendering/snapshot`,
  `waitUntil: networkidle2`) — no `env.BROWSER` binding. Spend-gated + ledgered.
- **CF Images:** `src/backend/services/render/cf-images.ts` — `uploadBytesToCfImages(env, bytes,
  mime, filename) → { imageId, deliveryUrl }`; delivery = `https://imagedelivery.net/<id>/public`.
- **MCP add-a-tool:** new folder `src/backend/mcp/tools/pascal/` with one `defineTool` per file +
  `pascalTools[]` in `pascal/index.ts`, spread into `ALL_TOOL_GROUPS`
  (`src/backend/mcp/tools/index.ts:27-46`). No route wiring; registry feeds `/api/mcp` + `/connect`.

---

## 3. Data model (new `src/backend/db/schema/pascal/`)

**Contract source of truth:** editor PR `jmbish04/editor#1`, branch
`feat/core-remodel-pascal-integration` — `packages/mcp/src/storage/types.ts` (`SceneMeta`,
`SceneWithGraph`, `ProjectStatus`, `SceneEvent`, `SceneStore`), `apps/editor/lib/
rendering-metadata-schema.ts` (the provenance Zod), `apps/editor/lib/scene-api-errors.ts` (codes).
**Our columns mirror these field names/semantics exactly** — the TS interfaces are the client that
consumes our JSON.

FK-only for relations. `graph` stored as **one JSON blob per variant** (the Pascal `SceneGraph` from
`@pascal-app/core`) → sidesteps the D1 100-param cap. Capped; oversize → `413` (R2 offload later).

```mermaid
erDiagram
  floors ||--o{ pascal_projects : "scopes (FK, nullable)"
  rooms  ||--o{ pascal_projects : "scopes (FK, nullable)"
  pascal_projects ||--o{ pascal_studies  : has
  pascal_studies  ||--o{ pascal_variants : has
  pascal_variants ||--o{ pascal_variants : "parent_scene_id lineage"
  pascal_variants ||--o{ pascal_snapshots    : has
  pascal_variants ||--o{ pascal_scene_events : has

  pascal_projects {
    text   id PK "slug ≤64 (== ProjectStatus.id / SceneId)"
    text   core_remodel_project_id "== projectId == rendering.coreRemodelProjectId"
    text   name
    text   scope_type "floor | room | whole_home"
    int    floor_id FK "nullable"
    int    room_id  FK "nullable"
    text   owner_id
    text   created_at "ISO8601"
    text   updated_at "ISO8601"
  }
  pascal_studies {
    text   id PK "slug"
    text   project_id FK
    text   title       "required (product grouping; not on the wire)"
    text   description_markdown
    text   description_html
    text   created_at
    text   updated_at
  }
  pascal_variants {
    text   id PK "slug ≤64 == sceneId; its own /scene/:id"
    text   study_id  FK
    text   project_id FK "real FK; == SceneMeta.projectId"
    text   parent_scene_id FK "nullable; == variant.parentSceneId lineage"
    text   name "== SceneMeta.name"
    text   description_markdown "core-remodel-only"
    text   description_html
    text   graph_json "Pascal SceneGraph (full node fidelity)"
    text   graph_hash "== SceneMeta.graphHash"
    int    size_bytes "== sizeBytes (413 guard)"
    int    node_count "== nodeCount"
    int    version
    int    published_version
    int    draft_version
    int    latest_version
    int    browser_visible_version
    text   save_mode "draft | checkpoint"
    int    is_draft   "bool"
    int    published  "bool"
    text   status "product: draft | active | archived"
    text   rendering_json "SceneRenderingMetadata (exact schema; sanctioned snapshot)"
    text   thumbnail_url
    text   owner_id
    text   created_at "ISO8601"
    text   updated_at "ISO8601"
  }
  pascal_snapshots {
    text   id PK "slug"
    text   variant_id FK
    text   cf_image_id
    text   image_url
    text   caption
    text   camera_json
    text   created_at
  }
  pascal_scene_events {
    int    event_id PK "autoincrement == SceneEvent.eventId cursor"
    text   scene_id FK
    int    version
    text   kind
    text   graph_json "SceneEvent carries the full SceneGraph snapshot"
    text   created_at
  }
```

- **Slug ids, not UUIDs.** `SceneId` = lowercase alphanumeric + hyphen, ≤64. Variant id = sceneId =
  the editor URL segment. Generate slugs (e.g. `upstairs-island-a`), enforce the charset/length.
- **`name` not `title` on the wire.** Our product `title`/rich `description` are core-remodel-only;
  `SceneMeta.name` = variant name. Study title+description are our grouping metadata (the editor's
  flat `project→scenes` contract doesn't carry them).
- **Version model matches the adapter:** `saveMode` (`draft` updates the browser-visible working
  model, same version repeatedly; `checkpoint` records history), `expectedVersion` optimistic guard,
  `graphHash`, and the published/draft/latest/browser-visible rollup surfaced in `ProjectStatus`.

**Sanctioned denormalization:** `rendering_json` is the deliberate **immutable evidence snapshot**,
serialized to the editor's exact `SceneRenderingMetadata`: `coreRemodelProjectId`, `variant{id,
label,parentSceneId}`, `measurements[]{measurementId,kind,value,unit,confidence 0..1,sourceRevision}`
(≤10 000), `confidence 0..1|null`, `provenance{source: core-remodel|pascal|import, generatedAt(ISO),
sourceRevision, requestId}`. Updating it never touches the business records.

**Compliance scan (mandatory):** no currency fields, no user-managed multi-select vocabularies in
this surface. `scope_type`/`status` are fixed enums, not config vocabularies — no
definition/mapping tables required.

---

## 4. The wire — REST `/api/pascal/v1/*` (this worker implements; editor consumes)

Auth: **`WORKER_API_KEY` bearer, server-only** (the editor's remote adapter holds it as a Vercel
server env var; browsers never call this worker directly). This **supersedes** the earlier
browser-scoped-token idea — the editor mediates all calls server-side, which is strictly safer.

| Method | Route | Purpose | Returns |
|---|---|---|---|
| POST | `/projects` | create project mapping | `ProjectStatus` |
| GET | `/projects/:projectId` | project + rendering status | `ProjectStatus` |
| GET | `/scenes?projectId=…` | list scenes (variants) for a project | `SceneMeta[]` |
| PUT | `/scenes/:sceneId` | create / version-update a scene | `SceneMeta` |
| GET | `/scenes/:sceneId` | load graph + metadata | `SceneWithGraph` |
| PATCH | `/scenes/:sceneId` | rename | `SceneMeta` |
| DELETE | `/scenes/:sceneId` | delete rendering state | `204` |
| POST | `/scenes/:sceneId/events` | append scene event | `SceneEvent` |
| GET | `/scenes/:sceneId/events?after=<seq>` | read events after cursor | `SceneEvent[]` |

**Contract shapes** (Zod, authored here to satisfy the editor's `SceneMeta / SceneWithGraph /
ProjectStatus / SceneEvent` interfaces verbatim): `sceneId == pascal_variants.id` (slug); every
scene carries `projectId` **and** `rendering.coreRemodelProjectId` and they must match at the
boundary. `PUT /scenes/:id` accepts `graph` (full SceneGraph), `name`, `expectedVersion`, `saveMode`
(`draft|checkpoint`), `publish`, `rendering`; returns `SceneMeta`. `GET /scenes/:id` returns
`SceneWithGraph` (full graph). Events carry the full graph snapshot; `GET …/events?after=<eventId>`.

**Status codes (match `scene-api-errors.ts` exactly):** `version_conflict → 409`, `not_found → 404`,
`too_large → 413`, `invalid → 400`, else `500`. (The prose doc mentions 412/422; the real adapter
maps to **409/400** — implement those.) Emit typed error bodies `{ "error": "<code>" }`.

```mermaid
stateDiagram-v2
  [*] --> draft: generate_floorplan_variant
  draft --> active: user opens & edits (PUT, version++)
  active --> active: PUT save (version++ / 409 on stale)
  active --> archived: archived by user
  archived --> active: reactivated
  draft --> [*]: deleted (DELETE)
```

---

## 5. Snapshots — worker-side `capture_scene_screenshot`

Per the editor contract, capture is a **worker MCP tool** using Cloudflare Browser Rendering →
Cloudflare Images. No Cloudflare credential ever reaches the browser.

```mermaid
sequenceDiagram
  participant C as Claude / admin UI
  participant W as Worker
  participant BR as CF Browser Rendering (REST)
  participant IMG as CF Images
  C->>W: capture_scene_screenshot(sceneId, projectId, w, h, setAsThumbnail)
  W->>W: authorize projectId (WORKER_API_KEY gate)
  W->>BR: POST /snapshot  PASCAL_EDITOR_URL/scene/:sceneId  (waitUntil networkidle2)
  BR-->>W: PNG (reject empty / non-image / >10MB)
  W->>IMG: uploadBytesToCfImages(bytes) → {imageId, deliveryUrl}
  W->>W: insert pascal_snapshots; if setAsThumbnail → variant.thumbnail_url
  W-->>C: {imageId, deliveryUrl, sceneId, sceneVersion}
```

⚠️ **Phase-0 spike (de-risk before building on it):** Browser Rendering is a **headless** browser;
rendering a **client-side WebGPU/Three** scene may paint blank (no GPU / async canvas). The spike
loads a real `/scene/:sceneId` and checks the PNG isn't blank. **Fallback if it fails:** editor-side
canvas capture — the editor grabs its own WebGL canvas and `POST`s bytes to a worker
`/api/pascal/v1/scenes/:id/snapshot` endpoint that uploads to CF Images. (This is why the user's
original "editor uploads direct" path stays in reserve.)

---

## 6. Geometry generation

```mermaid
flowchart TD
  R[rooms: bbox%% + L×W + areaSqFt] --> G
  M[measurements: element scalars + spanJson] --> G
  F[floors: livingSqFt] --> G
  G[deterministic generator] --> B[base variant: rooms as rectangles<br/>exact sizes, bbox-placed]
  B --> AI{intent given?}
  AI -- no --> S1[store base scene_json + provenance]
  AI -- yes --> LLM[LLM structured-output:<br/>node-graph EDIT from intent]
  LLM --> V[validate vs measured bounds]
  V -- ok --> S2[new child variant + provenance]
  V -- out of bounds --> REJ[reject, surface reason]
  classDef warn fill:#5f1f1f,stroke:#f87171
  class REJ warn
```

- **Deterministic base** = rectangular seed. Exact dimensions (feet/inches → metres); shape and
  adjacency approximated from the floorplan bbox. Honest, measured starting point — not final walls.
- **AI variant** = `generate_floorplan_variant` with an `intent`. LLM emits a node-graph **edit**
  (move/add/remove) via structured output (JSON schema — never "reply with JSON"). Validated against
  measured room bounds before write. New variant, `parent_variant_id` = source, provenance records
  intent + assumptions + confidence.
- **AI must return node ids, validated against the live graph** before applying (no hallucinated
  ids reaching a write).
- **Full fidelity, not bounds-only.** The rectangle seed is a *starting point*. Via `get_scene_graph`
  + `edit_scene_nodes`/`put_scene_graph` (§7) the AI reads and sets **any** node property — real wall
  runs/endpoints, openings, items, cameras — for highly detailed edits. Measured-bounds validation is
  an advisory guard on dimensioned edits, not a cap on expressiveness.

---

## 7. MCP tools (new `pascal` domain, `/mcp` connector)

**Full node-graph fidelity is a hard requirement.** Read tools expose **every node and property** of
the Pascal `SceneGraph` (walls with endpoints, slabs/polygons, zones, openings, items, cameras,
metadata) — never a summarized/rectangle view. Write tools let the AI **specify any of those
details**: whole-graph replace *and* granular node ops. The deterministic rectangle generator is
just one starting point; from there the AI/user does arbitrarily detailed edits.

| Tool | Annotation | Purpose |
|---|---|---|
| `create_render_project` | WRITE_IDEMPOTENT | map a floor/room → a Pascal project |
| `create_study` | WRITE | grouping (title+description), e.g. "island placement" |
| `get_render_context` | READ_ONLY | measurements + constraints + existing variants for the AI |
| `get_scene_graph` | READ_ONLY | **full** SceneGraph for a variant — all nodes + all properties |
| `generate_floorplan_variant` | WRITE | new variant: deterministic base, or from-parent + intent |
| `edit_scene_nodes` | WRITE | granular ops on a variant's graph: add/update/delete/move any node with full properties; `expectedVersion` guard; validate ids/refs vs live graph |
| `put_scene_graph` | WRITE | replace a variant's whole graph (AI-authored full SceneGraph), validated + versioned |
| `list_studies` / `list_variants` | READ_ONLY | browse |
| `compare_layout_variants` | READ_ONLY | side-by-side full-detail diff + snapshots within a study |
| `get_variant_editor_link` | READ_ONLY | deep-link `PASCAL_EDITOR_URL/scene/:variantId` |
| `capture_scene_screenshot` | WRITE | Browser Rendering → CF Images → snapshot/thumbnail |
| `get_render_status` | READ_ONLY | variant version/status/thumbnail (`ProjectStatus` rollup) |

**Graph validation ceiling (ponytail):** the worker stores/passes the `SceneGraph` with structural
validation (well-formed `nodes` record, resolvable `parentId`/refs, id charset, size cap) and mirrors
the editor's `SceneRenderingMetadata` Zod exactly. Deep per-node-type Zod (mirroring every
`@pascal-app/core` schema) is a **later hardening task** — until then the editor remains the
authority on node-level semantics. Node ids the AI supplies are validated against the live graph
before any write; hallucinated ids are rejected.

---

## 8. Phases & tasks (mirrors D1 `plan_tasks`)

**Phase 0 — De-risk (spike).**
- `p0-browser-render-spike` — prove Browser Rendering can screenshot a live WebGPU scene; decide
  worker-capture vs editor-capture fallback.
- `p0-editor-contract-handoff` — confirm `/scene/:sceneId` deep-link route + remote-adapter env
  (`CORE_REMODEL_API_URL`, `CORE_REMODEL_API_TOKEN`) with the editor agent; hand over PROMPT.md.

**Phase 1 — Schema + scene store (the wire).**
- `p1-schema` — `pascal/` drizzle tables + `db:generate` + `migrate:remote` + verify columns.
- `p1-shapes` — Zod `SceneMeta/SceneWithGraph/ProjectStatus/SceneEvent` + identity-match guard.
- `p1-rest` — `/api/pascal/v1/*` router (9 routes), optimistic version (409), 413 size cap,
  events append/cursor-read; mount behind WORKER_API_KEY gate.
- `p1-qc` — `scripts/qc/pr_<n>.mjs` exercising the wire against preview + prod.

**Phase 2 — Deterministic generator + product MCP tools.**
- `p2-generator` — rooms/bbox/measurements → Pascal node-graph JSON (rectangular seed) + provenance.
- `p2-mcp-core` — `create_render_project`, `create_study`, `generate_floorplan_variant` (base),
  `get_render_context`, `get_scene_graph` (full-fidelity read), `list_studies`, `list_variants`,
  `get_variant_editor_link`, `get_render_status`.

**Phase 3 — AI variants, full-fidelity edits, compare, snapshots.**
- `p3-ai-variant` — `generate_floorplan_variant` intent mode (structured output + bounds validation
  + lineage).
- `p3-graph-edit` — `edit_scene_nodes` (granular node ops, all properties, `expectedVersion`, id/ref
  validation) + `put_scene_graph` (whole-graph replace). This is the full-detail write surface.
- `p3-compare` — `compare_layout_variants`.
- `p3-screenshot` — `capture_scene_screenshot` (worker Browser Rendering + CF Images) OR editor-capture
  fallback per p0.

**Phase 4 — Admin UI + docs + ship.**
- `p4-admin-ui` — `/admin/pascal` (projects → studies → variant cards + snapshots + deep-links +
  compare); BaseLayout shell. See DESIGN_SPEC.
- `p4-connect-docs` — verify `/connect/tools` catalog cards for the new domain.
- `p4-changelog` — changelog branch + entries + detail page + verification block.

**Editor side (jmbish04/editor — other agent, contract only):** remote storage adapter →
`/api/pascal/v1/*`; deep-link scene load; save→PUT; snapshot capture path. See PROMPT.md §Editor.

---

## 9. Success criteria

- From Claude: create a project for "upstairs", a study "island placement", generate a base variant
  + two AI variants; each opens as its own floorplan at `PASCAL_EDITOR_URL/scene/:id`.
- Editor loads a scene from this worker, edits, saves back; version increments; stale save → 409.
- A snapshot is captured to CF Images and shows as the variant thumbnail in `/admin/pascal`.
- `compare_layout_variants` returns the study's variants with dims + thumbnails.
- Unauthorized/identity-mismatched calls fail before touching the store.
- QC green on preview and prod; migrations applied to remote and verified.

## 10. Risks

- **Headless WebGPU screenshot** may be blank → p0 spike + editor-capture fallback.
- **No true geometry in DB** → base is rectangular/approximate by design; set expectations in UI copy.
- **Scene blob size** in D1 → `scene_bytes` guard + `413`; R2 offload if it bites.
- **Two-repo rollout ordering** → worker wire ships first; editor adapter builds to the frozen
  contract; events endpoints can return empty until the editor needs them.
