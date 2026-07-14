# Plan — MCP per-tool modularization + agent-memory fail-safe + async showroom intake

**Branch:** `claude/mcp-per-tool-modularize` (off `origin/main` @ e114588)
**Date:** 2026-07-14

## Context / why

- The real MCP server is `src/backend/mcp/` (registry-driven, 79 tools via `defineTool`),
  served at `/mcp` (OAuth connector) + legacy `/api/mcp`. Tools are grouped **by domain**
  (`tools/showrooms.ts`, `tools/budget.ts`, …), not one-file-per-tool.
- Symptom Justin hit: realtime/voice Claude reports "tools offline" **while a tool runs**,
  fine immediately after. Root cause is almost certainly **slow tools blocking the MCP
  request** (`create_showroom` awaits full onboarding inline — Places + Gemini + photos +
  scrape → minutes). A request/response MCP call that idles for minutes gets killed by
  cellular NAT / the connector → "offline". A heartbeat can't attach to a request/response
  tool call; **making slow tools async is the actual fix.**
- Fail-safe Justin wants: adhoc agent-memory CRUD on `AGENT_ADHOC_MEMORY_KV` (already bound,
  id `d2c2b93…`) so a memory-losing thread can park notes on the worker, to be replayed later
  in regular chat mode.

Ship as **three independent PRs** (do not mix a 79-file move with feature work):

---

## PR1 — Per-tool modularization (pure refactor, zero behavior change)

**Decision (needs Justin):** file layout.
- **Recommended: domain subdirs** — `tools/<domain>/<tool_name>.ts` + `tools/<domain>/_shared.ts`
  (helpers used by >1 tool in that domain) + `tools/<domain>/index.ts` (re-exports the domain
  array). `tools/index.ts` keeps importing 14 domain barrels → `ALL_TOOL_GROUPS` order unchanged.
  Honors "one file per tool" while keeping helpers scoped and the docs-page ordering intact.
- Alternative: flat `tools/<tool_name>.ts` (79 files) + `tools/_shared/<domain>.ts`. Matches the
  literal path Justin typed but scatters 79 files in one dir and complicates helper placement.

**Mechanical steps (per domain, 14 domains, 79 tools):**
1. For each `tools/<domain>.ts`: move each `defineTool({...})` into its own
   `tools/<domain>/<tool_name>.ts` exporting a single `RemodelTool` (filename == tool name).
2. Extract top-level helpers (~33 total across files; e.g. showrooms: `rethrowMapsError`,
   `persistPlaceShowroom`, `DAY_ENUM`, `storeListDto`) into `tools/<domain>/_shared.ts`.
   Single-use helpers may inline into their one tool file.
3. `tools/<domain>/index.ts` re-exports `export const <domain>Tools: RemodelTool[] = [...]`
   in the SAME order as today (docs-page order must not change).
4. `tools/index.ts` barrel unchanged in behavior (imports 14 domain arrays).

**Invariants / verification (this is a no-op refactor — prove it):**
- `getAllTools().length === 79`, all names unique (registry throws on dup at load).
- Tool NAMES, order, categories, descriptions, inputShape, annotations byte-identical.
- `tsc --noEmit` filtered to `src/backend/mcp/` → **no NEW errors** vs the pre-refactor baseline
  (compare with the swap-and-count method; repo has ~171 baseline errors, build ≠ typecheck).
- Docs site (`/connect/tools`) + `/api/mcp` + OAuth agent still enumerate all 79 (they read the
  registry, so this follows from the count check).
- Optional: a `tools/index.test.ts` asserting count + unique names + stable order snapshot.

**Risk:** low (mechanical), but large diff. Good swarm candidate — one subagent per domain,
each grounded in the real `tools/<domain>.ts`, forbidden from touching git state.

---

## PR2 — Adhoc agent-memory tools (fail-safe)

Binding `AGENT_ADHOC_MEMORY_KV` + its `worker-configuration.d.ts` type already exist. No wrangler
change needed.

**Model (Justin's design):** a `memoryUuid` (crypto.randomUUID) groups a session's notes.
- KV key: `mem:{memoryUuid}:{entryId}` → value = JSON string (agent writes whatever it wants).
- List/read/update/delete operate on those keys; `flush` drains a uuid's entries into D1.

**New tool domain `tools/memory/` (category: add `"memory"` to `ToolCategory`):**
- `write_agent_memory({ memoryUuid?, label?, content })` → mints `memoryUuid` if absent + an
  `entryId`; `KV.put(mem:{uuid}:{entryId}, JSON)`. Returns `{ memoryUuid, entryId }`. (WRITE)
- `list_agent_memory({ memoryUuid })` → `KV.list({ prefix: 'mem:{uuid}:' })` + values. (READ_ONLY)
- `read_agent_memory({ memoryUuid, entryId })`. (READ_ONLY)
- `update_agent_memory({ memoryUuid, entryId, content })`. (WRITE)
- `delete_agent_memory({ memoryUuid, entryId })`. (DESTRUCTIVE)
- `flush_agent_memory({ memoryUuid, clearKv? })` → read all entries, insert each into D1
  `agent_adhoc_memory`, optionally delete from KV. Returns count persisted. (WRITE)

**D1 table** `agent_adhoc_memory` (drizzle schema in `src/backend/db/schema/mcp/`, then
`pnpm run db:generate` + `pnpm run migrate:remote` — never hand-write SQL):
`id` (pk auto), `memoryUuid` (text, idx), `entryKey` (text), `payload` (text json),
`createdAt` (timestamp). One row per KV entry at flush time.

**Verification:** write→list→read→update→delete round-trip via `/api/mcp` with the worker bearer;
flush then confirm rows land in D1. Add a tiny self-check asserting the KV key scheme round-trips.

---

## PR3 — Async `create_showroom` / `import_showroom_from_place` (the realtime fix)

**Current blocker:** both tools call `persistPlaceShowroom`, which does `scheduleShowroomEnrichment`
then **`await Promise.allSettled(tasks)`** — the await blocks the tool for the full onboarding
(~25s+ observed; no `waitUntil` in MCP, hence the inline await).

**Confirmed in the wild (2026-07-14 batch of 5 imports):** EVERY `import_showroom_from_place`
call errored on the first attempt (`{"error":"Error occurred during tool execution","request_id":"req_011C…"}`)
and succeeded on an immediate retry returning `created:false` with a fully-enriched row
(`scrapeStatus:"complete"`, hero image, brands, Gemini review — e.g. Aquabella `createdAt 16:10:19`
→ `updatedAt 16:10:44`). Interpretation: the server COMPLETES the onboarding, but the call
outlives the MCP client/transport timeout (the `req_011C…` ids are Anthropic-side), so Claude
sees an error while the work finishes anyway; the retry then hits placeId idempotency and returns
the finished store. This is the SAME root cause as the realtime "tools offline" report — a tool
that runs longer than the client timeout. Two properties to preserve in the async rewrite:
(a) **placeId idempotency is already the safety net** that makes retries non-destructive — keep it;
(b) the async version eliminates the per-import error+retry dance entirely.

**Fix:** move the heavy onboarding to the existing durable `ShowroomScrapeWorkflow` (or the
Agents-SDK DO queue) instead of awaiting inline.
1. Fast path in the tool: fetch Places Details (seconds) → insert the `showroom_stores` row →
   kick `env.SHOWROOM_SCRAPE_WORKFLOW.create({ params: { showroomId, placeId } })` →
   return immediately `{ created, showroomId, status: "processing" }`. (No inline enrichment await.)
2. New tool `check_showroom_intake_status({ showroomId | placeId })` → reports the workflow
   instance status (in-progress / complete / errored) + which enrichment steps are done. Needs a
   small status surface: either read the workflow instance status, or a
   `showroom_intake_status` column/table the workflow updates. Decide at execution after reading
   `showroom-scrape-workflow.ts` (does it already cover the FULL onboarding, or only scraping?).
3. Keep the manual (no-placeId) path synchronous — it's already fast.

**Open question to resolve at execution:** does `ShowroomScrapeWorkflow` today run the *whole*
onboarding (photos→CF Images, brand map, favicon+scrape, AI research, category inference) or only
a subset? If subset, either extend it or wrap `scheduleShowroomEnrichment`'s task set in a workflow
step. This determines whether PR3 is "rewire" or "extend the workflow".

**Verification:** call `create_showroom` with a placeId → returns in <~3s with `status:processing`
→ poll `check_showroom_intake_status` until complete → confirm the store ends up fully enriched
(photos, brands, research) exactly as the synchronous path did.

---

## Sequencing
PR1 first (unblocks clean per-tool edits), then PR2 + PR3 in parallel (independent). PR3 is the
one that actually addresses the "tools offline in realtime" report.
