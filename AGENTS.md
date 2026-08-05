# AGENTS.md - Grounding Profile & Architectural Alignment Map

## Repository Overview
This repository (`jmbish04/core-remodel`) is an Astro shadcn/ui template. It uses Astro for the web framework, Tailwind CSS for styling, and shadcn/ui for frontend components.
The default branch is `main`.

## Guidelines for Autonomous Agents
* **Do not assume conventions:** Do not assume or invent repository conventions or testing scripts. Explicitly verify and use the exact scripts defined in `package.json`.
* **Documentation:** Never overwrite or delete any existing docstrings in the codebase; only add missing ones.


# Verified on: 2026-05-20

## FIRST ACTION OF EVERY SESSION - verify the branch is fresh

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
whether another session left uncommitted files here. **>=25 behind prints a loud
STALE CHECKOUT warning - believe it.** The check only informs; it never blocks,
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
  gives no hint. Comparing against local `main` is always wrong - compare
  against `origin/main`, always, and only after an explicit `git fetch`.
- Long-lived worktrees rot fast. This repo merges to `main` frequently, so **the
  code you should be reasoning about is `origin/main`** - never the branch you
  happen to be sitting in. Any bug reported from a production URL must be
  reproduced against `origin/main`.
- The failure is silent and expensive. It manufactures false conclusions about
  features being "missing" or "broken" when they were built, renamed, or
  replaced upstream, and any code written against the stale tree conflicts hard
  on merge.

**Prefer a fresh worktree cut from `origin/main` for each new piece of work over
reusing an existing one.** Reusing a worktree from a previous session is the
main way this goes wrong. If you must reuse one, the check above is mandatory.

When picking up work described by an earlier session or a memory file, re-verify
its claims against `origin/main` before acting - those notes reflect the tree as
it was, and the named files, routes, and components may have moved or been
replaced.

## Build, Test, & Linting (MANDATORY)

Autonomous agents must know and run these checks before concluding their work.
Do not assume or invent repository conventions or testing scripts. Explicitly
verify and use the exact scripts defined in `package.json`:

- `pnpm install` - install dependencies.
- `pnpm dev` or `pnpm start` - run the local Astro dev server.
- `pnpm run build` - build the Astro project.
- `pnpm run fmt` - run `oxfmt` formatter. **WARNING:** Running `pnpm run fmt` globally can cause massive unintended formatting changes across thousands of files. When formatting, target only the specific files you have modified.
- `pnpm run lint` - run `oxlint` linter.
- `pnpm run check` - run both lint and fmt checks (and `check-do-alarms.mjs`).
- `pnpm run db:generate` - Database generation.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` - Type checking must be run manually using this command to prevent heap out of memory errors, because the project's build process does not perform type checking.

## Cloudflare Durable Objects (MANDATORY)
- **NEVER use `this.schedule()`** - The repository explicitly bans the use of the append-only `this.schedule()` in Cloudflare Durable Objects to prevent runaway billing. Use native `ctx.storage.setAlarm()` instead. This is enforced by `scripts/check-do-alarms.mjs` during `pnpm run check`.

## System Identity & Role Enforcements
You are an elite Senior Engineer operating within the Google Antigravity IDE framework. Your primary objective is shipping high-performance, self-healing architectures across the Cloudflare Ecosystem.

## Detected Structural Components
- **Routing Tier:** Hono API Framework (Serving OpenAPI v3.1.0)
- **Frontend Layer:** Astro Web Engine + Shadcn (Default Dark Theme Architecture)
- **Data Persistence:** Drizzle ORM + D1 Serverless SQL Storage Core
- **Cognitive Orchestration:** @cloudflare/agents SDK Layer

## The renovation-studio MCP server - one file per tool

There are **two** MCP servers in this repo; do not conflate them:
1. The OAuth connector at `src/backend/mcp/` (0015 - see the "MCP Server" section
   below). Claude.ai custom connector.
2. **The bearer-auth "renovation-studio" server at `src/backend/api/routes/mcp/`**
   (mounted `/api/mcp`) - render, mood-board, measurement, deep-research, and
   showroom/changelog/business-card tools. This section is about (2).

- **Tool count is whatever lives in `mcp/tools/` on the branch you are on - nothing
  else.** `mcp/tools/index.ts` (the `TOOLS` array) is the single source of truth.
  Count with `ls src/backend/api/routes/mcp/tools/*.ts` or read that barrel - never
  trust memory or another branch.
- **Layout:**
  - `index.ts` - transport only (JSON-RPC over streamable HTTP): auth, dispatch,
    invocation logging, `structuredContent`. No tool logic. Default-exports the router.
  - `tools/<tool_name>.ts` - **one file per tool.** Filename == MCP tool name. Each
    exports a `ToolDef` (`types.ts`): `{ name, description, inputSchema, research?, handler }`.
  - `auth.ts` - worker bearer (`Authorization: Bearer <WORKER_API_KEY>`) OR a scoped
    Deep Research token (limited to tools flagged `research: true`).
  - `lib/` - shared render + research helpers. `types.ts` - `ToolDef`/`ToolCtx`.
- **On `main`: 21 tools.** create_render_session, list_room_angles, run_render_stage,
  generate_mood_board, list_mood_boards, list_rooms, highlight_wall, add_measurement,
  list_measurements, get_measurement_coverage, get_deep_research_context,
  record_deep_research_progress, record_deep_research_source, create_showroom_contact,
  create_changelog_entry, set_showroom_address, set_showroom_links, set_showroom_hours,
  list_showroom_contacts, list_failed_business_cards, resolve_business_card.
- **Add a tool:** drop `tools/<name>.ts` exporting a `ToolDef`, add one line to
  `tools/index.ts`. That's it - the transport picks it up.

## Third-party CLIs - read `--help` BEFORE you run it (MANDATORY)

Applies to `shadcn`, `npx <anything>` - any CLI that writes files or touches infrastructure.

**Every time, in this order:**

1. `<cli> help <subcommand>` (or `--help`). Every time, not once per project -
   flags and defaults change between versions, and the version here is whatever
   `npx` resolved today.
2. **Note what is DEFAULT.** Destructive behaviour is almost always opt-in. If
   you are passing a flag, you are choosing to leave the safe path, and you own
   the consequences.
3. **Use `--dry-run` when it exists.** Read what it says it will do, then run it.
4. Only then run for real, and `git status` / `git diff --stat` immediately after
   to see what it ACTUALLY touched, which is routinely more than it announced.

### `shadcn add` - the specific trap

`shadcn add` does NOT limit itself to the component you asked for. It rewrites
shared primitives to whatever version the registry expects.

On 2026-07-19, `shadcn add --overwrite` for four new pages rewrote **eight**
existing primitives - button, input, input-group, scroll-area, separator,
textarea, avatar, badge - 338 insertions / 223 deletions. `button.tsx` became a
full reimplementation on a different Base UI API with renamed variants and
sizes; the new `badge.tsx` dropped the `ghost` variant that five live components
use. It would have broken buttons and badges across the whole app.

```bash
shadcn add <url> --dry-run      # ALWAYS first - shows every file it will touch
shadcn add <url>                # -o/--overwrite defaults to FALSE. Leave it that way.
git diff --stat src/frontend/components/ui/   # then check what it really did
```

**`--overwrite` is never the right default here.** If a component genuinely
needs a newer primitive, take the new files, revert the shared ones, and adapt
the new component to THIS repo's primitives - that is a small, reviewable diff
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

## Page styling - consistent shell for EVERY page (MANDATORY)

Every page is a **thin Astro shell** mounting one React island, wrapped
in `<BaseLayout>`, and MUST follow this exact structure. The canonical example is
`src/frontend/pages/admin/studio.astro`. A page that jams content into the top-left
with an unstyled header is almost always breaking rule (1) below.

1. **In `.astro` files, use `class`, NEVER `className`.** Astro only applies `class`.
   A `className` on a native element (`<main>`, `<div>`, `<h1>`) renders as a dead
   attribute - Tailwind classes never apply, so the container/padding/typography
   silently vanish and the page collapses to the top-left. (Inside `.tsx` islands,
   `className` is correct - this rule is about `.astro` shells only.)
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
   The icon is REQUIRED - pick one that matches the page (e.g. a cog for config).
4. The island mounts below the header: `<TheApp client:only="react" />`.

When you touch or create a page that violates this (no icon, wrong/`className`
header, content flush to the top-left), fix it to match `studio.astro`.
