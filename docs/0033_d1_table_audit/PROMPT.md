# PROMPT — 0033 D1 Relational-Graph Audit & Connection Build

Implement `docs/0033_d1_table_audit/IMPLEMENTATION_PLAN.md`. Phase A (audit + target resolution) is done —
targets are in §1.3. Cut a fresh worktree from `origin/main`; re-verify refs before editing.

## Non-negotiables
- **Connect by default.** Wire every table in §1.3 Tier-1 / Tier-2 and build the §1.2 hubs/bridge. Leave
  Tier-3 standalone.
- **No fabricated/seed data.** Do NOT run the pasted `audit-and-fix.mjs` fix half.
- **No guessed parents.** The 4 confirms in §5 gate Tier-2 — get them answered before wiring those. Tier-1
  can start now.
- **Validate orphans, back up, read the SQL.** Every FK forces a table rebuild — back up remote D1, confirm
  each child `*_id` resolves to a real parent (flag orphans, never auto-delete), read the generated migration
  (rebuild touches ONLY the target), verify row counts.
- **FK-not-name.** Permits and `showroom_gaps` both DROP a denormalized name in favour of an id FK.
- **`gemini_usage_log.agent_run_id` stays UNLINKED** — its parent ledger is pruned; an FK would delete spend
  history. Do not touch it.
- **D1:** `db.batch` not `db.transaction`; migrations via `pnpm run db:generate` + `pnpm run migrate:remote`;
  data movement in scripts. One PR per cluster. State deploy/migration/QC each turn.

## Phase B — connection build
1. `B0` Back up remote D1 (`wrangler d1 export DB --remote`).
2. `B1` DROP `saved_image_searches` — confirm plan-0010's recovery task is abandoned first (else KEEP).
3. `B2` DELETE the dead duplicate `canvasInspirationReferences` const in `images/image_base_canvas.ts:77`.
4. `B3` Tier-1 leaf FKs: `dialer_prospect_state`/`dialer_call_attempts.prospect_id` → `dialer_prospects.id`
   CASCADE; `photo_viewer_notes.image_id` → `images.id` CASCADE; `truth_table_activities.replaced_by_activity_id`
   → self `.id` SET NULL; `health_email_loopback.g2w_worker_email_id` → `worker_emails.id` SET NULL.
5. `B4` `showroom_gaps`: `room_id`→`rooms.id`, `material_id`→`material_schedule_items.id`,
   `sweep_session_id`→`sourcing_sweep_sessions.id` (all SET NULL, nullable); **DROP `room_name`**, JOIN `rooms`.
6. `B5` MCP nullable session FKs on `mcp_conversations`/`mcp_agent_issues`/`mcp_feature_requests` →
   `mcp_sessions.id` SET NULL. Leave `mcp_tool_invocations` text unless you fix the `db.batch` write-order in
   `mcp/logging.ts` (parent-upsert before child) — Tier-2.
7. `B6` **Permits hub**: enforce unique people (license_number else normalized name); add `contact_id` FK
   (CASCADE) to `permits_contact_insights` AND `permits_contact_activity`; backfill 1:1 via the unique
   `contact_name` (surface non-matches, don't drop); retire the name copy after parity.
8. `B7` **Changelog hub** [CONFIRM #2]: extend `changelog_branches` (add `worktree`,`timestamp`) — or a new
   `changelog_branch_pr` — as the hub; add `branch_pr_id` FK on `changelog_proposals` + `changelog_entries`;
   make the write path ensure-hub-first (append-only safe).
9. `B8` **`permit_task_mapping`** [CONFIRM #1]: new table `id/timestamp/d1_task_id(FK)/clickup_task_id(text,
   nullable)/permit_id(FK,nullable)`; `d1_task_id` → `planning_tasks` (home) vs `plan_tasks` — CONFIRM;
   `permit_id` → `permits_records.id`; forward-populated (no backfill); ClickUp logs join via `clickup_task_id`.
10. `B9` `audit_run_id` → `agent_runs.id` [CONFIRM #3]: orchestrator stores `run.id` instead of the random
    UUID; FK `ON DELETE SET NULL` on `clickup_task_flags` + `clickup_system_alerts` (no cascade — pruned ledger).
11. `B10` Document the Tier-3 standalone tables as intentional (incl. the gemini-log pruned-ledger reason).
    Devices registry is CONFIRM #4 — build only if the owner wants per-device location history.
12. `B11` QC: re-run the read-only audit; touched endpoints 200; changelog + PR links.

## Phase C — repeatable audit (optional)
1. `C1` `scripts/audit/d1-integrity.mjs` (SELECT/pragma only, NO fix half) + a health probe.

## The 4 confirms (blocking Tier-2 only)
1. `permit_task_mapping.d1_task_id` → `planning_tasks` or `plan_tasks`?
2. Changelog hub: extend `changelog_branches` or new `changelog_branch_pr`?
3. `audit_run_id`: orchestrator adopts `run.id`, or parallel column?
4. `devices` registry — build (new per-device capability) or leave standalone?

## Do NOT
- FK `gemini_usage_log.agent_run_id`, name-join anything, fabricate data, mirror ClickUp rows into D1, or
  invent a `devices` table unless confirm #4 says so.
