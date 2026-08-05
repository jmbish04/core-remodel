# PROMPT — 0047 Collapse chain branches into one business (Tier 2)

Read `docs/0047_showroom_branch_collapse/IMPLEMENTATION_PLAN.md` in full first, then
`docs/0045_showroom_multi_location_mcp/IMPLEMENTATION_PLAN.md` for the location model.

## The situation

- 0045 gave a business many locations. 0046 detects which store rows are branches of one
  business and returns them as `branchCandidates` — and **deliberately refuses to merge
  them**. There is no way to act on one; the backlog is re-reported every scan.
- 12 candidates live on prod, ~30 store rows. Studio Belmont ×5, Homewise ×5, All Natural
  Stone ×4, Daltile ×4, Porcelanosa ×3, plus seven pairs.
- **The user's standing decision: Tier 2 proposes, never auto-merges.** Do not add an
  "apply everything" path. Every collapse is confirmed by a human, per group.

## Why you cannot reuse `dedup_showroom_stores`

It **discards** the loser's address — right for a duplicate stub, catastrophic for a real
branch. Collapsing must carry each loser's site across as a `showroom_store_locations` row
FIRST, then soft-delete the store. Different operation.

## Build

### P1 — schema
`showroom_merge_candidates` + `showroom_merge_candidate_members` + `showroom_merge_exclusions`
exactly as the plan's ERD, PLUS a **`unit` TEXT column on `showroom_store_locations`** (the
table cannot express a suite today — that is what let a suite-less street nearly merge Leandro
Quintal into Marblus in #356). `group_key` is the sorted **active** member store ids joined,
UNIQUE. `pnpm run db:generate`, then `pnpm run migrate:remote` (it IS a defined script →
`node scripts/d1-migrate.mjs --remote`), then **verify the tables + column exist on remote**.
Never hand-edit `drizzle/`, never raw SQL for schema.

### P2 — `scan_showroom_merge_candidates`
Reuse `services/showroom/duplicate-signals.ts` `groupBySignals` and the `isReal >= 2`
classification already in `dedup_showroom_stores.ts` — do NOT reimplement detection.
- **Filter `showroom_stores` to `is_active = 1` before grouping** — a soft-deleted branch must
  never re-enter detection, or an applied group is re-proposed from its retired members.
- **Skip any edge whose two endpoints are a persisted excluded pair** (`showroom_merge_exclusions`),
  so a human's exclude decision survives across scans.
- Upsert by `group_key`; a group whose active membership changed becomes a NEW candidate and the
  old one goes `STALE`, never silently mutated underneath.

### P3 — the collapse service
`services/showroom/collapse-branches.ts`.

- Re-verify at APPLY, not just at detect: every member still exists, is `is_active = 1`, and the
  active membership still matches `group_key`; abort `STALE` if it moved.
- Per BRANCH member, in this order: **create the location row, then remap children, then
  soft-delete the store**. A failure must never leave an address destroyed — D1 has no
  transactions, so write sequentially with a compensating delete, and say so in a comment.
- **Idempotent / resumable:** key each branch on its member row's `resulting_location_id`. A
  member that already has one is SKIPPED on retry, so a mid-collapse failure resumes without
  double-inserting a location or erroring on an already-deleted store. Mark the candidate
  `APPLIED` only when every BRANCH member has a `resulting_location_id` (or was skipped for no
  address); a partial run stays `TBD` with a receipt of what completed.
- Reuse 0046's `SIMPLE_MOVE` / `DEDUP_MOVE` child-table maps; do not re-list 25 FK tables.
- **Chunk column-aware**, not a fixed 20: the D1 cap is 100 bound *parameters* per statement, so
  the safe row count is `floor(100 / columns_written_per_row)`. A single-column FK remap → ~90
  ids; a ~12-column location INSERT → ~8 rows. Use a parameter-budget helper.
- A branch with no usable address is REPORTED and SKIPPED, never collapsed to nothing.
- `role = EXCLUDED` members are left completely untouched, and their pair is written to
  `showroom_merge_exclusions` so the scan never re-proposes it.

### P4 — MCP, one file per tool
`list_merge_candidates` (READ_ONLY), `get_merge_candidate` (READ_ONLY, full evidence),
`resolve_merge_candidate` (WRITE — approve / reject / set keeper / exclude a member),
`apply_merge_candidate` (DESTRUCTIVE). Hand-written Zod v4 `inputShape` — **never import
drizzle-zod**, it breaks `pnpm run build`. ≥1 example each. Register in
`tools/showrooms/index.ts`.
- Validate every id with Zod (`z.number().int().positive()`); a keeper/exclude must belong to
  the named candidate or `toolError`.
- `apply_merge_candidate` refuses unless the candidate is `APPROVED`, and re-runs the P3
  active/`group_key` re-verify before writing. Registry writes are already gated by the OAuth
  connector / `WORKER_API_KEY` bearer — there is no unauthenticated path.

### P5 — review UI
`/admin/shopping/showrooms/merge-review` — thin Astro shell + one React island. `class`, NOT
`className`, in the `.astro` file; `container mx-auto px-4 py-8 pb-12`; header block with a
24px lucide icon. Copy `admin/studio.astro`. Per group: switchable keeper, each member with
address/phone/site + evidence, per-member keep/exclude, approve/reject.

### P6 — QC
`scripts/qc/pr_<n>.mjs` on preview AND prod. Exercise collapse on a **throwaway store pair the
test creates and removes** — never on live rows. Assert: address carried across, children
remapped, EXCLUDED member untouched, re-scan produces no new candidate, and 0046's
"no runaway component" guard still passes.

## Rules that will bite here

- **Foreign keys, never denormalized `*_name` columns.** Members relate by `store_id`; JOIN for display.
- **No `db.transaction()`** — dead on D1. `db.batch([...])`, or sequential + compensating delete.
- `pnpm run build` does NOT type-check. Also run `npx tsc --noEmit` and diff against a baseline
  taken from a throwaway `git worktree add --detach origin/main` — `git stash -u` does not
  remove committed files and will silently compare the branch against itself.
- Nothing auto-deploys. After merge, `pnpm run deploy` from `main`, then verify.
- Tick `plan_tasks` with `update_plan_task` as you go.

## Out of scope

Changing 0046's detection. If a group looks wrong, that is a signal-tuning bug — fix it there,
with a regression case in `duplicate-signals.__selfCheck`.
