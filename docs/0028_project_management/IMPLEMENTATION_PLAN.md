# 0028 — Project Management: one component layer, two projects

**Status:** Draft for review
**Date:** 2026-07-22
**Branch:** `claude/reusable-project-mgmt-components-611245`
**Design source:** `docs/system/0001_pmo/` (7 ReUI prototype pages)
**Preview changelog:** `/admin/changelog/preview/0028_project_management`

---

## 1. Context — what already exists

This is not a greenfield build. The worker already has **three** task systems that
share no keys, plus a Gantt component nobody feeds real data to. The point of 0028
is to stop building a fourth and instead put **one reusable component layer** over
what is already here.

| System | Tables | Dates? | Deps? | Surface today |
|---|---|---|---|---|
| **Software roadmap** | `plans` + `plan_tasks` | ❌ none | `depends_on` JSON, rendered as chips and otherwise ignored | `/admin/plans`, `/admin/plans/[slug]` (a vertical accordion, not a board) |
| **Remodel delivery** | `planning_tasks`, `planning_epics`, `planning_participants`, `planning_task_updates` | ✅ `start_date`, `due_date` | `depends_on_task_ids` JSON | `/admin/pmo/operations` (`PlanningApp.tsx`, 761 lines) |
| **ClickUp** | `clickup_revision_log`, `clickup_task_flags`, `clickup_system_alerts` | live from API | — | `/admin/tasks` (read-through proxy) |

Already built and **reusable as-is**:

- `src/frontend/components/kibo-ui/gantt/` — a complete Gantt: drag-move, edge
  resize, today marker, custom markers, sidebar groups, `daily`/`monthly`/`quarterly`
  ranges. Currently fed **hardcoded** scenario data by `ContractorScheduleApp.tsx`.
- `src/frontend/components/clickup/ClickUpKanban.tsx` — a real dnd-kit column board.
  Hardwired to ClickUp's task type; needs generalizing, not rewriting.
- `RemodelOrchestrator` DO — already implements **Kahn topological sort + critical
  path method** (`critical-path.ts`, 271 lines) and a D1-backed circuit breaker. It
  is dormant only because `clickupListId` is never set on its state.
- `submit_feature_proposal` MCP tool — already writes `plans` + `plan_tasks` rows
  from a `tasks[]` array. The "coding agent creates tasks" path exists.
- `changelog_branches` / `changelog_entries` / `changelog_proposals` (+ R2 transcript
  storage) — the preview-changelog and changelog machinery.
- recharts 3.8, visx, mermaid, dnd-kit core+modifiers, date-fns, jotai — installed.

### Gaps that block the vision (state these plainly, do not paper over them)

1. **There is no multi-user auth.** The live gate is a single shared password
   cookie: `remodel_access` = SHA-256 of `WORKER_API_KEY` (`src/backend/utils/access.ts`).
   The `users` and `sessions` tables exist but nothing reads them. There are no
   roles, no memberships, and no per-record ACL anywhere in the schema. **Contractor
   logins do not exist.** 0028 builds the *permission substrate* (who is attached to
   a work item and in what role) and gates every read behind a single
   `viewerContext()` seam — but real multi-user sign-in is its own plan (0029).
2. **There is no outbound message transport.** `send_email` is declared in
   `wrangler.jsonc` and typed in `worker-configuration.d.ts` but never referenced in
   `src/`. There is no Twilio, no SMS, no push. NagBot has nowhere to send.
3. **ClickUp sync is 0% built.** No webhook handler, no D1 mirror of tasks, and the
   orchestrator's audit loop bails out (`status: "skipped"`) because no route ever
   calls `configureList()`.
4. **No shipment/tracking concept.** `"shipping"` is a value in the email
   classification enum with no table and no handler downstream.
5. **`plan_tasks` has no dates, assignee, effort, or progress** — so it cannot feed
   a Gantt, a burndown, or a velocity metric.

---

## 2. The core architectural decision

> **Do not merge the task tables. Merge the read model.**

A single grand `work_items` table would mean migrating two live systems, rewriting
`PlanningApp`, `admin-plans.ts`, `planning-extended.ts`, `PlanBoardApp`, and the
seeder — before a single new pixel ships. That is the expensive wrong move.

Instead:

```
                    ┌──────────────────────────────────────┐
                    │  Reusable component layer (React)    │
                    │  WorkBoard · WorkGrid · WorkBacklog  │
                    │  WorkGantt · VelocityDashboard       │
                    │  (consume WorkItem[], source-blind)  │
                    └───────────────┬──────────────────────┘
                                    │ WorkItem contract
                    ┌───────────────┴──────────────────────┐
                    │        WorkItemAdapter (per source)  │
                    │  read() · updateStatus() · reorder() │
                    │  setDates() · assign() · watchers()  │
                    └──┬─────────────────┬──────────────┬──┘
                       │                 │              │
             ┌─────────▼──────┐ ┌────────▼───────┐ ┌────▼──────────┐
             │  plan_tasks    │ │ planning_tasks │ │ clickup mirror│
             │  (software)    │ │  (remodel)     │ │  (P6)         │
             └────────────────┘ └────────────────┘ └───────────────┘
```

`WorkItem` is the normalized shape every view renders. Each source owns its own
adapter; components never learn which table they are looking at. Adding ClickUp in
P6 is a third adapter, not a rewrite.

### The `WorkItem` contract

```ts
// src/shared/pmo/types.ts — imported by BOTH backend services and frontend islands
export type WorkSource = "plan" | "planning" | "clickup";

export type WorkStatus =
  | "backlog" | "todo" | "in_progress" | "in_review"
  | "blocked" | "deferred" | "done";

/** Health is an INDEPENDENT axis from status — a task can be in_progress + at_risk. */
export type WorkHealth = "on_track" | "at_risk" | "blocked" | "unknown";

export type WorkPriority = "urgent" | "high" | "medium" | "low";

export interface WorkItem {
  source: WorkSource;
  /** Stable composite id: `${source}:${nativeId}`. Never parsed for meaning. */
  id: string;
  nativeId: string;
  /** Human key: "P1-NAV-01" (plan) or "RDM-184" (planning). Displayed. */
  key: string;
  containerKey: string;          // plan slug / epic id / clickup list id
  parentId: string | null;       // 1 level of nesting, per the prototypes
  title: string;
  description: string | null;
  groupLabel: string;            // workstream (software) | epic or room (remodel)
  phase: number | null;
  status: WorkStatus;
  health: WorkHealth;
  priority: WorkPriority | null;
  progressPct: number | null;    // 0-100, null renders "-"
  effortPoints: number | null;
  startAt: string | null;        // ISO date
  dueAt: string | null;          // ISO date
  completedAt: string | null;
  dependsOn: string[];           // WorkItem.key values
  people: WorkPerson[];          // owner / assignee / cc — see §4
  links: WorkLink[];             // PR, changelog entry, room, material, shipment
  sortOrder: number;
  updatedAt: string;
}
```

**Rule (non-negotiable, per CLAUDE.md):** `people` and `links` are resolved by JOIN
at read time. No `assignee_name`, no `room_name`, no denormalized display column
anywhere in this feature.

### Vocabulary reconciliation

The prototypes use two competing status vocabularies (`Todo`/`To Do`, `Review`/`In Review`,
plus a health axis `On track`/`At risk`). We model **both axes**, and map:

| `plan_tasks.status` | `planning_tasks.status` | → `WorkStatus` |
|---|---|---|
| `pending` | `pending` | `todo` |
| `in_progress` | `in_progress` | `in_progress` |
| — | — | `in_review` (new) |
| `blocked` | `blocked` | `blocked` |
| `deferred` | `delayed` | `deferred` |
| `done` | `done` | `done` |

`health` is **derived**, not stored: `blocked` status → `blocked`; `dueAt` in the
past and not done → `at_risk`; a dependency that is late → `at_risk`; else `on_track`.
Deriving it means it can never go stale, which a stored column always does.

---

## 3. Schema deltas

Additive only. Every migration must keep every other branch's preview worker
working against the shared production D1.

### 3.1 Extend `plan_tasks` (software roadmap gains a schedule)

```
+ start_date            TEXT           -- ISO date, nullable
+ due_date              TEXT           -- ISO date, nullable
+ progress_pct          INTEGER        -- 0-100, nullable
+ effort_points         INTEGER        -- nullable
+ priority              TEXT enum urgent|high|medium|low, nullable
+ assignee_participant_id INTEGER FK → planning_participants.id, nullable
+ pr_number             INTEGER        -- the PR that closed it (see §6)
+ changelog_slug        TEXT           -- soft link → changelog_entries.slug
+ status enum GAINS 'in_review'
```

### 3.2 Extend `plans`

```
+ domain      TEXT enum software|remodel  NOT NULL DEFAULT 'software'
+ start_date  TEXT
+ target_date TEXT
```

### 3.3 New: `work_item_watchers` — the permission substrate

This is the table the whole access model hangs off. It is deliberately generic so
it covers both sources, and it is written now even though enforcement is stubbed,
so the seam exists when 0029 lands real logins.

```
work_item_watchers
  id                     INTEGER PK autoincrement
  source                 TEXT enum plan|planning|clickup  NOT NULL
  item_native_id         TEXT NOT NULL      -- plan_tasks.id | planning_tasks.id
  participant_id         INTEGER NOT NULL FK → planning_participants.id
  role                   TEXT enum owner|assignee|cc|approver  NOT NULL
  can_edit               INTEGER bool NOT NULL DEFAULT 1
  added_by_participant_id INTEGER FK → planning_participants.id
  created_at / updated_at
  UNIQUE (source, item_native_id, participant_id, role)
  INDEX (participant_id), INDEX (source, item_native_id)
```

`can_edit` defaults to true — per the brief, "assume everything: if somebody's added
to something, they can see it and edit it." The column exists so view-only can be
switched on per row later without a migration.

### 3.4 New: `github_pr_stats` — velocity source

```
github_pr_stats
  id INTEGER PK · pr_number INTEGER UNIQUE NOT NULL · title · author_login
  state TEXT enum open|merged|closed · branch
  created_at_utc / merged_at_utc / closed_at_utc  TEXT
  additions / deletions / changed_files / review_comment_count  INTEGER
  first_review_at_utc TEXT · lead_time_seconds INTEGER
  ci_conclusion TEXT · fetched_at INTEGER
  INDEX (merged_at_utc), INDEX (author_login)
```

Refreshed by a cron sweep against the GitHub API. Lead time = `merged_at - created_at`.

### 3.5 New: `shipments` — tracking numbers become schedule pressure

```
shipments
  id INTEGER PK · carrier TEXT enum ups|fedex|usps|dhl|other
  tracking_number TEXT NOT NULL · tracking_url TEXT
  status TEXT enum unknown|label_created|in_transit|out_for_delivery|delivered|exception
  eta_date TEXT · delivered_at TEXT
  material_schedule_item_id INTEGER FK → material_schedule_items.id
  worker_email_id INTEGER FK → worker_emails.id      -- where we learned of it
  blocking_task_id TEXT FK → planning_tasks.id       -- the install task it gates
  last_checked_at INTEGER · created_at / updated_at
  UNIQUE (carrier, tracking_number)
```

When `eta_date` moves, the blocking task's `start_date` moves with it. That is the
whole "real-time schedule" mechanic, and it is three columns and a cron.

### 3.6 New: `clickup_task_mirror` (P6 only)

```
clickup_task_mirror
  clickup_task_id TEXT PK · clickup_list_id TEXT NOT NULL
  planning_task_id TEXT FK → planning_tasks.id      -- our copy, nullable
  name · status · assignees_json · due_date · start_date · priority
  url · date_updated_remote INTEGER
  sync_hash TEXT · last_pulled_at INTEGER · last_pushed_at INTEGER
  sync_state TEXT enum synced|local_ahead|remote_ahead|conflict
```

**ClickUp is master.** D1 is a resilience copy: if ClickUp is down we serve the
mirror read-only and queue writes. Conflicts resolve remote-wins with the local
value written to `planning_task_updates` so nothing is silently lost.

### 3.7 Extend the changelog for the remodel

```
changelog_entries  + domain TEXT enum software|remodel NOT NULL DEFAULT 'software'
                   + plan_slug TEXT           -- soft link → plans.slug
changelog_proposals+ domain TEXT enum software|remodel NOT NULL DEFAULT 'software'
```

No new tables. The remodel's "here's what Phase 3 will look like" narrative is a
changelog entry with `domain='remodel'` — same rendering, same preview/shipped
split, same detail page with mermaid diagrams and images.

---

## 4. Access model (built now, enforced later)

Every read path goes through one function. It is the only place authorization is
ever decided, which is what makes 0029 a small change instead of an audit.

```ts
// src/backend/services/pmo/viewer.ts
export interface ViewerContext {
  participantId: number | null;
  isAdmin: boolean;
}

/**
 * TODAY: the shared-password cookie means every authenticated caller is the
 * homeowner, so this returns { isAdmin: true } and visibility filtering is a
 * no-op. The seam is real even though the gate is open — when 0029 lands real
 * per-person logins, ONLY this function and `visibleWorkItemFilter` change.
 */
export async function viewerContext(c: Context): Promise<ViewerContext>;

/** Admin → no filter. Otherwise → item must have a watcher row for this person. */
export function visibleWorkItemFilter(v: ViewerContext): SQL | undefined;
```

Rules encoded now:
- Admin (homeowner) sees everything.
- Everyone else sees an item only if they hold a `work_item_watchers` row on it.
- Holding any row implies edit (`can_edit` default 1); flipping it to 0 makes it
  view-only with no schema change.
- A task assigned to the homeowner still needs the relevant trade professional
  CC'd for them to see it — that is the watcher rows, not a broadcast.

---

## 5. The reusable component layer

Built in `src/frontend/components/pmo/`. Every one takes `WorkItem[]` plus
callbacks; none of them know about D1, ClickUp, or which project they serve.

| Component | Prototype source | Purpose |
|---|---|---|
| `<WorkBoard>` | `roadmap_kanban.html` | Column kanban, cross-column card drag + column reorder. Generalized from `ClickUpKanban.tsx`. |
| `<WorkGrid>` | `roadmap_queue.html`, `task_delivery.html` | Grouped data grid: collapsible groups, sub-task nesting, avatar groups, radial progress, filter bar, pagination. |
| `<WorkBacklog>` | `sprint_backlog.html` | Rank-ordered drag-to-prioritize list with `Reset order`. |
| `<WorkGantt>` | `gantt.html` | **Wraps the existing `kibo-ui/gantt`.** Adds the tree pane, status column, dependency awareness, and a `WorkItem[]` adapter. |
| `<VelocityDashboard>` | `engineering_velocity.html` | DORA tiles, PR throughput stacked bars, CI health rail, contributor leaderboard. |
| Shared atoms | all | `<StatusBadge>`, `<HealthBadge>`, `<PriorityBadge>`, `<ProgressRing>`, `<ProgressBar>`, `<AssigneeGroup>`, `<WorkItemCard>`, `<DependencyChips>`. |

A gallery page at `/admin/pmo/components` renders every component against fixture
data — so a change can be eyeballed without hunting for a page that uses it.

**Reuse note:** `sprint_backlog.html` and `sprint_backlog_drag.html` are byte-identical
apart from asset paths. They are one page, not two states. Do not build two.

---

## 6. Agent discipline — keeping D1 actually updated

The stated problem is not that the tables are missing. It is that **nobody keeps
them current.** So the plan changes the rules, not just the schema.

New MCP tools (`src/backend/mcp/tools/pmo/`, one file per tool):

| Tool | Annotation | Purpose |
|---|---|---|
| `create_plan_task` | `WRITE` | Add a task to a plan mid-flight. |
| `update_plan_task` | `WRITE_IDEMPOTENT` | Status, dates, progress, notes, assignee. |
| `close_plan_task` | `WRITE_IDEMPOTENT` | **Requires `prNumber`.** Sets `done` + links the PR. |
| `list_plan_tasks` | `READ_ONLY` | Filter by plan / status / workstream / phase. |
| `list_my_open_tasks` | `READ_ONLY` | The backlog an agent should check at session start. |
| `create_work_item` / `update_work_item` | `WRITE` | Remodel-side (`planning_tasks`), incl. room/material links. |
| `add_work_item_watcher` | `WRITE_IDEMPOTENT` | Attach a person as owner/assignee/cc. |
| `link_shipment_to_task` | `WRITE_IDEMPOTENT` | Tracking number → blocking task. |

And a **CLAUDE.md amendment** (P0 deliverable), stated as a hard rule alongside the
existing deploy contract:

> **Task hygiene (MANDATORY).** A turn that completes plan work MUST close the
> corresponding `plan_tasks` row via `close_plan_task` with the PR number that
> shipped it. A turn that discovers new work MUST file it with `create_plan_task`
> rather than leaving it in prose. "Done" without a closed task row is not done.

`close_plan_task` refusing to close without a `prNumber` is what makes this stick —
it is a schema-enforced habit, not a reminder.

---

## 7. AI layer

Nothing here is a new agent framework. Two roles, both on existing infrastructure:

**Program Manager** — revive `RemodelOrchestrator`. It already has Kahn topological
sort and critical-path computation; it is dormant only because no route configures
its list. Give it a real input (`WorkItem[]` from the adapters rather than raw
ClickUp), and have it write `clickup_task_flags`-style findings against work items:
slipping critical path, dependency violations, unassigned blockers.

**Coordinator** — a scheduled sweep that ingests external signals and proposes date
changes: shipment ETA moves, DBI permit status changes (`permits_records` is already
synced daily by a live cron), contract milestone dates. It **proposes**; nothing
auto-applies to a date a human set.

**Contract review → tasks** — the contract tables already exist and are rich
(`contract_payment_milestones`, `contract_timeline_milestones`, `contract_clause_findings`
with risk levels). P7 wires them: on contract upload, generate a work-breakdown of
tasks from the milestones, then run a **gap analysis** — every milestone that has no
task, every task with no acceptance criterion, every date that conflicts with the
critical path — and surface it *before the contract is signed*.

All AI calls use structured output with an explicit JSON schema, return primary keys
rather than display names, and validate returned ids against the live set before any
insert. A failed parse is logged, never degraded to `{}`.

---

## 8. Phases

Each phase is one PR unless noted. Order matters: P0 and P1 are prerequisites for
everything else.

| Phase | Title | Ships |
|---|---|---|
| **P0** | Foundation | `WorkItem` contract, both adapters, `work_item_watchers`, `viewerContext` seam, `plan_tasks`/`plans` column additions, CLAUDE.md task-hygiene rule |
| **P1** | Component layer | `pmo/` components + shared atoms + `/admin/pmo/components` gallery |
| **P2** | Software PMO | `/admin/plans/[slug]` rebuilt with Board/Grid/Backlog/Gantt tabs; PMO MCP tools |
| **P3** | Velocity | `github_pr_stats` + cron + `/admin/pmo/velocity` |
| **P4** | Changelog unification | `domain` column, remodel preview changelog, plan ↔ proposal ↔ entry links, narrative generator |
| **P5** | Remodel PMO | `/admin/pmo/operations` rebuilt on the same components over `planning_tasks`; room/material/budget links |
| **P6** | ClickUp sync | mirror table, webhook endpoint, reconciliation cron, conflict handling |
| **P7** | Signals & automation | `shipments` + tracking cron, permit-driven date shifts, contract review → WBS + gap analysis, Program Manager revival, NagBot **drafts** |

### Explicitly out of scope for 0028 (each needs its own plan)

- **0029 — Multi-user authentication.** Real per-person login for contractors.
  Everything in 0028 assumes one admin viewer; the watcher table and `viewerContext`
  are the hooks it will use.
- **Outbound transport.** NagBot in P7 writes *drafts* only. Sending needs either
  the unused `send_email` binding wired up (cheap, no new vendor) or Twilio (new
  vendor, new recurring spend) — **that is a spend decision and needs your explicit
  approval before anyone builds it.**
- **QR flyers / print sheets** and **RAG chat over installation manuals.** Both are
  well-supported by what exists (`VECTOR_INDEX`, the documents extraction service)
  but they are a separate deliverable, not a project-management component.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Two live task tables drift further apart | The adapter layer is the only writer the components use; direct writes stay legal but every new surface goes through it. |
| A migration breaks other branches' previews | Additive columns only, every new column nullable or defaulted. No drops, no renames. Never `wrangler d1 execute --file`. |
| ClickUp rate limits / outage | The client already handles 429 with Retry-After. Mirror serves reads when the API is down; writes queue. |
| Reviving `RemodelOrchestrator` re-triggers the billing runaway | The D1-backed circuit breaker added after incident #162 stays in place and is a precondition of P7, not an afterthought. |
| Velocity dashboard leaks a GitHub token to the client | All GitHub calls are server-side into `github_pr_stats`; the browser only ever reads our own table. |
| The component layer over-generalizes into an unusable framework | Five components, one contract, one gallery page. If a sixth "just needs a flag", it gets its own component instead. |

---

## 10. Verification

Per phase, a QC script `scripts/qc/pr_<n>.mjs` using the shared helpers
(`scripts/config.mjs`, `scripts/tokens.mjs`), run against **both** the branch preview
and production:

```bash
pnpm run deploy:preview
pnpm run test:pr <n> -- --preview     # the new surface
pnpm run test:pr <n>                  # regression guard against prod
```

Phase-specific checks:

- **P0** — adapters return a valid `WorkItem` for a known `plan_tasks` row and a
  known `planning_tasks` row; `visibleWorkItemFilter` returns undefined for admin;
  the new columns exist on remote D1.
- **P1** — the gallery page renders every component; no console errors; dark and
  light both legible.
- **P2** — `close_plan_task` **rejects** a call with no `prNumber` (this is the
  behaviour the whole hygiene rule rests on); status round-trips through the board.
- **P3** — velocity endpoint returns non-empty DORA tiles from real `github_pr_stats`.
- **P6** — a task edited in ClickUp appears in the mirror within one cron cycle; a
  conflicting local edit is preserved in `planning_task_updates`.
