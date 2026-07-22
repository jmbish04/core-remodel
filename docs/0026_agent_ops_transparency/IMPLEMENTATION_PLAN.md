# 0026 — Agent Ops Transparency · Implementation Plan

**Plan slug:** `0026_agent_ops_transparency` → tracked live at `/admin/plans/0026_agent_ops_transparency`
**PRD:** [PRD.md](./PRD.md) · **Agent brief:** [PROMPT.md](./PROMPT.md)

---

## 0. What is already built (do not rebuild)

| Asset | File | State |
|---|---|---|
| `agent_runs` / `agent_run_steps` / `agent_run_tool_calls` | `src/backend/db/schema/agents/runs.ts` | **Merged on `main`.** Zero readers. |
| `startRun` recorder (`step`/`tool`/`succeed`/`fail`/`needsApproval`) | `src/backend/services/agent-runs.ts` | **Merged.** One caller. |
| `errorCodeOf` / `safeJson` redaction + size caps | `src/backend/services/agent-run-format.ts` | Merged. |
| `gemini_usage_log` (provider-agnostic, tokens + `estimated_cost_usd`) | `src/backend/db/schema/system/gemini-usage.ts` | Merged. |
| Spend breaker (`canSpend`, `tripBreaker`, `SpendBlockedError`) | `src/backend/services/usage/metering.ts`, `metered-ai.ts` | Merged. Fails closed. |
| Cron schedule config + run history | `src/backend/db/schema/admin/workflow_schedules.ts` | Merged, has its own `/admin/workflows` API. |
| Mermaid rendering in changelog detail | `src/frontend/components/mermaidcn/` | Merged. `client:load` required. |

**The only writer today** is `showroom-scrape-workflow.ts:213`. Everything else
in this plan hangs off closing that gap.

---

## 1. Instrumentation coverage map

27 surfaces. Ordered by value = (blast radius × failure rate × cost).

```mermaid
graph LR
  subgraph P0["P0 — instrument first (6)"]
    W1["ShowroomScrapeWorkflow<br/><i>already wired</i>"]
    W2[BrandResearchWorkflow]
    W3[ProductResearchWorkflow]
    W4[ImageProcessingWorkflow]
    Q1["ShowroomResearchAgent<br/>.backfillEnrichShowroom<br/><i>DO queue</i>"]
    O1["RemodelOrchestrator.audit<br/><i>the $50/day runaway</i>"]
  end
  subgraph P0b["P0b — remaining workflows (5)"]
    W5[DeepResearchJobWorkflow]
    W6[BlankCanvasBatchWorkflow]
    W7[ImageBatchProcessingWorkflow]
    W8[ChecklistRationaleWorkflow]
    W9[ShowroomOnboardingWorkflow]
  end
  subgraph P0c["P0c — DO callables + cron (13)"]
    D1[DeepResearchAgent.runDeepResearch]
    D2[ResearchAgent.startResearch]
    D3[ShowroomScout.startScout]
    D4[PermitIntelligenceAgent.runIntelligence]
    D5[RenovationAgent.processUpload]
    D6[BidPortfolioAgent.chat]
    C1["cron: runPermitSync"]
    C2["cron: autoHealImageUploads"]
    C3["cron: backfillShowroomPlacesData"]
    C4["cron: ingestCompanyEmails"]
    C5["cron: sweepShowroomSales"]
    C6["cron: monitorShowroomSourcingCoverage"]
    C7["cron: pollVehicleForActiveDrive"]
  end
  L[("agent_runs<br/>agent_run_steps<br/>agent_run_tool_calls")]
  P0 --> L
  P0b --> L
  P0c --> L
```

**Rule for every call site:** wrap, never rewrite. `startRun` is best-effort by
contract — it returns a no-op recorder rather than throwing — so adding it can
never break the work it measures. Do not add try/catch around it.

---

## 2. Data model

Existing tables, unchanged, plus **one additive column**.

```mermaid
erDiagram
    agent_runs ||--o{ agent_run_steps : "run_id (cascade)"
    agent_runs ||--o{ agent_run_tool_calls : "run_id (cascade)"
    agent_run_steps ||--o{ agent_run_tool_calls : "step_id (nullable)"
    agent_runs ||--o{ agent_runs : "parent_run_id (retry chain)"
    agent_runs ||--o{ gemini_usage_log : "agent_run_id (NEW)"

    agent_runs {
        integer id PK
        text    agent            "slug: showroom-research, remodel-orchestrator"
        text    operation        "scrape_store, audit, deep_sweep"
        text    target_type      "showroom_store | brand | image"
        text    target_id
        text    target_label     "denormalized, lists render without joins"
        text    status           "queued|running|needs_approval|succeeded|failed|cancelled"
        integer attempt          "1-based; retry of the SAME logical work"
        integer parent_run_id    "the run this one replaces"
        text    error_code       "groupable: MAPS_QUOTA_EXCEEDED, 3040, 503"
        text    error_message    "full text, never truncated into the code"
        text    input_json       "enough to replay"
        text    output_json      "renderable digest, not the full payload"
        text    triggered_by     "cron|user|mcp|agent"
        integer started_at
        integer ended_at
        integer duration_ms      "denormalized for sort-by-duration"
        integer created_at
    }
    agent_run_steps {
        integer id PK
        integer run_id FK
        integer seq              "1-based, orders the trace without timestamps"
        text    label
        text    status
        text    error_message
        integer duration_ms
    }
    agent_run_tool_calls {
        integer id PK
        integer run_id FK
        integer step_id FK       "null = call outside any step"
        text    tool             "browser.render, places.details, ai.run"
        integer ok               "boolean"
        text    args_json        "redacted + size-capped by the writer"
        text    result_json
        text    error_code       "the actual upstream status"
        text    error_message
        integer attempt
        integer duration_ms
        integer at
    }
    gemini_usage_log {
        integer id PK
        integer agent_run_id     "NEW — nullable FK-by-convention to agent_runs"
        text    provider         "WORKERS_AI|GEMINI|BROWSER_RENDERING|..."
        text    model
        text    feature
        text    status           "ok|error"
        integer prompt_tokens
        integer candidates_tokens
        integer total_tokens
        real    estimated_cost_usd
        text    error_message
        integer timestamp
    }
```

### Migration (P1-DB-01)

Generated with `pnpm run db:generate`, applied with `pnpm run migrate:remote`.
**Never** hand-edit a migration, never `wrangler d1 execute --file`.

```sql
ALTER TABLE `gemini_usage_log` ADD `agent_run_id` integer;
CREATE INDEX `gemini_usage_log_agent_run_idx` ON `gemini_usage_log` (`agent_run_id`);
```

Additive + nullable + no backfill → safe against the ~20 concurrent branches
sharing this remote D1.

### The four queries that back the UI

```sql
-- Q1 · queue, grouped by status (index: agent_runs_status_created_idx)
SELECT r.status, r.id, r.agent, r.operation, r.target_label, r.attempt,
       r.triggered_by, r.error_code, r.duration_ms, r.created_at,
       COUNT(s.id)                                          AS steps_total,
       SUM(CASE WHEN s.status = 'succeeded' THEN 1 ELSE 0 END) AS steps_done
  FROM agent_runs r
  LEFT JOIN agent_run_steps s ON s.run_id = r.id
 WHERE r.created_at >= ?window
 GROUP BY r.id
 ORDER BY r.created_at DESC
 LIMIT ?limit;

-- Q2 · one run, full trace (indexes: run_seq_idx, tool_calls run_idx)
SELECT * FROM agent_runs       WHERE id      = ?id;
SELECT * FROM agent_run_steps  WHERE run_id  = ?id ORDER BY seq;
SELECT * FROM agent_run_tool_calls WHERE run_id = ?id ORDER BY at;
--   plus the retry lineage:
WITH RECURSIVE chain(id) AS (
  SELECT ?id UNION SELECT r.parent_run_id FROM agent_runs r JOIN chain c ON r.id = c.id
) SELECT * FROM agent_runs WHERE id IN (SELECT id FROM chain) ORDER BY attempt;

-- Q3 · failure triage — "5 runs failed the same way"
SELECT error_code, agent, operation, COUNT(*) AS n, MAX(created_at) AS latest
  FROM agent_runs
 WHERE status = 'failed' AND created_at >= ?window
 GROUP BY error_code, agent, operation
 ORDER BY n DESC;

-- Q4 · spend, attributed (needs the new column)
SELECT COALESCE(r.agent, '(unattributed)') AS agent,
       u.provider, u.model,
       SUM(u.total_tokens)        AS tokens,
       SUM(u.estimated_cost_usd)  AS cost_usd,
       SUM(u.status = 'error')    AS errored_calls
  FROM gemini_usage_log u
  LEFT JOIN agent_runs r ON r.id = u.agent_run_id
 WHERE u.timestamp >= ?cycleStart
 GROUP BY agent, u.provider, u.model
 ORDER BY cost_usd DESC;
```

---

## 3. API

New router `src/backend/api/routes/admin-agents.ts`, mounted at
`/api/admin/agents` — which puts it behind the existing
`app.use("/api/admin/*", requireAccessAuth)` gate at `api/index.ts:117`. No new
auth code.

```mermaid
classDiagram
    class AdminAgentsRouter {
        <<Hono · /api/admin/agents>>
        +GET  /overview  ~counts, spend, breaker, runaway~
        +GET  /runs      ~status, agent, since, limit~
        +GET  /runs/:id  ~run + steps + toolCalls + lineage~
        +POST /runs/:id/retry     ~new run, parent_run_id set~
        +POST /runs/:id/cancel    ~status=cancelled~
        +POST /runs/:id/approve   ~needs_approval → running~
        +GET  /failures  ~grouped by error_code~
        +GET  /usage     ~by agent, provider, model, day~
        +GET  /coverage  ~which of 27 surfaces are wired~
    }
    class AgentRunsService {
        <<services/agent-runs.ts · EXISTS>>
        +startRun(env, input) RunRecorder
        +RunRecorder.step(label, fn)
        +RunRecorder.tool(name, args, fn)
        +succeed(output) / fail(err) / needsApproval()
        ~never throws — nullRecorder on failure~
    }
    class AgentRunsQuery {
        <<services/agent-runs-query.ts · NEW>>
        +listRuns(env, filter) RunSummary[]
        +getRun(env, id) RunDetail
        +groupFailures(env, window) FailureGroup[]
        +spendByAgent(env, cycleStart) AgentSpend[]
        +coverage(env) SurfaceCoverage[]
        ~read-only, no writes~
    }
    class AgentRegistry {
        <<services/agent-registry.ts · NEW>>
        +AGENT_SURFACES: SurfaceDef[]
        +surfaceOf(agent) workflow|durable-object|cron|mcp
        ~the 27 surfaces, declared once~
    }
    class Metering {
        <<services/usage/metering.ts · EXISTS>>
        +canSpend(env, provider) SpendDecision
        +getCycleSpend(env, provider) number
        +recordUsage(env, rec)
    }
    AdminAgentsRouter ..> AgentRunsQuery : reads
    AdminAgentsRouter ..> AgentRegistry : labels + coverage
    AdminAgentsRouter ..> Metering : breaker state + spend
    AgentRunsService ..> Metering : passes agent_run_id
```

Every response is Zod-validated via `@hono/zod-openapi` so `/openapi.json`,
`/scalar` and the MCP catalog stay honest. Hand-written Zod v4 schemas — never
`drizzle-zod` (it breaks `pnpm run build` on the pinned `drizzle-orm@0.33.0`).

---

## 4. Request flow — instrumented run, end to end

```mermaid
sequenceDiagram
    autonumber
    participant CR as Cron / User / MCP
    participant WF as Workflow · DO Agent
    participant RR as startRun() recorder
    participant D1 as D1 · agent_runs*
    participant MT as metering.canSpend
    participant AI as Workers AI · Gemini
    participant UI as /admin/system/agents/*

    CR->>WF: trigger
    WF->>RR: startRun({agent, operation, target, triggeredBy})
    RR->>D1: INSERT agent_runs (status=running)
    D1-->>RR: runId
    Note over RR: insert fails → nullRecorder,<br/>real work proceeds unrecorded

    WF->>RR: run.step("discover links", fn)
    RR->>D1: INSERT agent_run_steps (seq, running)
    RR->>MT: assertCanSpend(WORKERS_AI)
    alt over ceiling
        MT-->>RR: SpendBlockedError
        RR->>D1: tool_call ok=0, error_code=SPEND_BLOCKED
        RR->>D1: UPDATE agent_runs status=failed
    else allowed
        RR->>AI: env.AI.run(...)
        AI-->>RR: result + usage
        RR->>D1: INSERT agent_run_tool_calls (ok, duration_ms, args redacted)
        RR->>D1: INSERT gemini_usage_log (agent_run_id, tokens, cost)
        RR->>D1: UPDATE agent_run_steps status=succeeded
    end

    alt HITL gate
        WF->>RR: run.needsApproval(digest)
        RR->>D1: UPDATE status=needs_approval
        UI->>D1: POST /runs/:id/approve → running
    end

    WF->>RR: run.succeed(digest) / run.fail(err)
    RR->>D1: UPDATE status, ended_at, duration_ms, error_code
    UI->>D1: GET /api/admin/agents/runs (poll 10s)
    D1-->>UI: grouped queue + progress + spend
```

---

## 5. Screen map

```mermaid
flowchart TD
    NAV["Sidebar · System group<br/>nav-groups.ts"] --> Q
    Q["/admin/system/agents/queue<br/><b>Run Queue</b>"]
    Q -->|row click| DET["/admin/system/agents/queue/[id]<br/><b>Run Detail</b>"]
    Q -->|Attention filter| F["/admin/system/agents/failed<br/><b>Failure Sheet</b>"]
    Q -->|spend badge| U["/admin/system/agents/usage<br/><b>Cost Dashboard</b>"]
    F -->|row click| DET
    DET -->|Retry| API1[["POST /runs/:id/retry"]]
    DET -->|Approve| API2[["POST /runs/:id/approve"]]
    API1 --> Q
    API2 --> Q
    U -.->|links out, does not duplicate| MAPS["/admin/integrations/usage<br/>Google Maps quota"]
    Q -.->|links out| MCP["/admin/mcp-ops<br/>MCP transport"]
    Q -.->|links out| WFP["/admin/workflows<br/>cron schedules"]

    subgraph legend[" "]
      direction LR
      N1["new page"]:::new
      N2["existing, linked"]:::old
    end
    classDef new fill:#1f2937,stroke:#6366f1,color:#e5e7eb
    classDef old fill:#111827,stroke:#4b5563,color:#9ca3af
    class Q,DET,F,U new
    class MAPS,MCP,WFP old
```

---

## 6. Phases

Each phase = one PR, one QC script, one changelog entry. Task keys match the
`plan_tasks` rows staged in D1.

### P0 — Instrumentation coverage (`AGENT-P0-*`)
Close the writer gap. No UI. Value lands immediately because the ledger starts
filling.

- `P0-INST-01` `agent-registry.ts` — declare all 27 surfaces once (slug,
  display name, surface kind, expected cadence). Coverage + labels read from it.
- `P0-INST-02..07` — wrap the six highest-value surfaces (brand research,
  product research, image processing, showroom backfill queue task,
  orchestrator audit, deep-research job).
- `P0-INST-08` — thread `agent_run_id` from the recorder into `recordUsage`, so
  spend attributes without call-site changes.
- `P0-INST-09` — retention sweep in the existing `* * * * *` cron: prune
  `succeeded` > 30d, `failed` > 90d, via `db.batch()`.

### P1 — Data + read API (`AGENT-P1-*`)
- `P1-DB-01` migration: `gemini_usage_log.agent_run_id` + index.
- `P1-API-01..03` `agent-runs-query.ts` + `admin-agents.ts` router +
  zod-openapi schemas; mount under `/api/admin/agents`.
- `P1-API-04` runaway detector: runs/hour per agent vs 7-day trailing baseline.

### P2 — UI primitives (`AGENT-P2-*`)
The templates need six shadcn primitives this repo does not have:
`table`, `progress`, `collapsible`, `skeleton`, `pagination`, plus a small
`timeline` composed from `separator` + `item`. Install via the shadcn CLI under
the Monolith dark profile — do not hand-roll (the `/admin/plans` progress bars
are hand-rolled and should later be migrated onto `progress`).

### P3 — Queue + detail (`AGENT-P3-*`)
Retrofit templates 1 and 2. Status-grouped rows, live badge, progress ring,
agent-identity chip, surface badge, attempt chain, uninstrumented-surface
banner. Detail page: step trace with collapsible tool calls, failure alert with
the real upstream code, read-only run facts, Retry/Cancel/Approve.

### P4 — Failure sheet (`AGENT-P4-*`)
Retrofit template 3. KPI cards (exposure = runs blocked by breaker, backoff =
retrying count, coverage = wired surfaces, replayable = runs with `input_json`),
data-grid with agent/status/error filters, grouped-by-`error_code` view.

### P5 — Usage + cost (`AGENT-P5-*`)
Retrofit template 4. Spend-vs-cap pace chart (recharts, existing `chart`
primitive), provider mix from `METERED_PROVIDERS`, breaker-event feed, unit
cost, cost-by-agent table. Links to — does not duplicate —
`/admin/integrations/usage`.

### P6 — Wire-up + verification (`AGENT-P6-*`)
Nav entries in `nav-groups.ts` `system` group, QC script
`scripts/qc/pr_<n>.mjs` against `--preview`, changelog entry + `PhaseDetail`
with these diagrams, `npx tsc --noEmit`.

---

## 7. Guardrails (non-negotiable, from `AGENTS.md`)

1. **`db.batch()`, never `db.transaction()`** — D1 rejects `BEGIN` (error 7500);
   the callback never runs and the endpoint 500s.
2. **FKs, never denormalized `*_name`** — `target_label` is the sanctioned
   exception: a deliberate point-in-time snapshot, documented as such in the
   schema.
3. **`class`, never `className`, in `.astro`** — a `className` on a native
   element renders as a dead attribute and the page collapses to the top-left.
4. **Structured output with a JSON schema** for any AI call added here.
5. **Never log the auth token / `WORKER_API_KEY`** — `agent-run-format.ts`
   already redacts secret-ish keys and caps blob size. Route all writes through
   it.
6. **`pnpm run db:generate` → `pnpm run migrate:remote`.** Never raw SQL.
7. **Type-check separately** — `pnpm run build` is esbuild and does not check
   types. Run `npx tsc --noEmit`.
8. **QC against `--preview`, not production**, while the PR is open.

## 8. Verification

```bash
pnpm run deploy:preview                  # wcrp-<branch-slug>
pnpm run migrate:remote                  # shared D1 — additive only
pnpm run test:pr <n> -- --preview
npx tsc --noEmit
```

QC must assert: every new endpoint 200s with the expected shape; a synthetic
run written through `startRun` appears on the queue; a synthetic failure
carries `error_code` + tool call; `/usage` totals reconcile against a direct
`gemini_usage_log` sum; all four pages render (non-empty `<main>`, no
`className` regression).
