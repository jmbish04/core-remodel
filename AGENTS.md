# AGENTS.md — Grounding Profile & Architectural Alignment Map
# Verified on: 2026-05-20

## System Identity & Role Enforcements
You are an elite Senior Engineer operating within the Google Antigravity IDE framework. Your primary objective is shipping high-performance, self-healing architectures across the Cloudflare Ecosystem.

## Detected Structural Components
- **Routing Tier:** Hono API Framework (Serving OpenAPI v3.1.0)
- **Frontend Layer:** Astro Web Engine + Shadcn (Default Dark Theme Architecture)
- **Data Persistence:** Drizzle ORM + D1 Serverless SQL Storage Core
- **Cognitive Orchestration:** @cloudflare/agents SDK Layer

## Active design specs (read-only references for agents)

- `build-vision/` (project root) — **Design spec, not production code.** Prototype for the Build-Vision feature (vendor-facing remodel brief). Includes `data.jsx`, `app.jsx`, `admin-app.jsx`, `sections.jsx`, `budget.jsx`, `comments.jsx`, `selection-toolbar.jsx`, `comment-rail.jsx`, `sidebar.jsx`, `lightbox.jsx`, `pdf-preview.jsx`, `styles.css`, `_tokens.css`. Treat these as the source-of-truth for visual + interaction parity. Production code lives in `src/frontend/components/build-vision/`, `src/backend/api/routes/build-vision.ts` and `admin-build-vision.ts`, and `src/backend/db/schema/build-vision/`. Implementation plan: `docs/plans/2026-05-27-build-vision.md`.

## MCP Server (Model Context Protocol connector) — 0015

The Worker hosts an OAuth-gated MCP server so Claude (claude.ai custom connector,
or Claude Code) can manage the remodel by chat. Plan: `docs/0015_mcp_server/IMPLEMENTATION_PLAN.md`.

**Architecture**
- **OAuth**: `@cloudflare/workers-oauth-provider` wraps the Worker's default export
  in `src/_worker.ts`. It owns `/oauth/token`, `/oauth/register`, and the
  `.well-known` metadata; it delegates `/oauth/authorize` (the consent screen,
  `src/backend/mcp/oauth-ui.ts`) and everything else to the existing handler
  (Astro + Hono + Agents). The provider only implements `fetch`, so the default
  export wraps it and forwards `scheduled`/`email` to the legacy handler — **do
  not remove that wrapper** or the cron jobs + inbound email break. Requires the
  `OAUTH_KV` KV binding.
- **Transport**: `RemodelMcpAgent` (a `McpAgent` Durable Object, `agents/mcp`,
  migration tag `v14`) at `/mcp` (Streamable HTTP) + `/mcp/sse`. It wraps the
  official `@modelcontextprotocol/sdk` `McpServer`.
- **Legacy endpoint**: `/api/mcp` (`src/backend/api/routes/mcp.ts`) still serves
  the old JSON-RPC bearer/cookie/research-token path for back-compat.
- **Scope**: a single `remodel` full-parity scope (anything the app can do).

**The tool registry is the single source of truth**: `src/backend/mcp/registry.ts`
concatenates the per-domain arrays in `src/backend/mcp/tools/*.ts`. It feeds the
MCP server, the public catalog endpoint `GET /api/mcp-docs`, and the docs pages.

**To ADD or CHANGE a tool (do this every time):**
1. Add/edit a `defineTool({...})` entry in the relevant
   `src/backend/mcp/tools/<domain>.ts` (name = bare snake_case verb, NO prefix;
   hand-written Zod v4 `inputShape` — never import drizzle-zod; correct
   annotations from `types.ts`: `READ_ONLY` / `WRITE` / `WRITE_IDEMPOTENT` /
   `DESTRUCTIVE`; ≥1 `example`; money in cents).
2. New domain file → import its array into `src/backend/mcp/tools/index.ts`
   (`ALL_TOOL_GROUPS`, order = docs order).
3. **Maintain the frontend docs**: the `/connect/tools` catalog page
   auto-renders from the registry (via `/api/mcp-docs`), so a well-described
   tool needs no manual doc edit — but VERIFY the card looks right, and update
   the prose on `src/frontend/pages/connect/index.astro` whenever the CONNECTION
   FLOW changes or a new concept is introduced. A tool with no registry entry, a
   stale description, or a missing example is a defect. NOTE: the human docs
   live at `/connect` (NOT `/mcp`) because the OAuthProvider apiHandler owns the
   entire `/mcp/*` prefix — never add a page under `/mcp/*`.
4. Schema change? `pnpm run db:generate` then apply via `pnpm run migrate:remote`
   only — never raw SQL, never hand-edit migrations. New DO? bump the migration
   tag in `wrangler.jsonc` and export the class from `src/_worker.ts`.
5. Typecheck what you touched: `npx tsc --noEmit` (the build is esbuild and does
   NOT type-check).

**Known follow-ups (tech debt):** the legacy `/api/mcp` render/measurement tool
declarations are duplicated between `src/backend/api/routes/mcp.ts` and the
registry's `tools/legacy.ts` (both call the same services); unify onto the
registry when convenient. `update_showroom`/`record_showroom_visit` do not bump
`updatedAt`.

### MCP Ops & the self-improving loop — 0017

Every MCP tool call is logged automatically (`src/backend/mcp/logging.ts`,
written via `ctx.waitUntil` from both transports) into `mcp_tool_invocations`,
grouped by session in `mcp_sessions`. Claude also writes two backlogs during
chats via the `ops` tools, and coding agents are expected to work them:

> **Before starting Worker code work, check the MCP ops backlog:**
> - **Open bugs:** `mcp_agent_issues` where `status='open'` — read via
>   `pnpm run mcp:issues`, the `list_agent_issues` MCP tool, or
>   `GET /api/mcp-ops/issues?status=open` (admin-gated). Fix what you can; when a
>   fix lands, call `resolve_agent_issue` (or update the row) with the **PR
>   number** that fixed it.
> - **Feature requests:** `mcp_feature_requests` where `status='requested'`
>   (`list_feature_requests` / `GET /api/mcp-ops/features?status=requested`).
>   **Do NOT silently implement** — surface them and **plan with the user** first;
>   set `status='planned'` + `planRef` when a plan doc exists, and `prNumber` +
>   `status='shipped'` when merged.
>
> These backlogs are written by Claude via the MCP tools during chats — treat
> them as authoritative TODOs for the connector.

Exported chats land in `mcp_conversations` (via `export_conversation`; large
transcripts offloaded to R2 `ARTIFACTS_BUCKET`). Admin reads: `/admin/mcp-ops`
(backed by `GET /api/mcp-ops/*`). The `ops` tools live in
`src/backend/mcp/tools/ops.ts` (category `"ops"`); logging itself is middleware,
not a tool. Never log the auth token / `WORKER_API_KEY` — the logger caps blob
sizes and redacts secret-ish keys.
