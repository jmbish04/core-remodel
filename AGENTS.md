# AGENTS.md — Grounding Profile & Architectural Alignment Map
# Verified on: 2026-05-20

## System Identity & Role Enforcements
You are an elite Senior Engineer operating within the Google Antigravity IDE framework. Your primary objective is shipping high-performance, self-healing architectures across the Cloudflare Ecosystem.

## Detected Structural Components
- **Routing Tier:** Hono API Framework (Serving OpenAPI v3.1.0)
- **Frontend Layer:** Astro Web Engine + Shadcn (Default Dark Theme Architecture)
- **Data Persistence:** Drizzle ORM + D1 Serverless SQL Storage Core
- **Cognitive Orchestration:** @cloudflare/agents SDK Layer

## Scorched-earth changelog (STANDARD — required for non-trivial changes)

Every non-trivial change ships a changelog entry AND a full "scorched-earth"
detail page. Shallow one-liners are not enough — the detail is the developer
record of the work.

- **Overview** (`/admin/changelog`, `src/frontend/pages/admin/changelog.astro`)
  groups changes by **branch / PR**; each phase entry links to its detail page.
- **Data**: add a `ChangelogEntry` (with `branch`) in
  `src/frontend/data/changelog.ts`, and a `PhaseDetail` keyed by the entry `id`
  in `src/frontend/data/changelog-detail.ts`.
- **Every detail page MUST cover**: the problem, the approach, the exact **API**
  endpoints and **MCP tools** touched, the files, the **migration SQL**,
  representative **code cards** (`ts` / `tsx` / `sql` / `json` / `bash`), and a
  **Mermaid ER diagram** of the D1 tables involved. Detail page:
  `src/frontend/pages/admin/changelog/[slug].astro`; diagrams render via
  `src/frontend/components/docs/MermaidDiagram.tsx`.
- **PR link**: set `prNumber` / `prUrl` on the branch in `changelog.ts` once the
  PR is open so the overview resolves it.
- When you change an API endpoint or MCP tool, the changelog entry + detail page
  MUST reflect it (both the REST route and the `/mcp` tool).

### Generating D1 ER diagrams (Mermaid)

Use the vendored generator, then paste its `erDiagram` (trimmed to the relevant
tables) into the `diagrams` of the `PhaseDetail`:

```bash
python3 scripts/documentation/d1_schema/mermaid.py --from-migrations drizzle \
  --tables 'showroom_store_*' 'showroom_stores' --theme dark
# output: scripts/documentation/d1_schema/diagram/<timestamp>_diagram.md
# --local (default) introspects the local wrangler D1 instead of the migrations.
```

## Active design specs (read-only references for agents)

- `build-vision/` (project root) — **Design spec, not production code.** Prototype for the Build-Vision feature (vendor-facing remodel brief). Includes `data.jsx`, `app.jsx`, `admin-app.jsx`, `sections.jsx`, `budget.jsx`, `comments.jsx`, `selection-toolbar.jsx`, `comment-rail.jsx`, `sidebar.jsx`, `lightbox.jsx`, `pdf-preview.jsx`, `styles.css`, `_tokens.css`. Treat these as the source-of-truth for visual + interaction parity. Production code lives in `src/frontend/components/build-vision/`, `src/backend/api/routes/build-vision.ts` and `admin-build-vision.ts`, and `src/backend/db/schema/build-vision/`. Implementation plan: `docs/plans/2026-05-27-build-vision.md`.
