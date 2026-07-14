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

**The changelog is PERSISTENT (D1) and every branch/PR MUST register one.** The
record lives in the `changelog_branches` + `changelog_entries` D1 tables so it
accumulates across all branches (no static-file merge conflicts). When you open
a branch of work, register it and each shipped change:

- **MCP**: call `create_changelog_entry` (upserts the branch + one entry; accepts
  the full scorched-earth `detail`). This is the preferred, agent-driven path.
- **API**: `POST /api/changelog/branches` then `POST /api/changelog/entries`.
- **Seed** (one-time bootstrap of the bundled static data): `POST /api/changelog/seed`.

- **Overview** (`/admin/changelog`, `src/frontend/pages/admin/changelog.astro`)
  reads D1 (SSR) and groups by **branch / PR**; each entry links to its detail
  page. It falls back to the bundled `src/frontend/data/changelog*.ts` when D1 is
  empty/unavailable, so the same data also seeds new environments.
- **Static mirror** (fallback + seed source): keep a `ChangelogEntry` (with
  `branch`) in `src/frontend/data/changelog.ts` + a `PhaseDetail` keyed by the
  entry `id` in `src/frontend/data/changelog-detail.ts`.
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

### Generating D1 ER diagrams (Mermaid) — MANDATORY validation

Use the ESM Mermaid suite (`scripts/documentation/mermaid/*`; the old
`mermaid.py` is deprecated). `mermaid:erd` self-validates its output.

```bash
# after-state ERD from the migrations (feeds a PhaseDetail diagram):
pnpm run mermaid:erd -- --tables 'showroom_store_*' --theme dark
# → scripts/documentation/mermaid/output/<ts>_diagram.md (auto-validated)

# validate any diagram / doc before committing (exit 1 = fix + re-run):
pnpm run mermaid:validate <path-to-.md-or-.mmd>
```

Every Mermaid diagram an agent generates or hand-authors MUST pass
`mermaid:validate` before commit. Feed only focused table sets — a 50-column
parent table produces a malformed box. Keep a validated copy of the phase
diagrams in `docs/<feature>/diagrams.md`.

## Active design specs (read-only references for agents)

- `build-vision/` (project root) — **Design spec, not production code.** Prototype for the Build-Vision feature (vendor-facing remodel brief). Includes `data.jsx`, `app.jsx`, `admin-app.jsx`, `sections.jsx`, `budget.jsx`, `comments.jsx`, `selection-toolbar.jsx`, `comment-rail.jsx`, `sidebar.jsx`, `lightbox.jsx`, `pdf-preview.jsx`, `styles.css`, `_tokens.css`. Treat these as the source-of-truth for visual + interaction parity. Production code lives in `src/frontend/components/build-vision/`, `src/backend/api/routes/build-vision.ts` and `admin-build-vision.ts`, and `src/backend/db/schema/build-vision/`. Implementation plan: `docs/plans/2026-05-27-build-vision.md`.
