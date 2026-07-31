# 0043 — PROMPT (coding agents)

Two agents, two repos. Section A = this worker (`core-remodel`). Section B = the editor
(`jmbish04/editor`). The **contract in §B is frozen** — build both sides to it.

---

## A. Core-Remodel worker agent

> Implement the Pascal rendering integration as a new `pascal` domain in the existing Core-Remodel
> Cloudflare Worker. Core-Remodel is the **system of record and durable scene store**; Pascal (on
> Vercel) is a thin rendering client. Do **not** scaffold a new worker, add
> `@modelcontextprotocol/server@2`, import Pascal's Bun CLI/SQLite, or touch the existing AI image
> render pipeline. Follow `AGENTS.md`: `db.batch` (never `db.transaction`), chunk lists at 20, FK
> not name columns, structured-output for AI, reusable currency/rich-text components, page shell,
> changelog + QC discipline.
>
> **First action:** verify the branch is fresh vs `origin/main` (`pnpm run worktree:check`).
>
> **Phase 1 — schema + wire.**
> - New `src/backend/db/schema/pascal/`: `pascal_projects`, `pascal_studies`, `pascal_variants`,
>   `pascal_snapshots`, `pascal_scene_events` (see IMPLEMENTATION_PLAN §3, ERD). `db:generate` →
>   `migrate:remote` → verify columns on remote.
> - `src/backend/api/routes/pascal.ts` (`OpenAPIHono`, unique operationIds): the 9 `/api/pascal/v1/*`
>   routes (PLAN §4). Zod `SceneMeta/SceneWithGraph/ProjectStatus/SceneEvent`. Optimistic version
>   (`expectedVersion`/`If-Match` → 409/412), `413` when `scene_bytes` over cap, `422` when
>   `projectId` ≠ `rendering.coreRemodelProjectId`. Mount in `src/backend/api/index.ts` behind the
>   `WORKER_API_KEY` gate (`requireAccessAuth` / `isRequestAuthenticated`, `utils/access.ts`).
> - QC `scripts/qc/pr_<n>.mjs` (shared helpers) — run vs `--preview` and prod.
>
> **Phase 2 — generator + core MCP tools.**
> - `src/backend/services/pascal/generator.ts`: read `rooms` (`floorplanBbox*Pct`, `lengthFeet/…`,
>   `areaSqFt`), `measurements`, `floors` → emit the Pascal flat node graph
>   `{ nodes: Record<id,BaseNode>, rootNodeIds }` (Site→Building→Level→Zone/Slab/Wall). **Rectangular
>   seed only** — exact sizes, bbox-placed; document the approximation in code + output provenance.
>   Build the provenance snapshot (measurement IDs, source, unit, value, confidence, request id).
> - `src/backend/mcp/tools/pascal/` — one `defineTool` per file, `pascalTools[]` in `index.ts`,
>   spread into `ALL_TOOL_GROUPS` (`tools/index.ts`): `create_render_project`, `create_study`,
>   `generate_floorplan_variant` (base mode), `get_render_context`, `list_studies`, `list_variants`,
>   `get_variant_editor_link`, `get_render_status`. Money-in-cents n/a; correct annotations; ≥1
>   example each.
>
> **Phase 3 — AI variants, compare, snapshots.**
> - `generate_floorplan_variant` intent mode: structured-output (JSON schema) node-graph **edit**;
>   validate node ids against the live graph and dims against measured bounds before write; new child
>   variant + provenance. `compare_layout_variants`. `capture_scene_screenshot` via Browser Rendering
>   (`ai/tools/browser-rendering.ts` pattern, `CF_BROWSER_RENDER_TOKEN`, spend-gated) →
>   `uploadBytesToCfImages` (`services/render/cf-images.ts`) → `pascal_snapshots` + optional thumbnail.
>   **Run the Phase-0 spike first** — if headless WebGPU capture is blank, implement the editor-capture
>   fallback endpoint instead (`POST /api/pascal/v1/scenes/:id/snapshot`, editor posts PNG bytes).
>
> **Phase 4 — admin UI + docs.** `/admin/pascal` per DESIGN_SPEC (page shell, PlateJS descriptions,
> reused primitives). Verify `/connect/tools` cards. Changelog branch + entries + detail page +
> `verification` block with real QC output. New secret: `PASCAL_SCENE_SIGNING_KEY` is **not** needed
> (server-to-server WORKER_API_KEY); add `PASCAL_EDITOR_URL` var.
>
> **Typecheck** `npx tsc --noEmit` (stash-diff vs baseline). Open one PR per phase; check for
> concurrent worktrees/PRs on the same files first. Deploy per `AGENTS.md` LAST-ACTION contract.

---

## B. Editor agent (jmbish04/editor) — FROZEN contract

Pascal is the rendering/visual-editing client. Core-Remodel remains the system of record for users,
orgs, projects, requirements, measurements, materials, permissions, billing, structural constraints.

### Identity & metadata
Every integrated scene carries both `projectId` and `rendering.coreRemodelProjectId`; they must
match at API boundaries. Rendering metadata contains: variant identity, label, parent-scene lineage;
**immutable measurement-evidence snapshots** (authoritative Core-Remodel measurement ID, source
revision, unit, value, confidence); aggregate generation confidence; source, generation timestamp,
source revision, request-id provenance. These snapshots explain how a scene was generated; updating
them does **not** update Core-Remodel business records.

### Vercel storage selection
The editor selects the **remote adapter** when `CORE_REMODEL_API_URL` is set; set
`CORE_REMODEL_API_TOKEN` for bearer auth. Without the URL, Pascal keeps local SQLite (local dev /
MCP clients). **Vercel must use the remote adapter** (ephemeral function filesystem). Configure both
as **server-only** Vercel env vars — never exposed to browser bundles.

### Core-Remodel API expected by Pascal
`CORE_REMODEL_API_URL` is the Core-Remodel origin. Pascal calls, under `/api/pascal/v1`:

| Method | Route | Purpose |
|---|---|---|
| POST | `/projects` | create a project mapping when authorized |
| GET | `/projects/:projectId` | read project/rendering status |
| GET | `/scenes?projectId=…` | list scenes for a project |
| PUT | `/scenes/:sceneId` | create / version-update a scene |
| GET | `/scenes/:sceneId` | load scene graph + metadata |
| PATCH | `/scenes/:sceneId` | rename a scene |
| DELETE | `/scenes/:sceneId` | delete rendering state (authorization applies) |
| POST | `/scenes/:sceneId/events` | append a browser-visible scene event |
| GET | `/scenes/:sceneId/events` | read events after a cursor |

Returns `SceneMeta`, `SceneWithGraph`, `ProjectStatus`, `SceneEvent`. `409`/`412` version conflict,
`404` missing, `400`/`422` invalid, `413` oversized.

### Pascal synchronization API (editor-owned; external orchestrators)
- `GET /api/projects/:projectId/scenes` — list scenes mapped to the project.
- `POST /api/projects/:projectId/scenes` — create/update a project scene.
- `POST /api/projects/:projectId/sync` — `direction:"push"` writes a complete graph + rendering
  metadata; `direction:"pull"` loads one scene after verifying project identity.
Existing `PASCAL_SCENE_API_TOKEN`, origin checks, CORS, rate limiting, optimistic version apply.
> **Note (topology):** because Core-Remodel is the store, the worker writes scenes directly to D1
> and the editor reads them via the remote adapter; the worker does **not** need to call these
> editor sync routes except optionally for `capture_scene_screenshot`.

### Screenshot capture & Cloudflare Images
MCP tool `capture_scene_screenshot` renders an explicit URL or
`PASCAL_EDITOR_BASE_URL/scene/:sceneId` via Cloudflare Browser Rendering, uploads the PNG to
Cloudflare Images, returns image ID + delivery URL + variant URLs. With a scene ID, the public
delivery URL is saved as that scene's thumbnail by default. Requires `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_WRANGLER_API_TOKEN` (Browser Rendering – Edit + Images write). In **this** repo, the
established pattern is REST Browser Rendering via `CF_BROWSER_RENDER_TOKEN` + `cf-images.ts`.

#### `capture_scene_screenshot` behavior
```
Input: sceneId, projectId, width 320..3840 (def 1440), height 240..2160 (def 900),
       fullPage?, setAsThumbnail (def true)
1. Authorize projectId in Core-Remodel.
2. Render PASCAL_EDITOR_URL/scene/:sceneId with Browser Rendering.
3. Reject empty / non-image / >10MB.
4. Upload to Cloudflare Images (don't set Content-Type manually).
5. Read result.id + result delivery/variant URLs.
6. If setAsThumbnail → push public URL through the scene's thumbnail.
7. Preserve coreRemodelProjectId, variantId, measurements, confidence, provenance.
8. Return imageId, variants, deliveryUrl, capturedUrl, sceneId, sceneVersion.
```

### Local tokens
`bun run dev:tokens` / `bun run mcp:tokens` set
`CORE_REMODEL_API_URL=https://core-remodel.hacolby.workers.dev`, load `WORKER_API_KEY` from
`~/bin/tokens`, expose it as both `CORE_REMODEL_API_TOKEN` and `PASCAL_SCENE_API_TOKEN`, and load the
Cloudflare account + API token. No secrets printed, no `.env.local` written. Mirror as server-only
Vercel env vars in deployed environments.

### Editor server env (server-only; never commit values)
```
CORE_REMODEL_API_URL=https://core-remodel.hacolby.workers.dev
CORE_REMODEL_API_TOKEN=<WORKER_API_KEY>
PASCAL_EDITOR_URL=https://3d-remodel.vercel.app
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_WRANGLER_API_TOKEN=<api-token>
```

### Acceptance (editor side)
- With the remote adapter configured, opening `/scene/:sceneId` loads the graph from Core-Remodel;
  edits `PUT` back; stale save → 409; version increments.
- Identity preserved: `projectId` == `rendering.coreRemodelProjectId` on every boundary.
- Screenshot path produces a Cloudflare Images delivery URL and can set the scene thumbnail.
- If worker-side headless capture is blank, the editor exposes a canvas-capture that POSTs PNG bytes
  to the worker fallback endpoint.
