# AGENTS.md — Grounding Profile & Architectural Alignment Map
# Verified on: 2026-05-20

## FIRST ACTION OF EVERY SESSION — verify the branch is fresh

Do this **before reading any source file, before dispatching any explore agent,
and before answering any question about how something currently works.** Not
after. Reading stale code produces confident, entirely wrong analysis, and every
minute spent after the first stale read is wasted.

A `SessionStart` hook (`.claude/settings.json`) runs this for you and prints the
result before you read anything:

```bash
pnpm run worktree:check     # or: node scripts/worktree-check.mjs
```

It fetches `origin/main` first (a worktree's local `main` ref never updates on
its own), then reports commits behind/ahead, how old the last commit is, and
whether another session left uncommitted files here. **≥25 behind prints a loud
STALE CHECKOUT warning — believe it.** The check only informs; it never blocks,
because revisiting an old branch is sometimes deliberate.

If the hook did not run, do it by hand:

```bash
git fetch origin main -q
git log --oneline -1 origin/main
git log --oneline HEAD..origin/main | wc -l   # commits behind
```

**If the count is not 0, STOP.** Do not explore, do not plan, do not edit.
Rebase onto `origin/main` first, or create a fresh worktree from `origin/main`
and carry any work across. Then re-run the check and confirm 0.

Why this is a hard rule and not a suggestion:

- A worktree's **local `main` ref is not updated by anything**. It can sit dozens
  of commits behind `origin/main` indefinitely. `git status` says "clean" and
  gives no hint. Comparing against local `main` is always wrong — compare
  against `origin/main`, always, and only after an explicit `git fetch`.
- Long-lived worktrees rot fast. This repo merges to `main` frequently and
  Workers Builds auto-deploys on merge, so **the live site is `origin/main`** —
  never the branch you happen to be sitting in. Any bug reported from a
  production URL must be reproduced against `origin/main`.
- The failure is silent and expensive. It manufactures false conclusions about
  features being "missing" or "broken" when they were built, renamed, or
  replaced upstream, and any code written against the stale tree conflicts hard
  on merge.

**Prefer a fresh worktree cut from `origin/main` for each new piece of work over
reusing an existing one.** Reusing a worktree from a previous session is the
main way this goes wrong. If you must reuse one, the check above is mandatory.

When picking up work described by an earlier session or a memory file, re-verify
its claims against `origin/main` before acting — those notes reflect the tree as
it was, and the named files, routes, and components may have moved or been
replaced.

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

## Pull-request workflow (MANDATORY)

This repo is worked by **multiple concurrent agentic sessions**. Assume that as the norm,
not the exception. The rules below exist because parallel sessions in one repo silently
collide, and because a PR that nobody verified against the deployed worker is a guess.

### 1. Size + timing — decide for yourself, but check for neighbours first

Ship **one PR per feature set or phase**. Prefer several small PRs over one large one; a PR
that touches three unrelated subsystems is too big — split it. You do **not** need to ask
permission to open a PR: if you, acting as an expert engineer, judge that a coherent slice
is done, open it.

**BEFORE opening one, check for concurrent work** — this is not optional:

```bash
git worktree list                                    # other sessions' checkouts
git fetch origin && git log --oneline HEAD..origin/main   # what landed under you
gh pr list --limit 20                                # open PRs (read their FILE lists)
git for-each-ref --sort=-committerdate --format='%(committerdate:relative)|%(refname:short)' refs/remotes/origin | head -20
```

If another open PR or active worktree touches the **same files**, say so before proceeding
and propose an order. Overlapping edits to one file across two sessions is the single most
expensive failure mode here — whoever merges second eats a manual conflict resolution.
Rebase onto `origin/main` before opening, and again before merging.

### 2. Review loop — wait for the bot, then actually engage with it

After the PR is open and conflict-free:

1. **Wait** for the AI review bot to comment on the diff. (Today that is the Gemini review
   bot; it is being retired in favour of **codra** — `codra.hacolby.workers.dev`. Support
   whichever is posting.)
2. **Read every comment and judge it.** AI review comments are frequently right and
   sometimes wrong or inapplicable. Fix the applicable ones; for the rest, reply saying
   *why* it does not apply. Never blanket-accept and never blanket-ignore.
3. **Patch the PR** with the fixes, push, let CI go green.
4. **Clear any conflicts**, then **merge**.

### 3. Migrations — always apply to remote when the PR changes schema

If the PR adds or changes a drizzle schema, run `pnpm run migrate:remote` (never
`wrangler d1 execute --file`) and **verify** the result before merging:

```bash
pnpm run migrate:remote
# then confirm the table/column actually exists on the remote DB, and that any
# data backfill in the migration hit the row count you expected
```

Note the deploy topology: **every branch push builds and deploys the worker**, but
migrations do **not** ride the build. So new code reaches production before its table
exists unless you run the migration. Endpoints that query a missing table return **500** —
if a QC check 500s right after a schema PR, an unapplied migration is the first suspect.

### 4. QC script — every PR ships one

Create **`scripts/qc/pr_<number>.mjs`** exercising the API and/or MCP surface the PR
touched, plus a regression guard on anything existing it could break. Import the shared
helpers so every PR's harness behaves identically:

- **`scripts/config.mjs`** — base URL resolution (`--base` → `$BASE_URL` → prod),
  `accessCookie()`, `createClient()`, `createChecks()`, `assertReachable()`.
- **`scripts/tokens.mjs`** — `getToken(name)` over the local `tokens` CLI.

Run it with the shared runner:

```bash
pnpm run test:pr 151              # scripts/qc/pr_151.mjs
pnpm run test:pr 151 -- --sweep   # opt-in expensive paths
pnpm run test:pr --all            # every QC script
```

**QC targets the DEPLOYED worker, not `wrangler dev`.** `WORKER_API_KEY` is a
`remote: true` secrets-store binding with no local fallback, so every authed route 500s
locally — a local run cannot verify an API at all. Paste the QC output into the PR
description and into the changelog entry (below).

**While your PR is open, QC against your PREVIEW, not production:**

```bash
pnpm run test:pr 153 -- --preview     # your branch's own preview worker
pnpm run test:pr 153                  # production (main) — only after merge
```

`scripts/config.mjs` defaults to **production**, which runs `main`. QC an unmerged
branch against the default and you are testing code your branch has not shipped —
it reads as "my endpoint 404s" or "my column is missing" when the real answer is
"not merged yet". See the deploy topology below.

## Deploy topology & per-branch previews (READ BEFORE VERIFYING ANYTHING)

Cloudflare Workers Builds is connected to this repo with **two triggers**:

| Trigger | Branches | Deploy command | Target |
|---|---|---|---|
| Deploy default branch | `main` | `pnpm run deploy` | **production** — `core-remodel.hacolby.workers.dev` |
| Preview non-production branches | everything except `main` | `pnpm run build && … node scripts/deploy-preview.mjs` | **that branch's preview worker** |

So: **pushing a branch does NOT deploy to production.** Only merging to `main`
does. If you push a branch and then check `core-remodel.hacolby.workers.dev`,
you are looking at `main` — not your work. This is the single most common way a
verification step produces a wrong conclusion here.

### One preview worker per branch

`scripts/deploy-preview.mjs` deploys to `core-remodel-preview-<branch-slug>`:

```
https://core-remodel-preview-<branch-slug>.hacolby.workers.dev
```

It used to be a single shared `core-remodel-preview` slot, which meant
last-push-wins between concurrent sessions — your preview silently became
someone else's branch. Per-branch workers remove that race. Each one gets:

- the **same** D1 / R2 / KV / Vectorize / AI / secret bindings (shared by id),
- its **own** Durable Object namespaces — so a branch's DO migration tag can no
  longer desync production's,
- its **own** Workflow instances (workflow names are ACCOUNT-scoped, so they are
  suffixed per branch — an unsuffixed name would hijack prod's bindings),
- **no crons and no routes** — otherwise scheduled jobs double-run against the
  shared D1.

Get your preview URL: the build log prints it, or compute it locally with
`node -e "import('./scripts/deploy-preview.mjs').then(m=>console.log(m.previewWorkerName('$(git rev-parse --abbrev-ref HEAD)')))"`.

**Previews share production's D1.** A branch with a new migration still needs
`pnpm run migrate:remote` before its pages work — migrations never ride a build,
preview or production. Keep migrations additive so the shared DB stays usable by
every other branch's preview at once.

Preview workers accumulate — one per branch, and nothing reaps them. They are
inert (no crons, no routes, and they share prod's bindings rather than owning
anything), so this is housekeeping rather than a risk. Delete one by hand when a
branch is done:

```bash
npx wrangler delete --name core-remodel-preview-<branch-slug>
```

There is deliberately no automated reaper: `wrangler` has no command that lists
an account's workers, and the REST API needs a token scope this repo's
`CLOUDFLARE_API_TOKEN` does not carry. Not worth a credential hunt to delete
something that costs nothing to leave running.

> Cloudflare's built-in "Workers Previews" (`previews_enabled`) is **not**
> available on this account — the API returns `12044: This account does not have
> access to Workers Previews`. The per-branch worker above is the mechanism; do
> not waste a session trying to switch the platform feature on.

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

4. **Verification block** → on the same `PhaseDetail`, a `verification` object recording
   what you actually ran: the QC script path, its source snippet, the command, and its real
   output — plus, when the PR changed schema, each migration tag with whether it has been
   applied to the **remote** DB. Never fabricate or paraphrase results; paste what ran.

**Every changelog entry MUST surface, on the frontend:** the **git branch name**, the **PR
number**, the **tests that were run and their results**, and (when schema changed) **remote
migration status**. These are not optional metadata — they are how a reader answers "is this
actually live and actually verified?" without leaving the page.

**The PR description MUST contain a direct link to the changelog entry**, every time:

```
Changelog: https://core-remodel.hacolby.workers.dev/admin/changelog/<slug>
```

Write the D1 rows (don't rely on the next deploy's seed) so the link resolves the moment the
PR is opened:

```bash
# upsert by slug — never overwrites another branch's rows
curl -X POST "$BASE/api/changelog/entries" -H 'content-type: application/json' \
  -H "cookie: remodel_access=$(node scripts/tokens.mjs WORKER_API_KEY | ...)" -d @entry.json
```

This bundled data is the seed + SSR fallback. The source of truth is D1: after deploy run
`POST /api/changelog/seed` once (idempotent), or push entries live with
`POST /api/changelog/entries` (upsert by slug — never overwrites another branch's rows). Because
D1 accumulates across branches, the static file's only job is to carry *your* branch's additions;
do not delete another branch's entries to resolve a merge conflict — append yours.
