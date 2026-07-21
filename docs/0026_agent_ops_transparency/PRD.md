# 0026 — Agent Ops Transparency

**Status:** proposed
**Plan slug:** `0026_agent_ops_transparency`
**Branch:** `claude/agent-ops-monitoring-plan-957a42`
**Changelog:** `/admin/changelog/preview/0026-agent-ops-transparency`

---

## 1. Problem

This Worker runs **24 distinct autonomous execution surfaces** — 15 Durable
Object agents, 9 Cloudflare Workflows, 4 cron triggers, an MCP server, and an
Agents-SDK task queue. Every one of them can fail. None of them can be watched.

The evidence is specific, not theoretical:

| Symptom | Where it bit us |
|---|---|
| 49 of 145 showroom scrapes sat in `failed` with no reason, no timestamp, no attempt count | `showroom_stores.scrape_status` was a bare enum |
| `RemodelOrchestrator` self-scheduled ~1M `cf_agents_schedules` rows and burned **~$50/day** for weeks | `RemodelOrchestrator/index.ts:120-135` — found via a billing invoice, not a dashboard |
| Workers AI `3040` capacity errors during photo batches were invisible | Only recorded in `image_upload_staging.processing_error` |
| A failed AI call still bills, so a retry storm costs money silently | `metered-ai.ts` records error rows; nothing reads them |

The pattern is always the same: **the failure is discovered by its bill or by a
user, days later.** Each subsystem invented its own private status column, so
there is no question you can ask once and have answered for every agent.

### What already exists (and is unused)

The durable substrate landed and was never wired to anything:

- `agent_runs` / `agent_run_steps` / `agent_run_tool_calls`
  ([`schema/agents/runs.ts`](../../src/backend/db/schema/agents/runs.ts)) —
  full lifecycle enum including `needs_approval`, retry chain via
  `parent_run_id` + `attempt`, groupable `error_code`, per-tool timing.
  Schema comment says *"Powers /admin/agents"*. **Zero API routes, zero pages
  read it. Exactly one writer** — `showroom-scrape-workflow.ts:213`.
- `gemini_usage_log` — provider-agnostic despite the name
  (`GEMINI | WORKERS_AI | BROWSER_RENDERING | DURABLE_OBJECT | VECTORIZE |
  CF_IMAGES | GOOGLE_PLACES`), with tokens and `estimated_cost_usd`.
- `services/usage/metering.ts` — a spend circuit breaker that **fails closed**
  and can already block calls. Nothing shows you when it did.

So this is not a "build monitoring" project. It is a **wire-up**: finish the
instrumentation, expose it over an API, and give it the four screens that make
it legible.

---

## 2. Goals

1. **One question, one answer, every agent.** "What is running, what failed,
   why, and what did it cost" answered from a single generic ledger — a new
   agent appears in the UI for free, with no per-feature dashboard.
2. **Failures carry their reason.** `error_code` groups ("5 runs failed the
   same way"), `error_message` explains, tool calls show the actual upstream
   status.
3. **Retries are informed, not blind.** Attempt count and parent-run chain
   visible before anyone clicks retry.
4. **Spend is attributable.** Cost rolls up per agent, per operation, per run —
   not just per provider. A `RemodelOrchestrator`-class runaway is visible on
   day one, on a page, not on an invoice.
5. **HITL has somewhere to live.** `needs_approval` already exists in the enum;
   give it an inbox.

## 3. Non-goals

- **Not** replacing `/admin/mcp-ops` (MCP transport logging — different grain,
  different lifecycle) or `/admin/workflows` (cron schedule config).
  Agent Ops **links to** both.
- **Not** replacing `/admin/integrations/usage` (Google Maps free-tier quota).
  That page stays; the new usage page covers **AI spend**.
- **Not** a log aggregator. Structured runs and tool calls only — raw
  `console.log` output stays in Workers Observability.
- **Not** real-time streaming in v1. Polling at a visible, honest interval.

---

## 4. Users

| Who | Needs |
|---|---|
| Justin (owner) | "Is anything broken or burning money right now?" — at a glance, on a phone. |
| A coding agent (Claude via MCP) | A queryable failure backlog, so `list_agent_issues`-style triage extends to runtime failures, not just chat-reported bugs. |
| A future agent author | Free monitoring: call `startRun`, appear in the UI. |

---

## 5. Surface

Four routes under a new `/admin/system/*` prefix (none exist today — the
sidebar `system` group is a label, not a URL namespace).

| Route | Purpose |
|---|---|
| `/admin/system/agents/queue` | Live run queue, grouped by status |
| `/admin/system/agents/queue/[id]` | One run: step trace, tool calls, failure, retry |
| `/admin/system/agents/failed` | Failure triage sheet with filters + KPIs |
| `/admin/system/agents/usage` | AI spend, token pace, breaker events, unit cost |

Each is a thin Astro shell + one React island, per the mandatory page-styling
rule in `AGENTS.md` (`container mx-auto px-4 py-8 pb-12`, icon'd `h1`,
`client:only="react"`).

### 5.1 Retrofit of the supplied shadcn templates

The four reference templates are generic SaaS "agent platform" mockups. They
are adopted for **layout and interaction**, and their domain model is replaced
wholesale — the generic fields are wrong for this project and would otherwise
become decorative lies.

| Template field | Verdict | Our replacement | Source |
|---|---|---|---|
| Owner avatars ("Maya Perez") | **Cut** | **Agent identity chip** — `agent` slug + `operation` | `agent_runs.agent`, `.operation` |
| `Production / Staging / Development` badge | **Cut** | **Surface** badge — `workflow / durable-object / cron / mcp / user` | derived from `agent_runs.triggered_by` + agent registry |
| `RUN-4831` opaque id | **Keep, real** | `agent_runs.id`, linkable | — |
| Progress ring `62%` | **Keep, real** | `done steps / total steps` | `agent_run_steps` |
| `Needs approval` badge | **Keep, real** | HITL pause | `status = 'needs_approval'` |
| `Retrying` badge | **Keep, real** | `attempt > 1`, with parent chain | `attempt`, `parent_run_id` |
| `402 card_declined` error chip | **Keep, real** | `error_code` (`MAPS_QUOTA_EXCEEDED`, `3040`, `SCRAPE_TIMEOUT`) | `error_code` |
| Step trace + collapsible tool calls | **Keep, real** | exactly our 3-table shape | `agent_run_steps` → `agent_run_tool_calls` |
| "Run Settings" editable form (priority, max retries, notify) | **Cut in v1** | Read-only run facts + **Retry / Cancel / Approve** actions | there is no per-run settings store; a fake form is worse than none |
| Cost: `OpenRoute Primary`, `Northstar Claude Pool` | **Cut** | Real providers: `WORKERS_AI`, `GEMINI`, `BROWSER_RENDERING`, `GOOGLE_PLACES`, `CF_IMAGES`, `VECTORIZE`, `DURABLE_OBJECT` | `METERED_PROVIDERS` |
| "Budget Events" | **Keep, real** | Circuit-breaker trips + `SpendBlockedError` denials | `metering.ts` + `project_system_variables` |
| Unit cost `$4.18/1M` | **Keep, real** | `SUM(estimated_cost_usd) / SUM(total_tokens) * 1e6` | `gemini_usage_log` |
| **(new — not in template)** | **Add** | **Cost per run**, and cost per agent | requires the one migration (§6) |

**Deliberate additions the templates lack**, because our failure modes demand
them:

- **Attempt chain** — template shows "attempt 1 of 3" as static text; we render
  the actual parent/child run lineage, so an earlier failure is never lost.
- **Runaway detector card** — runs-per-hour for one agent against its own
  trailing baseline. This is the card that would have caught the
  `RemodelOrchestrator` incident.
- **Uninstrumented-surface banner** — the queue page names which of the 24
  surfaces are not yet writing to the ledger. Silence must read as "not wired",
  never as "healthy".

## 6. Data

Reuses the existing ledger as-is. **One additive migration:**

```sql
ALTER TABLE gemini_usage_log ADD COLUMN agent_run_id INTEGER;
CREATE INDEX gemini_usage_log_agent_run_idx ON gemini_usage_log (agent_run_id);
```

Nullable, additive, no backfill — safe for the ~20 other live branches sharing
this D1. Without it, spend can only be attributed by the free-text `feature`
string; a string-convention join cannot answer "what did run 4822 cost" and
rots the first time a caller spells `feature` differently.

## 7. Success criteria

1. ≥ 90% of agent executions (workflows, DO callables, cron jobs, queue tasks)
   produce an `agent_runs` row. The queue page names the remainder.
2. Every `failed` run shows a non-null `error_code` **and** the failing tool
   call with its upstream status.
3. `/admin/system/agents/usage` reconciles to within 5% of the Cloudflare AI
   Gateway rollup for the same window.
4. A `RemodelOrchestrator`-shaped runaway is visible on the queue page within
   one polling interval of onset.
5. QC script `scripts/qc/pr_<n>.mjs` exercises all four routes + every new API
   endpoint against the deployed preview worker.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Instrumenting 24 surfaces is a huge diff | Phased. P0 covers the 6 highest-value surfaces; the rest is mechanical and lands per-phase. |
| Ledger writes slow down or break real work | Already solved: `startRun` never throws, returns a `nullRecorder` on failure (`agent-runs.ts:81-103`). Do not weaken this. |
| `agent_runs` grows unbounded | Retention sweep in the existing `* * * * *` cron; runs older than 30d pruned, `failed` kept 90d. |
| D1 has no transactions | All multi-row writes via `db.batch()`. Never `db.transaction()` — it is a dead endpoint on D1. |
| Another branch collides on the same D1 | Migration is additive-only and touches one existing table with a nullable column. |
