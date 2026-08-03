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
- Long-lived worktrees rot fast. This repo merges to `main` frequently, so **the
  code you should be reasoning about is `origin/main`** — never the branch you
  happen to be sitting in. Any bug reported from a production URL must be
  reproduced against `origin/main`. (Production may lag even `origin/main`,
  because deploys are manual now — see "LAST ACTION OF EVERY TURN" below.)
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


## LAST ACTION OF EVERY TURN — you own the deploy (MANDATORY)

**Nothing deploys itself.** Workers Builds auto-deploy is off, so merging to
`main` does NOT ship. If you finish a turn without running the commands below,
your work exists only in git and **production is still running the old code** —
including any schema migration you generated.

`pnpm run deploy` is the whole pipeline, in the only safe order:

```
build → migrate:remote → migrate:tesla:remote → wrangler deploy
```

Migrations run BEFORE the upload on purpose. New code reaching production before
its column exists makes every endpoint that reads it return **500**; that is the
first thing to suspect whenever a route 500s right after a schema change.

### The contract, by what you did

| You did | Run before ending the turn |
|---|---|
| Changed a drizzle schema | `pnpm run migrate:remote`, then **verify** the column/table exists on remote |
| Opened or updated a PR | `pnpm run deploy:preview` — then QC with `pnpm run test:pr <n> -- --preview` |
| **Merged to `main`** | **`pnpm run deploy`** from `main`, **or** run the **Deploy (manual)** GitHub Action (see below) — one of these is the only thing that updates production |
| Merged the PR | `pnpm run preview:delete` from the branch's worktree |

**Say what you did.** End the turn by stating explicitly whether you deployed,
whether migrations were applied to remote, and what the QC result was. "Done" is
not a status. If you deliberately did not deploy — because the work is unfinished
or you want review first — say that too, so the next session knows production
does not match `main`.

### Never deploy production from an unmerged branch

`pnpm run deploy` deploys whatever is in your working tree to the LIVE worker.
Run it only from `main`, after your PR merged and you pulled. From a feature
branch use `pnpm run deploy:preview`, which targets your own worker. The two
commands are one word apart and the failure is not recoverable by rerunning.

### Verify the deploy landed

```bash
npx wrangler deployments list | tail -20   # newest entry should be yours
pnpm run test:pr <n>                       # QC against production, after merge
```

### Two ways to run the deploy — CLI, or the manual GitHub Action

There is now a **`Deploy (manual)` GitHub Action** (`.github/workflows/deploy.yml`),
added because the Cloudflare↔GitHub CI/CD integration was **disconnected on purpose**
(see "Deploy topology & previews"). Pick whichever fits your session:

- **`pnpm run deploy`** — from a session that HAS local Cloudflare auth (a
  `CLOUDFLARE_API_TOKEN` in the env, or `wrangler login` done). Runs from your
  working tree, so only from `main` after your PR merged and you pulled.
- **`Deploy (manual)` Action** — when you do NOT have local wrangler auth (the
  common case for a remote Claude Code session — `wrangler whoami` says "not
  authenticated" and there's no token). It runs the **same pipeline**
  (`build → migrate:remote → migrate:tesla:remote → wrangler deploy`) on GitHub's
  runners using the repo's `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
  Actions secrets (already configured).

  It is **`workflow_dispatch` only** — it NEVER runs on push or PR (that is the
  whole point; a push must never deploy again). Trigger it either from the repo's
  **Actions tab → "Deploy (manual)" → Run workflow** (branch `main`, type `deploy`
  to confirm), or from a session with the GitHub MCP:

  ```text
  actions_run_trigger(workflow: "deploy.yml", ref: "main",
    inputs: { confirm: "deploy", run_migrations: true })
  ```

  Guards baked in: typed `deploy` confirmation, **main-only** (unless
  `allow_non_main: true`), a secrets preflight, a `run_migrations` toggle
  (turn off for a code-only redeploy), and a concurrency group so two deploys
  can't race onto prod. After it runs, verify as above (`wrangler deployments
  list`, `pnpm run test:pr <n>`). This is the sanctioned way to ship from `main`
  without a local token — use it instead of reporting "I can't deploy."

## MANDATORY planning artifacts — every feature, BEFORE any code (do ALL THREE)

Planning is not "write a summary and start coding." For **every** feature or
non-trivial change, planning produces three durable, reviewable artifacts, and it
is not complete until all three exist. **The preview changelog and the D1 planning
tables are planning artifacts, not post-hoc documentation** — they are how the user
reviews and approves the shape of the work *before* a line of feature code is
written. Do not skip them, and do not treat them as something that happens "later."

1. **`docs/####_<feature_name>/` doc bundle** — a new numbered folder (next free
   ordinal; e.g. after `0022_gps_showroom_drives` the next is `0023_…`) containing:
   - **`IMPLEMENTATION_PLAN.md`** — the plan: context/problem, phases, tasks,
     success criteria, schema/API/MCP deltas, risks, verification. (ALWAYS)
   - **`DESIGN_SPEC.md`** — ONLY when the feature has significant frontend work.
     This is the brief **Claude AI Design** builds the frontend from, in
     collaboration with the Claude Code agent — write it as a hand-off both can
     work against (pages, components, states, tokens, interaction parity). (WHEN
     FRONTEND IS SIGNIFICANT)
   - **`PROMPT.md`** — the copy-paste prompt handed to the coding agent that will
     build it. (ALWAYS)
   - `PRD.md` / `UX.md` / `TASKS.json` are welcome additions, but the three above
     are the floor.

2. **D1 planning + task tables** — seed `plans` + `plan_tasks` (surfaced at
   `/admin/plans/<slug>`) with the phases, tasks (`taskKey`, `workstream`, `phase`,
   `changeType`, `dependsOn`, `status`), and success criteria. The `TASKS.json`
   under `docs/####_*/` mirrors these rows 1:1 — keep them in sync. Do NOT invent a
   second task table; `plan_tasks` is the source of truth (see the feature-proposal
   flow below, which seeds it for you).

3. **PreviewChangelog** (a **proposal of the changes**, matching the `docs/` bundle
   from #1) — file it via the `submit_feature_proposal` MCP tool (or
   `scripts/changelog/submit-proposal.mjs` → `POST /api/changelog/proposals`),
   passing `prdMarkdown` (= IMPLEMENTATION_PLAN), `promptMarkdown` (= PROMPT),
   `designBriefMarkdown` (= DESIGN_SPEC when present), `tasks[]` (= TASKS.json, which
   also seeds #2), and — this is the point — the **raw, unsummarized conversation
   transcript** as `context` (stored in R2; add a `contextCoverageNote` when it's
   partial). It upserts by `slug` and renders at
   **`https://core-remodel.hacolby.workers.dev/admin/changelog/preview/<slug>`**
   — the link the user reviews. Re-file (same slug) as the plan evolves.
   The proposal's PRD/PROMPT/tasks MUST match the `docs/####_*` artifacts; they are
   the same plan in two homes (a file bundle and a reviewable D1/R2 record).

   **ALWAYS give the user the FULL, clickable URL — never a relative path.** The base
   is **`https://core-remodel.hacolby.workers.dev`** (pattern:
   `https://${worker-name}.hacolby.workers.dev`, worker = `core-remodel`). Every admin
   link surfaced to the user — the preview changelog above, `/admin/plans/<slug>`,
   `/admin/changelog/<slug>`, any `/admin/*` page — MUST be written as the absolute
   `https://core-remodel.hacolby.workers.dev/…` URL so it is one-click from chat. A bare
   `/admin/changelog/preview/<slug>` in a reply is a defect; prepend the base every time.

Only after these three exist — and the user has reviewed the preview changelog — does
implementation (feature code, migrations, PRs) begin. The changelog *entries* written
during/after the build (see "Changelog discipline") are a separate, later obligation;
they do not replace the preview-changelog **proposal** produced here in planning.

### Diagram everything with Mermaid — prose alone is a FAILED plan (MANDATORY)

**Every planning artifact must be dense with Mermaid diagrams, not just prose.** A plan,
a preview-changelog PRD, a `DESIGN_SPEC`, or a changelog detail page that explains an
architecture, a flow, a state machine, a data model, or a decision in words alone is
**incomplete** — send it back and diagram it. The user reviews these visually; a wall of
text is not reviewable and hides exactly the structure a reviewer needs to catch problems.

**Use the right diagram for the thing — and use MANY of them (aim for one per section that
describes structure or behavior):**

- **`flowchart`** — component/architecture maps, request pipelines, "what exists vs what's
  missing", decision trees (park→home/stop/showroom/scan), build-order + dependency graphs.
- **`sequenceDiagram`** — anything with actors over time: a webhook/poll round-trip, a
  real-time WebSocket fix flowing to the UI + AI, a multi-service call chain.
- **`stateDiagram-v2`** — lifecycles and state machines: a drive's status, a visit/park
  session (driving → parked/soft-arrival → settled/finalized), a discovery slug.
- **`erDiagram`** — EVERY schema change or new table. Show the FKs, the new/changed columns,
  and the cardinality. Never describe a data model in a bullet list when an ERD will do.
- **`journey`** — the user's day-in-the-life when UX is in scope.

**Where they render:** ```mermaid fenced blocks in the preview-changelog `prdMarkdown` /
`promptMarkdown` / `designBriefMarkdown`, in the `docs/####_*` markdown bundle, and in the
changelog detail page's `diagrams[]` (`{ caption, code }`, `PhaseDetail` in
`src/frontend/data/changelog-detail.ts`) — which renders via the shadcn-registry mermaid
(zoom/pan). A schema-changing changelog entry with an empty `diagrams[]` is a defect.

**Colour-code state** where it aids the read (done vs pending vs risk), e.g.
`classDef done fill:#1f4d2e,stroke:#4ade80`. Keep node labels short; let the shapes and
arrows carry the structure. If a section can be a diagram, it should be one.

## System Identity & Role Enforcements
You are an elite Senior Engineer operating within the Google Antigravity IDE framework. Your primary objective is shipping high-performance, self-healing architectures across the Cloudflare Ecosystem.

## Detected Structural Components
- **Routing Tier:** Hono API Framework (Serving OpenAPI v3.1.0)
- **Frontend Layer:** Astro Web Engine + Shadcn (Default Dark Theme Architecture)
- **Data Persistence:** Drizzle ORM + D1 Serverless SQL Storage Core
- **Cognitive Orchestration:** @cloudflare/agents SDK Layer

## The renovation-studio MCP server — one file per tool

There are **two** MCP servers in this repo; do not conflate them:
1. The OAuth connector at `src/backend/mcp/` (0015 — see the "MCP Server" section
   below). Claude.ai custom connector.
2. **The bearer-auth "renovation-studio" server at `src/backend/api/routes/mcp/`**
   (mounted `/api/mcp`) — render, mood-board, measurement, deep-research, and
   showroom/changelog/business-card tools. This section is about (2).

- **Tool count is whatever lives in `mcp/tools/` on the branch you are on — nothing
  else.** `mcp/tools/index.ts` (the `TOOLS` array) is the single source of truth.
  Count with `ls src/backend/api/routes/mcp/tools/*.ts` or read that barrel — never
  trust memory or another branch.
- **Layout:**
  - `index.ts` — transport only (JSON-RPC over streamable HTTP): auth, dispatch,
    invocation logging, `structuredContent`. No tool logic. Default-exports the router.
  - `tools/<tool_name>.ts` — **one file per tool.** Filename == MCP tool name. Each
    exports a `ToolDef` (`types.ts`): `{ name, description, inputSchema, research?, handler }`.
  - `auth.ts` — worker bearer (`Authorization: Bearer <WORKER_API_KEY>`) OR a scoped
    Deep Research token (limited to tools flagged `research: true`).
  - `lib/` — shared render + research helpers. `types.ts` — `ToolDef`/`ToolCtx`.
- **On `main`: 21 tools.** create_render_session, list_room_angles, run_render_stage,
  generate_mood_board, list_mood_boards, list_rooms, highlight_wall, add_measurement,
  list_measurements, get_measurement_coverage, get_deep_research_context,
  record_deep_research_progress, record_deep_research_source, create_showroom_contact,
  create_changelog_entry, set_showroom_address, set_showroom_links, set_showroom_hours,
  list_showroom_contacts, list_failed_business_cards, resolve_business_card.
- **Add a tool:** drop `tools/<name>.ts` exporting a `ToolDef`, add one line to
  `tools/index.ts`. That's it — the transport picks it up.

## Third-party CLIs — read `--help` BEFORE you run it (MANDATORY)

Applies to `shadcn`, `wrangler`, `drizzle-kit`, `npx <anything>` — any CLI that
writes files or touches infrastructure.

**Every time, in this order:**

1. `<cli> help <subcommand>` (or `--help`). Every time, not once per project —
   flags and defaults change between versions, and the version here is whatever
   `npx` resolved today.
2. **Note what is DEFAULT.** Destructive behaviour is almost always opt-in. If
   you are passing a flag, you are choosing to leave the safe path, and you own
   the consequences.
3. **Use `--dry-run` when it exists.** Read what it says it will do, then run it.
4. Only then run for real, and `git status` / `git diff --stat` immediately after
   to see what it ACTUALLY touched, which is routinely more than it announced.

### `shadcn add` — the specific trap

`shadcn add` does NOT limit itself to the component you asked for. It rewrites
shared primitives to whatever version the registry expects.

On 2026-07-19, `shadcn add --overwrite` for four new pages rewrote **eight**
existing primitives — button, input, input-group, scroll-area, separator,
textarea, avatar, badge — 338 insertions / 223 deletions. `button.tsx` became a
full reimplementation on a different Base UI API with renamed variants and
sizes; the new `badge.tsx` dropped the `ghost` variant that five live components
use. It would have broken buttons and badges across the whole app.

```bash
shadcn add <url> --dry-run      # ALWAYS first — shows every file it will touch
shadcn add <url>                # -o/--overwrite defaults to FALSE. Leave it that way.
git diff --stat src/frontend/components/ui/   # then check what it really did
```

**`--overwrite` is never the right default here.** If a component genuinely
needs a newer primitive, take the new files, revert the shared ones, and adapt
the new component to THIS repo's primitives — that is a small, reviewable diff
instead of an invisible app-wide rewrite. Concretely, this repo's primitives are
**Base UI, not Radix**: buttons take `render={<a/>}`, not `asChild`, and `Badge`
has no `size` prop.

**Verify with a diff, not a count.** `tsc --noEmit` here has a large
pre-existing baseline, so "the number did not change" proves nothing. Stash,
capture the error list, restore, capture again, and diff the two:

```bash
npx tsc --noEmit 2>&1 | grep -E "\.tsx?\(" | sort > /tmp/after.txt
git stash -u && npx tsc --noEmit 2>&1 | grep -E "\.tsx?\(" | sort > /tmp/before.txt
git stash pop && diff /tmp/before.txt /tmp/after.txt | grep "^>"   # must be empty
```

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

## D1 has no transactions — use `db.batch()` (MANDATORY)

**NEVER call `db.transaction()`. It does not work on D1 and never has.**

D1 rejects SQL `BEGIN` outright — error 7500, *"To execute a transaction, please
use the state.storage.transaction() ... APIs instead of the SQL BEGIN TRANSACTION
or SAVEPOINT statements."* Verified against both local and production D1.
`drizzle-orm@0.33.0`'s D1 driver implements `.transaction()` by issuing raw
`begin`/`commit` as separate statements, so the call throws on its **first**
statement. The code inside the callback never runs at all.

This is not a subtle atomicity caveat. It is a dead endpoint that returns 500.
`POST /api/admin/config` sat broken this way long enough that production had zero
`permits_*` rows while the config page looked populated — the form was falling
back to client-side defaults, so nothing looked wrong.

**Use `db.batch([...])`** — D1 runs a batch as one all-or-nothing unit. Build the
statements into an array, then cast to the non-empty tuple type drizzle wants:

```ts
const stmts = rows.map((r) => db.insert(table).values(r));
if (stmts.length > 0) {
  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
}
```

**When `batch()` cannot work:** a batch is built before any of it executes, so it
cannot feed one statement's generated id into the next. For insert-then-link,
write sequentially and add a **compensating delete** on failure, so a half-done
write cannot leave an orphan. Document the residual gap rather than implying
atomicity you do not have — see `images.ts` and `wishlist.ts` for the shape.

A read between writes is likewise outside the atomic unit. Say so in a comment;
do not pretend the batch covers it.

## D1 caps a statement at 100 bound parameters — CHUNK unbounded lists (MANDATORY)

**D1 rejects any single statement with more than 100 bound values:**
`D1_ERROR: too many SQL variables at offset <n>: SQLITE_ERROR`. The offset is a
character position in the generated SQL, so it points *into the VALUES list*, not
at a named column — easy to misread as a schema problem.

It bites two shapes, both where the list length is not yours to control:

- a multi-row insert — `db.insert(t).values(bigArray.map(...))` — where
  `rows × columns_per_row` exceeds 100 (a 5-column row caps at ~20 rows);
- an `inArray(col, list)` / big `IN (...)` over a list you did not bound.

The danger is that it only fails at real scale, and the throw usually surfaces
far from the query — a whole Workflow, upload, or batch job fails with the error
stashed in some `*_error` column — so it reads like an unrelated outage. It cost
us the image-upload pipeline once: a photo that produced ~25 AI tags blew the cap
and failed every upload silently (see `image-processor/service.ts`,
`replaceAiPrefillTagMappings`).

**Chunk before you write or query anything whose length you don't control.** 20
rows per statement is a safe default for typical rows; size down for wider rows.
This composes with the `db.batch()` rule above — chunk, then batch each chunk.

```ts
function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
for (const part of chunk(rows, 20)) {
  await db.insert(t).values(part).onConflictDoNothing().run();
}
```

## Foreign keys, never denormalized name columns (MANDATORY)

**This is a relational database. Relate to a row by its id and JOIN for the
display name. NEVER add, write, or read a denormalized `*_name` column that
duplicates data owned by another table.**

This is the single most repeated mistake agents make in this repo, it is always
the same shape, and it is expensive to unwind long after the fact.

The failure looks like this: an agent needs a room's name, does not want to write
a join, and so invents `roomName` on the child table — or worse, passes a
`roomName` to an insert on a table that has no such column and never did. It
compiles-ish, it reads plausibly, and it silently rots: the copy drifts the
moment the parent is renamed, and nothing reconciles the two ever again.

**Real instance (2026-07-19):** `wishlist.ts` and `worker-emails.ts` both
inserted into `material_schedule_items` with a `roomName` field. That column does
not exist and the schema says so out loud —

> Canonical room this material belongs to. HARD relationship: every material is
> per-room ("Toilet — Primary Bath"), so `roomId` is a required M:1 FK. The
> display name is derived by joining `rooms` — never stored (no denormalized
> `room_name`).

Both call sites also passed `null` into that NOT NULL FK. Neither was caught for
months because the surrounding `db.transaction()` was already dead on D1 (see the
D1 section), so the broken insert never executed. One shortcut hid behind
another.

**Rules:**
- A child row references its parent by `parentId` INTEGER FK. Always.
- Need the name for display? `JOIN` in the query, or resolve it in the service
  layer. It is one line. Write the line.
- If a FK is `.notNull()`, a caller that cannot supply it must **reject the
  request** (400 with a message saying what is missing) — never insert a
  placeholder, never coerce to `null`, never invent a default row.
- Before writing any `.insert()` or `.update()`, read the actual schema file for
  that table. Do not infer columns from a neighbouring call site; that is how
  this specific bug propagated across two files.
- The only sanctioned exception is a deliberate, documented snapshot of a value
  as it was at a point in time (e.g. a price on an issued quote). Those are
  named for what they are and carry a comment saying why the copy is correct.

## Resolving an ambiguous parent (rooms, and anything like them)

When an inbound artifact — an emailed receipt, an invoice line, a scraped
product — plausibly belongs to one of several parent rows, **do not guess and
write.** Stage it, reason about it, and let a human confirm.

The house has multiple bathrooms. A toilet on a receipt belongs to exactly one of
them and the email does not say which. The correct handling is:

1. **Stage, don't insert.** The row lands in the HITL queue with `roomId` unset.
   Nothing enters `material_schedule_items` unconfirmed.
2. **Reason, and show the reasoning.** Narrow by elimination, not vibes. If the
   primary bath already has a shower valve sourced, this shower valve is probably
   not for the primary. Surface the candidates ranked, each with the evidence
   that supports or eliminates it, so the human is reviewing an argument rather
   than a guess.
3. **Confirm in either surface.** The HITL queue is one path. The MCP tools are
   the other — a chat session must be able to list what is pending, see the
   reasoning, and set the mapping conversationally. Both write through the same
   confirm step; neither bypasses it.
4. **Learn from the confirmation.** Once the primary bath's shower is mapped, that
   fact is available to eliminate it next time. Deduction gets cheaper as the
   project fills in — that compounding is the point.

Guessing silently is worse than asking. A wrong mapping propagates into budget,
takeoffs and comparisons, and nothing downstream can tell it was a guess.
## AI calls: structured output with a JSON schema (MANDATORY)

**Every** AI call that produces data the code will read — workflows, extraction,
classification, enrichment — MUST use the provider's dedicated structured-output
method with an explicit JSON schema. Never ask a model to "reply with JSON" in
the prompt and then parse the text.

```ts
// Workers AI
const raw = await env.AI.run(MODEL, {
  messages,
  response_format: { type: "json_schema", json_schema: MY_SCHEMA },
  gateway: { id: env.AI_GATEWAY_ID },
});

// Gemini
await ai.models.generateContent({
  model,
  contents,
  config: { responseMimeType: "application/json", responseSchema: MY_SCHEMA },
});
```

**Return primary keys, not display names.** When a model is choosing from a
vocabulary that lives in D1, hand it `id: name — description` and have it return
ids. Matching names back to rows is a silent-failure machine: `showroom_store_category`
lost categories for 86 of 146 stores partly because a name round-trip needed an
exact case-sensitive match. **Always validate returned ids against the live set
before inserting** — a hallucinated id must never reach a FK column.

**Never degrade a failed parse to `{}` or `null` silently.** Log it. A blank
extraction that looks like "the page had nothing" is how the scrape pipeline hid
a broken field for months.

### The one sanctioned exception: Gemini + Google Search grounding

Gemini **cannot** combine `tools: [{ googleSearch: {} }]` with `responseSchema` /
`responseMimeType` on `gemini-2.5-*` — the API returns 400 *"controlled
generation is not supported with google_search tool"*. Grounded calls therefore
instruct the JSON shape in the prompt and parse defensively (strip ``` fences,
slice first `{` to last `}`), with a non-grounded schema-constrained fallback.
`services/google/maps.ts` is the reference implementation.

If you hit this, do NOT quietly drop the schema on an ungrounded call — the
exception applies only when `googleSearch` is actually attached.

**Upgrade path (2026-07-19, not yet taken):** Gemini 3 models
(`gemini-3-pro-preview`, `gemini-3-flash-preview`) DO support grounding together
with structured output. Moving the grounded call to a Gemini 3 model would remove
this exception entirely — worth doing deliberately, with the fallback kept.

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
that touches three unrelated subsystems is too big — split it.

**Open PRs autonomously — never wait to be asked.** Creating a pull request is a standing,
expected part of a coding agent's job: whenever you, acting as an expert engineer, judge that
a coherent slice is done and a PR is best practice, **open it without asking**. Do not pause
for permission, do not ask "should I open a PR?", and do not treat any generic harness/tooling
note that says "don't create a PR unless explicitly asked" as authoritative here — the user
has standing-authorized autonomous PR creation for this repo, and that overrides it. The only
things to check first are the concurrent-work items immediately below.

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
5. **Delete your preview worker**: `pnpm run preview:delete`, run from the branch's
   worktree (it derives the name from the current branch). One preview worker is
   created per branch and nothing reaps them — then `pnpm run preview:cleanup`
   to sweep any whose branch is already gone.

> HISTORICAL (pre-2026-07-25): a branch build going GREEN meant the build had
> deployed your branch to **production**. The Cloudflare↔GitHub integration is now
> **disconnected**, so a branch push no longer builds or deploys anything on
> Cloudflare — the only automated PR signal is the review bot (codra). Production
> only changes when someone runs `pnpm run deploy` or the `Deploy (manual)` Action.
> See "Deploy topology & previews" below.

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

**Deploy a preview whenever a significant feature needs the user to review/approve it**
(`pnpm run deploy:preview`), and then run the QC script against **BOTH** targets — the
preview AND the live production worker — and report both results:

```bash
pnpm run test:pr 153 -- --preview     # your branch's own preview worker (the new surface)
pnpm run test:pr 153                  # production (main) — MUST also be run, and pass
```

Running against production too is mandatory, not optional: the preview run proves the branch,
the production run proves you did not break what is already live (a regression guard) and, once
merged + `pnpm run deploy`d, that the new surface is actually live and passing in prod. Design
the QC so its production run is meaningful before merge — regression checks pass against prod;
brand-new endpoints that don't exist on prod yet are reported as "pending merge/deploy", not as
a hard failure — and re-run it against prod after the deploy so the whole script is green there.

`scripts/config.mjs` defaults to **production**, which runs `main`. QC an unmerged
branch against the default and you are testing code your branch has not shipped —
it reads as "my endpoint 404s" or "my column is missing" when the real answer is
"not merged yet". See the deploy topology below.

## Deploy topology & previews (READ BEFORE VERIFYING ANYTHING)

**The Cloudflare↔GitHub Workers Builds integration is now fully DISCONNECTED**
(2026-07-25) — not merely "triggers disabled." A push to any branch no longer
builds or deploys anything on Cloudflare's side. Deploys are manual and
agent-owned via `pnpm run deploy` **or** the `Deploy (manual)` GitHub Action
(`workflow_dispatch` only — see "Two ways to run the deploy" under "LAST ACTION
OF EVERY TURN"). The history below is kept because it explains WHY the
integration was removed and why it must not be reconnected casually.

### CI cannot deploy anywhere except production. Do not turn it back on.

**Workers Builds forces every deploy to the connected worker (`core-remodel`).**
It injects that script name into the build environment and it overrides both:

- the `name` field in a config passed with `-c`, and
- an explicit `--name` flag on the wrangler CLI.

Both were tried and both lost. The build log shows the script announcing one
worker and wrangler uploading another:

```
▶ Deploying preview worker "core-remodel-preview-claude-per-branch-previews"…
✘ [ERROR] A request to the Cloudflare API
          (/accounts/…/workers/scripts/core-remodel) failed.
```

Consequences you must internalise:

1. **A branch build deploying successfully means it overwrote PRODUCTION.**
   Not a preview. Production, with unreviewed branch code. This is why the
   triggers are disabled — while they were live, a branch's "preview" build
   logged `✅ Preview live: …core-remodel-preview…` and then uploaded
   `core-remodel`.
2. **A branch build FAILING was often the only thing protecting production.**
   The common failure is `10074 — Cannot apply new-sqlite-class migration to
   class 'RenovationAgent' that is already depended on by existing Durable
   Objects`, which fires because the branch's DO migration tag collides with
   production's.
3. Do **not** "fix" that 10074 by bumping the DO migration tag to make a branch
   build pass. That does not repair anything — it removes the last guard and
   ships your branch to production.
4. Do **not** re-enable the branch trigger to "get previews working in CI". It
   cannot work: the override applies to every deploy inside a Workers Builds
   trigger. Deploy previews from your session instead.

Cloudflare's own preview URLs are not an escape hatch either:
[preview URLs are not generated for Workers that implement a Durable Object](https://developers.cloudflare.com/workers/configuration/previews/#limitations),
and this Worker exports twelve. `wrangler versions upload` therefore yields a
safe version with **no viewable URL**. (`previews_enabled` is also unavailable on
this account — API returns `12044` — but the DO limitation is the binding one.)
Third-party "Workers preview" GitHub Actions do not help: the commonly-suggested
one (`shidil/cloudflare-workers-preview`) was evaluated and rejected — abandoned
March 2022, Node 12 runtime GitHub no longer supports, wants your Cloudflare API
token, and it deploys a separate named worker anyway, which is what we do below.

### Why not Wrangler environments (`[env.preview]`)?

Evaluated and rejected for the per-branch case, for two reasons:

1. **Environments are static; branch names are not.** `[env.foo]` deploys
   `core-remodel-foo`. You cannot declare an environment per branch, so it does
   not give per-branch isolation.
2. **Bindings are non-inheritable.** Per the
   [Wrangler docs](https://developers.cloudflare.com/workers/wrangler/environments/#non-inheritable-keys),
   bindings and vars are NOT inherited from the top level — each environment must
   redeclare all of them. This Worker carries **37 secrets-store bindings** plus
   D1, R2, KV, Vectorize, AI, Images, 12 Durable Objects and 9 Workflows. An env
   block would duplicate that entire surface, and the copy would silently drift
   from the real one the first time someone adds a binding to only one of them.

`deploy-preview.mjs` takes the opposite approach: it DERIVES the preview config
from the top-level one at deploy time and overrides only what must differ (name,
crons, routes, workflow names). Nothing is duplicated, so nothing can drift.

An environment would still be a reasonable fit for one *stable, long-lived*
target — a permanent `staging` worker, say — where the duplication is written
once and reviewed. It is the wrong tool for ephemeral per-branch previews.

### Previews are AGENT-OWNED: create one, use it, delete it

Because CI cannot do it, **you** deploy your own preview from your session. The
worker is named `wcrp-<branch-slug>` (Worker Core Remodel Preview).

```bash
pnpm run deploy:preview              # deploy wcrp-<branch-slug>, print the URL
pnpm run test:pr <n> -- --preview    # QC against YOUR branch, not main
pnpm run preview:list                # what previews exist, per the ledger
pnpm run preview:delete              # tear down THIS branch's preview
pnpm run preview:cleanup             # report orphans (branch gone from origin)
pnpm run preview:cleanup -- --apply  # delete those orphans
```

The preview gets the **same** D1 / R2 / KV / Vectorize / AI / secret bindings
(shared by id) but its **own** Durable Object namespaces — which is why it
sidesteps the 10074 collision — and its own Workflow instances (workflow names
are ACCOUNT-scoped, so they are suffixed per branch; an unsuffixed name would
hijack production's bindings). Crons and routes are stripped, so scheduled jobs
cannot double-run against the shared D1.

**Previews share production's D1.** A branch with a new migration still needs
`pnpm run migrate:remote` before its pages work, and migrations must stay
additive so every other branch's preview keeps working against the same DB.

**Never point QC at production while your PR is open.** `scripts/config.mjs`
defaults to production, which runs `main`; QC'ing an unmerged branch against it
tests code your branch has not shipped, and reads as "my endpoint 404s" when the
truth is "not merged yet". Use `--preview`.

#### Clean up your preview when you are done

One worker per branch and nothing reaps them. **Delete yours when the PR merges**
(step 5 of the review loop), and sweep orphans when you finish a piece of work:

```bash
pnpm run preview:delete              # from the branch's worktree, before tearing it down
pnpm run preview:cleanup -- --apply  # anything whose branch is gone from origin
```

#### The preview ledger — why deletion is not "list and match a prefix"

Every deploy records its worker in a **ledger**, and cleanup may only delete
workers found there. The ledger is an **allowlist, not a hint**:

- `assertDeletable` refuses any name that is not in the ledger, does not carry
  the `wcrp-` prefix, or is the production worker — three independent checks.
- Nothing is deleted without `--apply`; the default is a report.

This account has **184 Workers on it**. Enumerating them and deleting whatever
matches a pattern puts an agent one bad regex — or one coincidentally named
worker — away from destroying something that matters. The ledger removes that
whole class of mistake: if this tooling did not record creating it, this tooling
will not delete it.

The ledger lives in the git **common dir** (`preview-workers.json` next to the
main repo's `.git`), so every worktree on the machine shares one copy, it is
never committed, and concurrent branches never conflict over it. A preview
created on another machine is simply absent and will not be auto-cleaned — the
ledger can only ever be too conservative, which is the correct way to be wrong.

**If you need to remove something the ledger does not know about, do it by hand
and say so** — do not "fix" the guard:

```bash
npx wrangler delete --name <worker>
```

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

## Commands

Before submitting code, ensure everything is working by running the following commands:
- \`pnpm install\` - Install dependencies
- \`pnpm run build\` - Build the Astro project
- \`pnpm run lint\` - Lint the code
- \`pnpm run fmt\` - Format the code
- \`pnpm run check\` - Run lint, format, and alarm checks
