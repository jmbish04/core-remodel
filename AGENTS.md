# AGENTS.md — Grounding Profile & Architectural Alignment Map
# Verified on: 2026-05-20

## System Identity & Role Enforcements
You are an elite Senior Engineer operating within the Google Antigravity IDE framework. Your primary objective is shipping high-performance, self-healing architectures across the Cloudflare Ecosystem.

## Detected Structural Components
- **Routing Tier:** Hono API Framework (Serving OpenAPI v3.1.0)
- **Frontend Layer:** Astro Web Engine + Shadcn (Default Dark Theme Architecture)
- **Data Persistence:** Drizzle ORM + D1 Serverless SQL Storage Core
- **Cognitive Orchestration:** @cloudflare/agents SDK Layer

## Page styling — consistent shell for EVERY page (MANDATORY)

Every admin/app page is a **thin Astro shell** mounting one React island, wrapped
in `<BaseLayout>`, and MUST follow this exact structure. The canonical example is
`src/frontend/pages/admin/studio.astro`. A page that jams content into the top-left
with an unstyled header is almost always breaking rule (1) below.

1. **In `.astro` files, use `class`, NEVER `className`.** Astro only applies `class`.
   A `className` on a native element (`<main>`, `<div>`, `<h1>`) renders as a dead
   attribute — Tailwind classes never apply, so the container/padding/typography
   silently vanish and the page collapses to the top-left. (Inside `.tsx` islands,
   `className` is correct — this rule is about `.astro` shells only.)
2. **Container:** the page body is `<main class="container mx-auto px-4 py-8 pb-12">`.
3. **Header block** directly inside `<main>`:
   ```astro
   <div class="mb-8">
     <h1 class="mb-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
       <!-- a 24px lucide/inline SVG icon, class="size-6 text-muted-foreground" aria-hidden -->
       Page Title
     </h1>
     <p class="text-muted-foreground">One-line description of the page.</p>
   </div>
   ```
   The icon is REQUIRED — pick one that matches the page (e.g. a cog for config).
4. The island mounts below the header: `<TheApp client:only="react" />`.

When you touch or create a page that violates this (no icon, wrong/`className`
header, content flush to the top-left), fix it to match `studio.astro`.

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
concatenates the per-domain arrays. Each domain is a FOLDER — `tools/<domain>/`
with **one file per tool** (`tools/<domain>/<tool_name>.ts`, filename == the tool's
`name`), a `tools/<domain>/_shared.ts` for helpers used by 2+ tools in that domain,
and `tools/<domain>/index.ts` that re-exports the domain's `RemodelTool[]` array.
`tools/index.ts` barrels the 14 domain arrays into `ALL_TOOL_GROUPS`. To count tools
authoritatively: `find src/backend/mcp/tools -mindepth 2 -name '*.ts' ! -name index.ts
! -name _shared.ts | wc -l` (currently 79). It feeds the MCP server, the public
catalog endpoint `GET /api/mcp-docs`, and the docs pages. NOTE: the SEPARATE legacy
JSON-RPC shim at `src/backend/api/routes/mcp.ts` (`/api/mcp`) is a small back-compat
surface — NOT this registry; do not confuse the two.

**To ADD or CHANGE a tool (do this every time):**
1. Add a new `src/backend/mcp/tools/<domain>/<tool_name>.ts` exporting
   `export const <camelName> = defineTool({...})` (name = bare snake_case verb, NO
   prefix; hand-written Zod v4 `inputShape` — never import drizzle-zod; correct
   annotations from `types.ts`: `READ_ONLY` / `WRITE` / `WRITE_IDEMPOTENT` /
   `DESTRUCTIVE`; ≥1 `example`; money in cents). Helpers shared across the domain go
   in `tools/<domain>/_shared.ts`. Then add the export to `tools/<domain>/index.ts`.
2. New domain → new `tools/<domain>/` folder + its `index.ts`, then import its array
   into `src/backend/mcp/tools/index.ts` (`ALL_TOOL_GROUPS`, order = docs order).
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

## Multi-select & config-driven definitions (MANDATORY)

**NEVER store or render a multi-select as a comma-separated string.** Not colors,
not tags, not categories — nothing. It is sloppy and forbidden. Use a real
definition + mapping pair and a proper multi-select component (shadcn / shadcn
registry — there is always one).

**Definition table** (one per multi-select vocabulary, e.g. `colors`, `categories`):
- `id` INTEGER PK autoincrement (ALWAYS)
- `name` TEXT NOT NULL (ALWAYS)
- `description` TEXT (ALWAYS)
- `is_active` INTEGER boolean default true (ALWAYS — soft-delete, never hard-delete a choice)
- domain extras when useful (e.g. colors get `hex_code`)

**Mapping table** (join the definition to the owning object, e.g. `photo_colors`):
- `id` INTEGER PK autoincrement (ALWAYS)
- `<def>_id` FK → the definition table (ALWAYS an FK)
- `<object>_id` FK → the owning row (ALWAYS an FK)
- UNIQUE index on `(<def>_id, <object>_id)` (ALWAYS — no duplicate mappings)

**API (per multi-select), ALWAYS provide:**
- list all active options (for the autoselect component)
- create an "Other" option from the UI (returns the new definition row)
- create/replace the mappings as part of a form submit AND standalone (for backfills)
- return the mappings when reading the owning object
- search/filter owning objects by mapping(s)

**UX, ALWAYS:**
- support "Other" (creates a new definition + selects it)
- if the definition has `hex_code`, show a color swatch in the option (`[▧] Name`) and a color picker when creating "Other"
- show the option **display name**, never the option id

**Config pages:** every config vocabulary gets an **admin-gated** `/admin/config/<group>/<name>`
page (e.g. `/admin/config/photo/colors`) to manage its definitions. Config is NEVER served
under the public `/config/*` prefix — it must live under `/admin/*` so the auth gate covers it.
The cog wheel in the top header opens `/admin/config` in a new tab; that config area has its own
dedicated sidebar (ConfigShell / CONFIG_NAV), grouped. One page per vocabulary; all share it.

**Categories:** a shared `categories` definition table + `subcategories` (each with a
`category_id` FK to its parent). Objects (photos, brands, products) map to categories via a
`<object>_categories` table (`category_id` FK) AND — where subcategory precision is wanted —
to subcategories via a separate `<object>_subcategories` table (`subcategory_id` FK). Keep the
two mappings separate (category multi-select is independent of subcategory); reconstruct the
`{category} / {subcategory}` path by joining the subcategory mapping back through its parent
`category_id`. Do NOT collapse to a single subcategory-only FK — a photo can carry a bare
category with no subcategory.

## Reusable data-entry components (USE THESE — do not hand-roll)

**Currency / price** → `@/components/ui/currency-input` `<CurrencyInput>`.
- Renders a `$`-prepended field; `onValueChange(text, cents)` hands back BOTH the
  verbatim text and integer cents. NEVER a bare `<Input>` for money.
- **D1 for currency: store BOTH** a `<field>_text` TEXT column (verbatim, e.g.
  "$1,299.00" or "call for pricing") AND a `<field>_cents` INTEGER column (numeric,
  for sort/compare/sum). The API accepts text and derives cents (or takes an explicit
  override). See `product_price_observations` (price/priceCents) for the pattern.

**Rich-text notes (PlateJS)** → any user-authored rich text (visit notes, overview notes,
review context, drive notes, HITL context, etc.) is captured with the **PlateJS** editor
(`@/components/showroom/OverviewNoteEditor` `<OverviewNoteEditor>`, or an equivalent Plate host),
which emits `{ markdown, html }` via `onChange`. NEVER a bare `<textarea>` for a note field.
- **D1 for rich text: store BOTH** a `<field>_markdown` TEXT column AND a `<field>_html` TEXT
  column. The markdown is the portable/round-trippable source of truth; the html is the
  render-ready cache. Never persist only one. The API accepts both (sanitize the html on write);
  MCP tools that write notes accept/return both. See `store_notes` (contentMarkdown/contentHtml)
  and `showroom_stores` (overviewNoteMarkdown/overviewNoteHtml, ratingContextMarkdown/…Html) for
  the pattern; `showroom_visit_log` (notes_markdown/notes_html) follows it.

**Single-select with "Other"** → `@/components/ui/combobox-with-other` `<ComboboxWithOther>`
(brand, style, single category…). **Multi-select with "Other"** → `@/components/ui/multiple-selector`
`<MultipleSelector>` (colors, categories…). Both support option create via `onCreateOther`/
`onCreateOption` (wire to the definition-table create API) and hex swatches (pass `hexCode`).
NEVER a native `<select>` when "Other" creation is expected; NEVER comma-separated multi-values.

**Config pages** → every definition vocabulary gets an admin-gated `/admin/config/<group>/<name>`
page (e.g. `/admin/config/photo/colors`) built on the reusable **`ConfigShell`** scaffold
(`@/components/config/ConfigShell` — shared config sidebar + a definition-table CRUD panel:
list active rows, add, edit, soft-deactivate; color picker when the definition has `hex_code`).
The header cog opens `/admin/config` in its own tab with the grouped config sidebar. One page per vocabulary.

## MANDATORY planning-phase compliance scan

During ANY planning/design/review phase, scan the touched surface for **currency** and
**multi-select** data points. For EACH one found that is NOT properly represented across
**all three** layers — UX (the reusable component above), D1 (currency = text+cents;
multi-select = definition + mapping tables), and API (list options / create-Other / map /
list-mappings / filter-by-mapping) — **FLAG it to the user** and ask, per instance, whether
it should **stay as-is** or be **brought into compliance**. Do not silently leave a
comma-separated multi-value or a text-only currency field; surface it.

## Changelog discipline (MANDATORY)

The changelog is a **persistent, append-only** record in D1 (`changelog_branches` +
`changelog_entries`), surfaced at `/admin/changelog`. It is NOT a static markdown file —
never create or edit a `CHANGELOG.md`.

**Every turn that changes code, and always before opening a PR, you MUST update the changelog:**

1. **Your branch** → one row in `BRANCHES` in `src/frontend/data/changelog.ts` (keyed by git
   branch name). `status: "staged"` until it ships to prod, then `"shipped"`. Add
   `prNumber`/`prUrl` once the PR exists.
2. **Each non-trivial change** → one `ChangelogEntry` in `CHANGELOG` (unique `id` = the detail
   slug), tagged with your `branch`. `changes[]` `kind` ∈ `added|changed|removed|migration|fixed`.
   List every drizzle migration tag in `migrations[]`.
3. **Full detail page** → a matching `PhaseDetail` in `src/frontend/data/changelog-detail.ts`
   keyed by the same `id`: `problem`, `approach`, `apiChanges[]`, `filesTouched[]`,
   `migrations[{tag, sql}]`, `code[]`, and a Mermaid `diagrams[]` where a table/flow is involved.
   Renders at `/admin/changelog/:id`.

This bundled data is the seed + SSR fallback. The source of truth is D1: after deploy run
`POST /api/changelog/seed` once (idempotent), or push entries live with
`POST /api/changelog/entries` (upsert by slug — never overwrites another branch's rows). Because
D1 accumulates across branches, the static file's only job is to carry *your* branch's additions;
do not delete another branch's entries to resolve a merge conflict — append yours.
