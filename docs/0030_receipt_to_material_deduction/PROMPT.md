# 0030 build prompt

Build receipt-line-item → material promotion with room deduction. Full context:
`IMPLEMENTATION_PLAN.md` in this folder.

## Order

1. **Schema** — `material_room_proposals` (see plan). `pnpm run db:generate`,
   inspect for `DROP TABLE`, `migrate:remote`, verify.
2. **Service** `src/backend/services/materials/deduction.ts`:
   - `promoteLineItem(db, lineItemId, {subcategoryId?})` → material row, links the
     line item (`material_schedule_item_id`, `match_status="created"`). Sequential
     insert-then-link with a compensating delete (D1 has no transactions).
   - `deduceRoom(db, env, {materialId, subcategoryId, lineItem})` → runs the
     ordered elimination (candidate-by-type → eliminate-sourced → eliminate-dormant
     → eliminate-past-confirmed), then AI-ranks survivors only if >1. Returns
     `{candidates, proposedRoomId, confidence, reasoningMarkdown, autoConfirm}`.
   - `stageProposal(...)` writes the row; auto-confirms when one survivor.
   - `resolveProposal(db, proposalId, {roomId})` — sets material.roomId + proposal
     status, shared by MCP and REST. Validates roomId is a real active room.
3. **Auto-stage hook** — in `analyzeAndPersist` (email pipeline), after line items
   are inserted, promote+deduce+stage each `unmatched` one. `ctx.waitUntil`-safe.
4. **MCP** `tools/materials/`: `promote_line_item`, `list_room_proposals`,
   `resolve_room_proposal`. Register in the domain index.
5. **REST** on the materials router: `GET /room-proposals`, `POST
   /room-proposals/:id/resolve`.

## Hard rules (AGENTS.md)

- NEVER `db.transaction()` — D1 rejects BEGIN. `db.batch([...])`; sequential +
  compensating delete when an id must feed forward.
- NEVER a denormalized `*_name` column. FK + join.
- AI ranking: structured output, return **room ids**, validate against the
  survivor set before use, never degrade a failed parse to a silent default.
- Hand-write Zod v4. NEVER `drizzle-zod`.
- Chunk `inArray` at ≤90 (D1's 100 bound-param cap).
- Migration collides constantly here — `git fetch` and check the latest number
  before `db:generate`; rebase + regenerate on collision.
- QC script `scripts/qc/pr_<n>.mjs`; verify against the real Costco receipt
  (email 3). `comm -13` type diff, not raw counts. `pnpm run build` must pass.

## Done when

The success criteria in `IMPLEMENTATION_PLAN.md` pass against email 3 on a
preview deploy.
