# PROMPT — 0033 D1 Table Integrity Audit & Targeted Remediation

Implement `docs/0033_d1_table_audit/IMPLEMENTATION_PLAN.md`. Phase A (the audit) is done — the
5 actions are fixed. Cut a fresh worktree from `origin/main`; re-verify refs before editing.

## Non-negotiables
- **No fabricated/seed data, ever.** Empty tables stay empty. Do NOT run the pasted
  `audit-and-fix.mjs` fix half.
- **No blind FK-adds.** Only the 4 named tables get FKs, and each only after validating there are
  **zero orphan child rows** whose `*_id` doesn't resolve to a real parent. Orphans are FLAGGED for
  a human decision — never auto-deleted.
- **Backup first, read the SQL.** Every FK-add is a SQLite table rebuild. Back up remote D1, then
  `db:generate` and READ the migration: confirm it rebuilds ONLY the target table (all four are
  leaf tables — nothing references them — so no child cascade). Verify row counts before/after.
- **D1:** `db.batch([...])` never `db.transaction()`; migrations via `pnpm run db:generate` +
  `pnpm run migrate:remote`; data movement in scripts, not DDL.
- **One PR per item**, each gated on the user's approval for that specific change.
- **Deploy is yours**; state deploy/migration/QC each turn.

## Phase B — targeted remediation
1. `B0` Back up remote D1 (`wrangler d1 export DB --remote`) — restore path for every FK rebuild.
2. `B1` Drop `saved_image_searches` — FIRST confirm plan-0010's "recovery" task is abandoned (it is
   the only reference, in `seed-plan-tasks.ts`); if the user still wants it, KEEP and skip. Else drop
   the table + remove its schema file + barrel export + the dead plan-0010 task row.
3. `B2` Delete the dead duplicate `canvasInspirationReferences` const in
   `src/backend/db/schema/images/image_base_canvas.ts:77` (the barrel uses
   `images/canvas_inspiration_references.ts`). Code-only; `tsc` clean; no migration.
4. `B3` `showroom_gaps`: validate every `room_id` resolves to a real `rooms.id` (flag orphans); add
   the FK (`onDelete` per how gaps should behave when a room is removed — likely `cascade`); **drop
   the denormalized `room_name`** column; repoint the one reader/route to JOIN `rooms` for the name.
5. `B4` `photo_viewer_notes.image_id` → FK `images.id` (validate orphans first).
6. `B5` `dialer_call_attempts.prospect_id` → FK `dialer_prospects.id` (validate orphans).
7. `B6` `dialer_prospect_state.prospect_id` → FK `dialer_prospects.id` (validate orphans).
8. `B7` Document the 45 STANDALONE_BY_DESIGN tables as intentional (a short comment/registry note per
   cluster: changelog, plan/agent-ledger, MCP-ops, permits, usage meters, config/vocab, integration
   logs, KV stores) so the next audit doesn't re-flag them.
9. `B8` QC: re-run the read-only audit; expect 46 standalone / 0 orphaned / 0 dead. Each touched
   endpoint still 200. Changelog + PR links.

## Phase C — repeatable audit (optional)
1. `C1` Land `scripts/audit/d1-integrity.mjs` (SELECT/pragma ONLY — no fix half) + a health probe, so
   FK/usage drift is caught continuously. Output the same classification buckets.

## Do NOT
- Add FKs to any of the 45 standalone tables, seed mock data, auto-delete orphan rows, or touch the
  soft text-key links in the MCP-ops / permits log clusters.
