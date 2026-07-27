# DESIGN_SPEC — 0036 PhaseGroupedTaskGrid

Hand-off brief for the shared task grid. Reference: the owner's `TaskManagementGrid`. Rebuild it on THIS
repo's shadcn/Monolith primitives — do **not** paste the raw-Tailwind reference. Load `get-ui-principle`,
`get-ux-principle`, and the `shadcn`/`shadcn-ui` skills first; self-review with `get-review-rules`.

## Where it renders
| Surface | File | Mode |
|---|---|---|
| Preview (proposed) changelog | `components/changelog/ProposalBundle.tsx` | `proposed` |
| Committed changelog detail | `components/changelog/ChangelogEntryView.astro` → island | `committed` |
| Plans board | `/admin/plans/<slug>` island | `board` |

All are React islands (`client:only="react"`) inside the standard `<BaseLayout>` shell (`class`, not
`className`, in `.astro`; header block per `studio.astro`).

## Component anatomy (parity with the reference)
1. **Header** — title + "N tasks · Grouped by phase" subline; primary action only where editing is allowed
   (board), hidden in `committed`.
2. **Tabs** — All / Active / Backlog with count pills. `Active` = status ≠ done; `Backlog` = status pending.
3. **Toolbar** — Filters button, a "Task contains …" search input group, Settings. Search matches task + subtask
   titles.
4. **Grid** (semantic `<table>`, `overflow-x-auto` wrapper so it never widens the page):
   - **Phase group header row** — full-width, uppercase, `{phaseTitle} ({count})`, muted background.
   - **Parent task row** — disclosure chevron (only if it has subtasks; `aria-expanded`), completion checkbox,
     title (line-through + muted when done), StatusBadge, assignee (avatar or initials), PriorityBadge,
     workstream/project chip, row-hover `⋯` menu.
   - **Subtask rows** — indented (`pl-12`), smaller checkbox/avatar, same columns; shown only when expanded.
5. **Footer** — rows-per-page + pager (board/preview; omit for short committed lists).

## Badges (repo primitives — `Badge` has NO `size` prop)
- **StatusBadge** — dot + label. Map `plan_tasks.status`: `pending`→Todo (sky), `in_progress`→In Progress
  (amber), `in_review`→Review (violet), `blocked`→Blocked (red), `deferred`→Deferred (muted), `done`→Done
  (emerald). Use the OKLCH Monolith palette, not raw `bg-amber-500`.
- **PriorityBadge** — `urgent`/`high`/`medium`/`low` (destructive / amber / sky / muted), bordered pill.
- **changeType chip** (optional) — new/move/update/delete/keep/investigate/recover, subtle.

## States (all required)
- **Loading** — skeleton rows (3 phase groups × 2 rows).
- **Empty** — "No tasks yet" (proposed) / "Nothing shipped in this phase" (committed).
- **Filtered-empty** — "No tasks match the filter."
- **Error** — inline retry (fetch failed).
- **Live update** — a `update_plan_task` poke restyles a row in place (status/PR chip) without a full reload.

## Interaction parity
- Disclosure chevron rotates 90° on expand; keyboard-toggle (Enter/Space); `aria-expanded`.
- Checkbox toggles `status` (board/preview only; **read-only in `committed`**).
- Row hover reveals the `⋯` menu; focus-visible rings on every control.
- Search is debounced; tab + search compose.

## Data → props
`{ planSlug, tasks: PlanTask[], phases: {phase:number,title:string}[], mode }`. Group by `phase` (ordered by
`plan_phases.sort_order`), then by `plan_tasks.sort_order`. Subtasks = tasks whose `parent_task_key` matches a
parent's `task_key`. Assignee via `assignee_participant_id → planning_participants → users` (initials fallback;
avatar from CF Images, never Unsplash). PR chip when `pr_number` set; changelog link when `changelog_slug` set.

## Theme / tokens
Dark-theme-first Monolith: rings + dividers, not 1px borders; high-contrast type; OKLCH status/priority colors
that pass AA in light AND dark. `@media (prefers-color-scheme)` + `[data-theme]` both handled. Relative units;
table scrolls inside its own container.

## Out of scope (this spec)
Drag-reorder, saved views, assignee-picker authoring (needs 0034 users), multi-plan cross-board views.
