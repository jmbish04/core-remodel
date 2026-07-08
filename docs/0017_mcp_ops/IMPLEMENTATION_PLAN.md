# 0017 — MCP Ops & Observability: logging, conversation capture, bug + feature tracking

**Status:** PLAN — for review, to be executed in a FRESH session/worktree (alongside/after 0016). No code yet.
**Author:** Claude (cloudflare-jedi + mcp-builder)
**Date:** 2026-07-08
**Builds on:** 0015 MCP server (`src/backend/mcp/*`). Companion to 0016 (artifact export). See both plans.

---

## 0. Scope & coordination

A "broad MCP update" that makes the connector **observable and self-improving**:

- **A. Tool-call logging** — every MCP tool request is logged (a transcript of tool usage), grouped by session.
- **B. Conversation export** — an explicit tool to persist the whole chat so it's never lost when the chatbot freezes.
- **C. Agent issue/bug tracker** — Claude logs bugs it hits using the MCP tools; coding agents are instructed to check the log, fix them, and record the fixing PR.
- **D. Feature-request tracker** — when Claude can't do something the user wants, it logs a feature request; agents are instructed to check the log and plan it with the user.

**Coordination (same rules as 0016 §0):** run in a fresh session off the latest `main`; `db:generate` **only after** rebasing so the migration number doesn't collide with the pending email `0083` or 0016's migration; **no new Durable Object** here, so `v14` stays and there's no DO-tag contention. Apply the D1 migration manually with `pnpm run migrate:remote` at ship (Workers Builds doesn't).

**Sequencing with 0016:** independent — can ship before, after, or in parallel. Only shared risk is migration numbering; whichever branch merges first, the other rebases + regenerates. Recommend: 0017 first (it's smaller and its logging benefits 0016 too).

---

## 1. Objective

Nothing built in a chat should be lost, and the connector should get better every time an agent stumbles. Capture **what the tools did**, **the conversation itself** (on request), **bugs**, and **feature gaps** — as first-class D1 records that both the admin UI and the *coding* agents read.

---

## 2. The protocol reality (READ FIRST — it shapes everything)

MCP `tools/call` delivers the server only `{ name, arguments }`. **The server never receives the model's conversation.** Consequences:

- ✅ **We can always log the tool call** (name, args, result, error, latency, timestamp) and, under the Streamable-HTTP `McpAgent`, group it by the **session id** (`this.getSessionId()`), because one connected MCP session = one `RemodelMcpAgent` DO instance. That yields a per-session **tool-usage transcript** automatically.
- ❌ **We cannot silently capture the chat text.** The full conversation only reaches the Worker if Claude passes it as a tool argument.
- ➕ Optional nudge: tools *could* accept an optional `intent` string ("why am I calling this") that Claude fills in, giving richer log context — but it's model-discretion, not guaranteed, and pollutes every schema. Treat as a nice-to-have, not the mechanism.

So the design is **automatic tool-call logging** + an **explicit `export_conversation` tool**. That combination is the honest maximum.

---

## 3. Capabilities

### A. Tool-call logging (automatic, always-on)
A cross-cutting wrapper around tool dispatch writes one row per call. Both transports must log:
- **`/mcp` (McpAgent):** wrap the handler inside `RemodelMcpAgent.init()`'s `registerTool` callback (already a try/catch — add logging there). Session id from `this.getSessionId()`; principal from `this.props`.
- **`/api/mcp` (legacy JSON-RPC):** wrap `callTool` in `src/backend/api/routes/mcp.ts`. No session id → synthesize one per request or tag `"legacy"`.
- Shared helper `logInvocation(env, {...})` in `src/backend/mcp/logging.ts`. **Write via `ctx.waitUntil`** so logging never adds latency to the tool response. Truncate/serialize args + result to a size cap; redact nothing (single operator) but cap large blobs.

### B. Conversation export (explicit tool)
`export_conversation` — the user says "save/export our conversation"; Claude calls it with the transcript it holds. Stores a `mcp_conversations` row (title, summary, full markdown/JSON messages, session id if known, message count). Idempotency: if re-exported in the same session, update the existing row (or append a version). Returns a `/admin/mcp-ops/conversations/<id>` URL.

### C. Agent issue / bug tracker
`report_bug` — Claude (or any agent) logs a defect it hit using the MCP tools: `{ tool?, summary, details, severity, reproSteps?, sessionId? }` → `mcp_agent_issues` (status `open`). Real example that motivated this: the `/mcp` route prefix was gating the docs pages (fixed in PR #81) — exactly the kind of thing an agent should be able to self-report.
Read side: `list_agent_issues` (filter by status) so agents can query. Admin/agent can mark fixed with the PR number.

### D. Feature-request tracker
`request_feature` — when the user wants something the tools don't support, Claude logs `{ title, description, useCase, requestedBy? }` → `mcp_feature_requests` (status `requested`). Read: `list_feature_requests`. An agent picks these up and plans them with the user.

---

## 4. Data model (`src/backend/db/schema/mcp/`)

All timestamps `integer({mode:"timestamp"}).default(sql\`(unixepoch())\`)` — **seconds**.

- **`mcp_sessions`** — `id` (the MCP session id / synthesized), `transport` ("streamable"|"sse"|"legacy"), `principal` (userId/kind from props), `firstSeenAt`, `lastSeenAt`, `toolCallCount`. Upserted on first call of a session; groups the tool-call log into a transcript.
- **`mcp_tool_invocations`** — `id`, `sessionId` (FK-ish, plain text — sessions may not pre-exist), `toolName`, `argsJson` (capped), `ok` (bool), `resultJson` (capped) / `errorText`, `durationMs`, `createdAt`. The per-call transcript.
- **`mcp_conversations`** — `id`, `sessionId?`, `title`, `summary`, `format` ("markdown"|"json"), `content` (TEXT; R2 `ARTIFACTS_BUCKET` if it exceeds a cap), `messageCount`, `createdAt`, `updatedAt`.
- **`mcp_agent_issues`** — `id`, `toolName?`, `summary`, `details`, `severity` ("low"|"medium"|"high"), `reproSteps?`, `sessionId?`, `status` ("open"|"in_progress"|"fixed"|"wontfix"), `fixedByPr?` (int), `fixedAt?`, `createdAt`, `updatedAt`. Unique-ish dedupe on `(toolName, summary)` to avoid spam.
- **`mcp_feature_requests`** — `id`, `title`, `description`, `useCase`, `requestedBy?`, `status` ("requested"|"planned"|"building"|"shipped"|"declined"), `planRef?` (doc path), `prNumber?`, `createdAt`, `updatedAt`.

New dir `src/backend/db/schema/mcp/` + barrel; re-export from the top-level schema index. (Note: keep it distinct from the tool-code dir `src/backend/mcp/`.)

---

## 5. MCP tools (new `src/backend/mcp/tools/ops.ts`, category `"ops"`)

| Tool | Ann | Purpose |
|---|---|---|
| `export_conversation` | W | Persist the current chat. Args: `title`, `summary?`, `messages` (markdown or structured), `sessionId?`. Returns the stored id + URL. |
| `report_bug` | W | Log an MCP bug the agent hit. Args: `summary`, `details`, `severity?`, `tool?`, `reproSteps?`. Dedupes on (tool, summary). |
| `list_agent_issues` | R | Open (or filtered) issues — so an agent can check what needs fixing. |
| `resolve_agent_issue` | W | Mark an issue `fixed`/`wontfix` + `fixedByPr`. (Callable by a coding agent after landing a fix.) |
| `request_feature` | W | Log a feature gap. Args: `title`, `description`, `useCase`. |
| `list_feature_requests` | R | Open feature requests — so an agent can plan them with the user. |
| `get_recent_activity` | R | Recent sessions + tool-call counts + last errors — a quick health/usage read (handy for you and for agents). |

Registry-driven per 0015 (`defineTool`, hand-written Zod v4, annotations, examples). Tool-call **logging itself is middleware (§3A), not a tool.**

---

## 6. Logging middleware detail

`src/backend/mcp/logging.ts`:
```
logInvocation(env, { sessionId, transport, principal, toolName, args, result|error, durationMs })
```
- Upsert `mcp_sessions` (bump lastSeenAt + toolCallCount), insert `mcp_tool_invocations`.
- Called from both transports; both wrap the handler timing + try/catch.
- `ctx.waitUntil(...)` the writes so they never block the tool response. (McpAgent: use `this.ctx.waitUntil`. Hono: `c.executionCtx.waitUntil`.)
- Cap `argsJson`/`resultJson` (e.g. 8 KB each) with a "…truncated" marker.
- **Do not log the auth token or the `WORKER_API_KEY`.**

---

## 7. AGENTS.md additions (the self-improving loop)

Add to the "MCP Server" section:

> **Before starting Worker code work, check the MCP ops logs:**
> - **Open bugs:** query `mcp_agent_issues` where `status='open'` (via `GET /api/mcp-ops/issues?status=open`, or `pnpm run mcp:issues`, or the `list_agent_issues` tool). Fix what you can; when a fix lands, call `resolve_agent_issue` / update the row with the **PR number** that fixed it.
> - **Feature requests:** query `mcp_feature_requests` where `status='requested'`. Don't silently implement — surface them and **plan with the user** first; set `status='planned'` + `planRef` when a plan doc exists, `prNumber` + `shipped` when merged.
>
> These logs are written by Claude via the MCP tools during chats; they are the backlog. Treat them as authoritative TODOs for the connector.

Provide a `pnpm run mcp:issues` convenience script (queries D1 remote read-only) so agents that aren't chatting via MCP can still read the backlog.

---

## 8. Admin view (light, Phase 2)

`/admin/mcp-ops` — dark Monolith, tabs (shadcn `Tabs`):
- **Sessions / Transcripts** — session list → drill into its `mcp_tool_invocations` (a readable tool-usage transcript).
- **Conversations** — exported chats, viewable (rendered markdown).
- **Bugs** — table with status + PR link; sort/filter.
- **Features** — table with status + plan/PR links.
Real data from `GET /api/mcp-ops/*` (admin-gated). Sort+filter on every table (UX rule).

---

## 9. Phased plan

**Phase 1 — capture (tools + logging + tables).**
1. `schema/mcp/` tables; `db:generate` (after rebase, §0); `migrate:remote` at ship.
2. `logging.ts` + wire the middleware into both transports (`agent.ts` init wrapper + `routes/mcp.ts` callTool).
3. `tools/ops.ts`: `export_conversation`, `report_bug`, `list_agent_issues`, `resolve_agent_issue`, `request_feature`, `list_feature_requests`, `get_recent_activity`. Register in `tools/index.ts`.
4. `GET /api/mcp-ops/*` read routes + `pnpm run mcp:issues` script.
5. AGENTS.md additions (§7).
6. Verify: tool calls appear in `mcp_tool_invocations` grouped by session; `export_conversation` / `report_bug` / `request_feature` round-trip; back-compat intact.

**Phase 2 — admin visibility.**
7. `/admin/mcp-ops` tabbed view + nav-group entry. Stitch/UX pass.

Each phase: build + `tsc --noEmit` on changed files + Inspector smoke.

---

## 10. Open questions

1. **Log retention:** keep all `mcp_tool_invocations` forever, or prune (e.g. 90 days) via the existing master-tick cron? (Recommend: keep; single user, low volume. Add pruning only if it grows.)
2. **`export_conversation` trigger:** rely on the user asking Claude ("export our conversation"), or also add a proactive nudge in tool descriptions ("offer to export when a session produced durable value")? (Recommend: explicit ask v1.)
3. **Optional `intent` param on all tools** for richer logs — worth the schema noise? (Recommend: no; the tool name + args are enough.)
4. **Who can call `resolve_agent_issue`** — any MCP caller, or gate to the worker-key principal? (Recommend: allow, but it's a write; annotate.)
5. **Legacy `/api/mcp` session grouping:** synthesize a per-request session id (each bearer call = its own "session") or a stable per-day bucket? (Recommend: per-request id tagged `legacy`.)

---

## 11. Rough size
Phase 1 ≈ 1 migration + `logging.ts` + `tools/ops.ts` + read routes + 2 dispatch wrappers + AGENTS.md (~1–1.5 days). Phase 2 ≈ one tabbed admin page. No new Durable Object; one D1 migration.
