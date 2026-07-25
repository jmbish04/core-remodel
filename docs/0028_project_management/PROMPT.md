# 0028 — Coding agent prompt

Copy-paste this to the agent that builds a phase of 0028. **Replace `<PHASE>`.**

---

You are implementing **Phase `<PHASE>` of plan `0028_project_management`** in the
`core-remodel` Cloudflare Worker.

## Before you read a single source file

```bash
pnpm run worktree:check      # or: git fetch origin main -q && git log --oneline HEAD..origin/main | wc -l
```

If the count is not 0, **stop** and rebase onto `origin/main` or cut a fresh
worktree from it. A stale worktree manufactures confident, entirely wrong analysis
about features being "missing" when they were built or renamed upstream. Prefer a
fresh worktree per phase over reusing one.

## Read these first, in this order

1. `docs/0028_project_management/IMPLEMENTATION_PLAN.md` — architecture and schema deltas
2. `docs/0028_project_management/PRD.md` — who this serves and why
3. `docs/0028_project_management/DESIGN_SPEC.md` — component spec (only if your phase touches UI)
4. `docs/0028_project_management/TASKS.json` — your phase's tasks, and the D1 rows that mirror them
5. `CLAUDE.md` — deploy contract, D1 rules, component rules. Non-negotiable.

Then read your live task list:

```
list_plan_tasks(planSlug="0028_project_management", phase=<PHASE>)
```

`plan_tasks` in D1 is the source of truth, not the JSON file. If they disagree, D1 wins.

## The single most important architectural rule

**Do not merge the task tables.** `plan_tasks` (software) and `planning_tasks`
(remodel) both stay. Everything goes through the `WorkItem` contract and a per-source
adapter. Components never learn which table they are reading. If you find yourself
writing a migration that moves rows between those two tables, you have misread the
plan — stop and re-read §2.

## Reuse before you build

This repo already contains more than it looks like. Before writing anything:

- **Gantt** — `src/frontend/components/kibo-ui/gantt/` is complete: drag-move, edge
  resize, today marker, custom markers, sidebar groups, daily/monthly/quarterly
  ranges. Wrap it. Do not write a timeline engine.
- **Kanban** — `src/frontend/components/clickup/ClickUpKanban.tsx` is a working
  dnd-kit column board. Generalize it off the ClickUp type. Do not start over.
- **Critical path** — `src/backend/ai/agents/RemodelOrchestrator/critical-path.ts`
  already implements Kahn topological sort and CPM. Import it.
- **Charts** — recharts 3.8, visx, mermaid, dnd-kit core + modifiers, date-fns and
  jotai are installed. Add no new dependency for something a few lines can do.
- **Permit sync, email pipeline, contract extraction, Vectorize indexes** — all live.

## Hard rules from CLAUDE.md that bite on this feature specifically

- **`db.transaction()` does not work on D1.** It throws on its first statement and
  the callback never runs. Use `db.batch([...])`. Where a batch cannot work (an
  insert whose generated id feeds the next statement), write sequentially with a
  compensating delete on failure and document the residual gap — do not imply
  atomicity you do not have.
- **Foreign keys, never denormalized name columns.** No `assignee_name`, no
  `room_name`, no `plan_title`. Relate by id, JOIN for the display name. If a FK is
  `.notNull()` and a caller cannot supply it, **reject the request with a 400 saying
  what is missing** — never insert a placeholder or coerce to null. Read the actual
  schema file before every `.insert()`; do not infer columns from a neighbouring
  call site.
- **Migrations:** `pnpm run db:generate` then `pnpm run migrate:remote`. Never raw
  SQL, never hand-edit a migration file. Additive and nullable/defaulted only —
  every other branch's preview worker runs against this same production D1.
- **AI calls** use the provider's structured-output method with an explicit JSON
  schema. Return primary keys, not display names, and validate returned ids against
  the live set before they touch a FK column. Never degrade a failed parse to `{}`
  or `null` silently — log it.
- **In `.astro` files use `class`, never `className`.** A `className` on a native
  element is a dead attribute; the Tailwind classes vanish and the page collapses to
  the top-left. Inside `.tsx` islands `className` is correct.
- **Page shell:** `<BaseLayout>` → `<main class="container mx-auto px-4 py-8 pb-12">`
  → an `mb-8` header block with a `size-6` lucide icon inside the `<h1>` and a
  one-line `text-muted-foreground` description → the island. Canonical example:
  `src/frontend/pages/admin/studio.astro`.
- **Money** is stored as both `<field>_text` and `<field>_cents`. **Rich text** is
  stored as both `<field>_markdown` and `<field>_html`. **Multi-selects** are a
  definition table plus a mapping table — never a comma-separated string.
- **MCP tools:** one file per tool at `src/backend/mcp/tools/<domain>/<tool_name>.ts`,
  filename equal to the tool name, bare snake_case verb with no prefix, hand-written
  Zod v4 `inputShape` (**never import drizzle-zod — it breaks the build**), correct
  annotation from `types.ts`, at least one `example`. Export from the domain
  `index.ts` and add the array to `ALL_TOOL_GROUPS`.
- **`pnpm run build` is esbuild and does not type-check.** Run `npx tsc --noEmit` on
  what you touched. There is a pre-existing error baseline; do not add to it.

## Task hygiene — this is the feature, so live it

- Start by calling `list_plan_tasks` for your phase and marking what you begin as
  `in_progress`.
- Discover new work → `create_plan_task`, not a note in prose.
- Finish work → `close_plan_task` with the **PR number**. It will refuse without one.
- A phase is not done because the code compiles. It is done when its task rows say so.

## Definition of done for your phase

1. Every task row for the phase is `done` with a PR number, or explicitly `blocked`/
   `deferred` with a note saying why.
2. `npx tsc --noEmit` adds no new errors.
3. Schema changed → `pnpm run migrate:remote` run, and the column or table **verified**
   to exist on remote.
4. `scripts/qc/pr_<n>.mjs` written using `scripts/config.mjs` + `scripts/tokens.mjs`,
   and run against **both** targets, with both results reported:
   ```bash
   pnpm run deploy:preview
   pnpm run test:pr <n> -- --preview
   pnpm run test:pr <n>
   ```
5. Changelog rows written to D1 (branch + entry + `PhaseDetail` with a `verification`
   block containing the real QC output — paste what ran, never paraphrase), and the
   PR description carries
   `Changelog: https://core-remodel.hacolby.workers.dev/admin/changelog/<slug>`.
6. Before opening the PR, check for concurrent work — `git worktree list`,
   `gh pr list --limit 20` and read their file lists. This repo is worked by several
   sessions at once and overlapping edits to one file is the expensive failure mode.
   Rebase onto `origin/main` before opening and again before merging.
7. After merge: `pnpm run deploy` from `main`, then `pnpm run preview:delete` from
   this branch's worktree.
8. State plainly at the end of the turn whether you deployed, whether migrations were
   applied to remote, and what the QC result was. "Done" is not a status.

## Things you must NOT do in 0028

- Do not build multi-user authentication. Every read goes through `viewerContext()`,
  which returns `{ isAdmin: true }` today. That seam is the deliverable; real logins
  are plan 0029.
- Do not send any email or SMS. NagBot drafts only. Choosing a transport is a spend
  decision that needs the homeowner's explicit approval first.
- Do not replace ClickUp. It stays the master record for remodel tasks.
- Do not "fix" a DO migration-tag collision by bumping the tag to make a branch build
  pass — that ships your branch to production.
- Do not add a sixth top-level component because a fifth "just needs a flag". Give it
  its own component or leave it out.
