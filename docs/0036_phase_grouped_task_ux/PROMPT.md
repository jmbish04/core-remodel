# PROMPT — 0036 Phase-Grouped Task/Changelog UX

Implement `docs/0036_phase_grouped_task_ux/IMPLEMENTATION_PLAN.md` + `DESIGN_SPEC.md`. Fresh worktree from
`origin/main`. **Frontend work → load `get-ui-principle`, `get-ux-principle`, the `shadcn`/`shadcn-ui` skills
first; self-review with `get-review-rules`.**

## Non-negotiables
- **One shared component** `<PhaseGroupedTaskGrid>` powers ALL changelist surfaces (preview + committed + plans
  board). One data source: `plan_tasks` grouped by `phase`. No second task model.
- **shadcn/Monolith primitives only.** Base UI (`render=`, NOT Radix `asChild`); `Badge` has no `size` prop.
  `shadcn add --dry-run` before any `add`; then `git diff --stat src/frontend/components/ui/` to confirm it
  didn't rewrite shared primitives.
- **`.astro` shells use `class`, never `className`**; page shell matches `studio.astro`. Islands are `client:only="react"`.
- **No comma-multi-values, no denormalized names.** status/priority/changeType stay the existing enums; assignee
  via join, not a stored name.
- **Backward-compatible migrations** (`db:generate` + `migrate:remote`); `db.batch` not `db.transaction`; verify
  `tsc` delta empty (stash-diff method, the baseline is noisy).
- **Deploy is yours** (preview a review build); state deploy/migration/QC each turn.

## Phase A — data structures
1. `A1` `plan_tasks.parent_task_key` TEXT nullable (self-ref within `plan_slug` by `task_key`) for subtasks.
2. `A2` `plan_phases` table (`plan_slug`, `phase` int, `title`, `sort_order`; `UNIQUE(plan_slug, phase)`);
   seed it from the `phases[]` that `submit_feature_proposal` already receives (update the proposal service +
   `POST /api/changelog/proposals`). Backfill existing plans' phase titles.
3. `A3` `changelog_entries.plan_slug` TEXT nullable; backfill from the matching `changelog_proposals.plan_slug`.
4. `A4` `GET /api/admin/plans/<slug>` returns tasks nested by phase (with `plan_phases` titles) + subtasks;
   `migrate:remote`; QC.

## Phase B — the component
1. `B1` Build `<PhaseGroupedTaskGrid>` per DESIGN_SPEC: phase group headers + counts, parent rows w/ disclosure,
   indented subtasks, StatusBadge/PriorityBadge (OKLCH Monolith colors), assignee avatar/initials,
   workstream chip, search + tabs (all/active/backlog), pagination. All states (loading/empty/filtered/error).
2. `B2` A11y: keyboard disclosure (`aria-expanded`), focus rings, semantic table in an `overflow-x-auto` wrapper.
3. `B3` Realtime: subscribe to the plan room; a `update_plan_task` poke restyles the row in place.
4. `B4` Light + dark verified (screenshots); `get-review-rules` pass.

## Phase C — wire every surface
1. `C1` Preview: `ProposalBundle.tsx` → `<PhaseGroupedTaskGrid mode="proposed">`.
2. `C2` Committed: `ChangelogEntryView.astro` / `[slug].astro` → `mode="committed"` from the entry's `plan_slug`
   (read-only; done/shipped tasks). Keep `changes[]` for prose/migrations.
3. `C3` Plans board `/admin/plans/<slug>` → `mode="board"`. Delete the old bespoke boards.
4. `C4` QC (identical grid on all three) + changelog + link.

## Phase D — optional (depends on 0034)
Real assignee avatars via `users`; subtask authoring UI.

## Do NOT
Paste the raw-Tailwind reference; add a second task table; use Unsplash/hardcoded avatars; `shadcn add`
without `--dry-run`; put content flush top-left with a `className` header in an `.astro` shell.
