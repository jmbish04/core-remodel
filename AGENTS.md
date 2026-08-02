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

## Architecture

This project uses an Astro + shadcn/ui template on Cloudflare Workers.
Key components:
- Frontend: Astro SSR, Tailwind CSS, shadcn/ui components
- Backend API: Hono
- Database: D1 (SQLite) with Drizzle ORM
- Assets: R2

## Commands

Before submitting code, ensure everything is working by running the following commands:
- \`pnpm install\` - Install dependencies
- \`pnpm run build\` - Build the Astro project
- \`pnpm run lint\` - Lint the code
- \`pnpm run fmt\` - Format the code
- \`pnpm run check\` - Run lint, format, and alarm checks

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
