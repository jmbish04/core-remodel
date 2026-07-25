# 0031 — Coding-agent prompt

You are building the Drive List Ops overhaul. Read `IMPLEMENTATION_PLAN.md`,
`DESIGN_SPEC.md`, and `TASKS.json` in this folder first. PR-A (#244) already shipped the
map/coord fix and the stop-card action strip — do NOT redo it.

## First actions
1. Verify the worktree is fresh vs `origin/main` (`pnpm run worktree:check`). Cut a fresh
   worktree from `origin/main` per phase.
2. **Phase C depends on PR #242** (`claude/tesla-telemetry-webhooks-2jnnj9`): it edits the
   same `PATCH /api/drive-lists/:slug` activation handler (adds a Tesla-stream DO signal)
   and adds `src/backend/services/tesla/gating.ts` (the 07:00–20:00 activation window).
   Build C on top of #242 (rebase onto it or wait for merge). Do not clobber its handler edit.

## Ship order — one PR per phase
- **PR-B** (per-stop interactions): B1–B9. Schema (drive_list_notes + stop columns) → API
  (notes CRUD, rating→visit, skip) → FE (alerts, rating modal, skip). New dep `@reui/c-alert-5`.
- **PR-C** (active drive + live timing, on #242): C1–C8. Schema (start capture) → API
  (/active, activation capture, /plan feasibility) → FE (activate btn, global banner, timing).
  New dep `@reui/c-button-53`.
- **PR-D** (modals + pitstops): D1–D4. Proximity pitstop generator (D1-only, no Google cost)
  + promote → showroom detail modal → pitstop rendering.

## Hard rules (repo)
- **D1 has no transactions** — use `db.batch()`. Chunk any unbounded list at ~20 rows /
  ≤100 bound params. Drives are bounded (≤24 core stops) but pitstop scans are not.
- **FKs, never denormalized name columns.** Rating writes to the showroom visit log by
  `showroomStoreId`; resolve display names by join. Reject (400) a rating on a stop with no
  linked showroom — never insert a placeholder.
- **drizzle-0.33 `.set()` inference is fragile** — keep new queries in the service layer,
  verify with the stash-diff method, judge by `pnpm run build` (esbuild) not raw tsc.
- **shadcn/reui `add` rewrites shared primitives** — `--dry-run` first, `git diff --stat
  src/frontend/components/ui/` after, revert anything unrelated. Primitives here are Base UI
  (buttons take `render={<a/>}`, not `asChild`; no Radix dialog props).
- **Migrations**: `pnpm run db:generate` → `pnpm run migrate:remote`, verify on remote,
  additive only (previews share prod D1). Never hand-edit migrations.
- **Notes are plain text by design** (on-the-go), not PlateJS — this is the one flagged
  deviation from the rich-text rule; keep it.
- **Every affordance degrades for unlinked stops** (no rating/modal/timing), never errors.

## Per phase
- Seed nothing new in the plan board — the rows exist (`plan_tasks`, slug `drive-list-ops`).
  Mark a task `in_progress` when you start it, `done` + PR number when it merges.
- QC: `scripts/qc/pr_<n>.mjs` using the shared helpers; run against the branch preview AND
  prod; paste output into the PR + changelog.
- Changelog: branch row + entry + `PhaseDetail` with Mermaid + real QC output + remote
  migration status. PR body links `/admin/changelog/<slug>`.
- Deploy: preview only from a branch; prod only from `main` after merge (`pnpm run deploy`
  or the manual Deploy action). Delete the preview on merge.
