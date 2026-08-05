# 0044 — Build prompt: MCP → Code Mode

Upgrade the MCP server to Cloudflare Code Mode per IMPLEMENTATION_PLAN.md. Ground
every step in the Cloudflare docs (query the cloudflare-docs MCP) — do NOT guess
the SDK API.

**Reference docs (verify current before coding):**
- https://developers.cloudflare.com/agents/tools/codemode/ (overview + API reference)
- https://developers.cloudflare.com/agents/model-context-protocol/codemode/ (single `code` tool vs search-and-execute)
- https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/
- https://developers.cloudflare.com/agents/tools/codemode/how-it-works/ (`CodeModeInput/Output`, paused executions)
- https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/ (approvals, execution log)
- https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/ (LOADER)

**We already have:** `LOADER` worker_loaders binding (wrangler.jsonc), `nodejs_compat`,
`RemodelMcpAgent extends McpAgent` with `server = new McpServer()` registering
`getAllTools()` (87+ tools, `src/backend/mcp/`). Tool annotations exist
(READ_ONLY/WRITE/WRITE_IDEMPOTENT/DESTRUCTIVE, `types.ts`).

**P0 — spike (throwaway, measure):**
- `pnpm add @cloudflare/codemode`.
- New endpoint `/mcp/code`: `codeMcpServer({ server, executor: new DynamicWorkerExecutor({ loader: env.LOADER }) })` (`@cloudflare/codemode/mcp`) over ~5 tools.
- Verify: a model-written `async () => { ... codemode.<tool>(args) ... }` runs in the
  sandbox, dispatches to the HOST handler (which uses D1/env), returns. Confirm the
  sandbox's `globalOutbound: null` doesn't break host handlers (it shouldn't — they
  run host-side via ToolDispatcher).
- MEASURE: startup CPU (vs the 10021 near-miss) + initial tool-context size vs `/mcp`.
- Bump `compatibility_date` only if the SDK/worker-loader demands it.

**P1 — full registry:** wrap ALL `getAllTools()` at `/mcp/code`; keep legacy `/mcp`
(direct tools) live for back-compat. Generated TS types from each tool's Zod
`inputShape`. Preserve OAuth gate + per-invocation logging (now at dispatch time).

**P2 — search/describe:** add `codemode.search()`/`describe()` so 100+ tool types stay
out of initial context. Re-measure startup headroom.

**P3 — durable approvals:** map annotations → `requiresApproval` (WRITE*/DESTRUCTIVE
pause, READ_ONLY auto). Wire `approveExecution`/`rejectExecution`/`pendingApprovals`;
surface pending in the 0042 alerts center. Decide `agents` bump (0.12.3 → ≥0.16 for
`createCodemodeRuntime`) vs a custom `Executor` — treat any agents bump as its own
reviewed PR (DO migration tags / AIChatAgent / routeAgentRequest gotchas).

**P4 — cut over + docs:** make Code Mode the default connector surface; keep `/mcp`
as a deprecation-window fallback; update `/connect`. Regression-test existing chat.

**Constraints:** handlers stay HOST-side (never move into the sandbox — they need
D1/env/Gmail, sandbox is network-isolated); `/mcp` stays live through rollout; no
DO-migration-tag bump unless a new DO is introduced; QC + changelog + preview per
repo rules; each phase measures startup-CPU + context-size to prove the win.
