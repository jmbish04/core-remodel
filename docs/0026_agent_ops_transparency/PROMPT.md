# 0026 — Agent Ops Transparency · Coding-agent brief

Paste this to a fresh coding session. It assumes **no** prior context.

---

## Ground rules

1. **First action: verify the worktree is fresh.**
   ```bash
   git fetch origin main -q && git log --oneline HEAD..origin/main | wc -l   # must be 0
   ```
   Non-zero → stop, rebase onto `origin/main` or cut a fresh worktree. Reading
   stale code here manufactures confident wrong conclusions: this repo has ~20
   live worktrees and merges to `main` constantly.
2. **Read `AGENTS.md` at the repo root in full before editing.** It is binding.
   The rules that will bite you on this task specifically: `db.batch()` not
   `db.transaction()`; foreign keys not denormalized `*_name` columns; `class`
   not `className` in `.astro`; `pnpm run db:generate` + `pnpm run
   migrate:remote` and never raw SQL; `pnpm run build` does not type-check.
3. **Last action: you own the deploy.** Nothing auto-deploys. Merging to `main`
   does not ship. State explicitly at the end of the turn whether you deployed,
   whether migrations were applied to remote, and what QC returned.
4. Work **one phase per PR**. Do not batch phases.

## Read these first

- `docs/0026_agent_ops_transparency/PRD.md` — why, and the exact
  template→domain retrofit table.
- `docs/0026_agent_ops_transparency/IMPLEMENTATION_PLAN.md` — phases, schema,
  queries, API shape, diagrams.
- Live task board: `/admin/plans/0026_agent_ops_transparency`. Task keys are
  `AGENT-P0-*` … `AGENT-P6-*`. Move a task to `in_progress` when you start it
  and `done` when its PR merges — `PATCH /api/admin/plans/tasks/:id`.

## What already exists — do not rebuild it

```
src/backend/db/schema/agents/runs.ts      agent_runs, agent_run_steps, agent_run_tool_calls
src/backend/services/agent-runs.ts        startRun() → RunRecorder (step/tool/succeed/fail/needsApproval)
src/backend/services/agent-run-format.ts  errorCodeOf, safeJson — redaction + size caps
src/backend/db/schema/system/gemini-usage.ts   gemini_usage_log (provider-agnostic, tokens + cost)
src/backend/services/usage/metering.ts    canSpend / tripBreaker / recordUsage — fails closed
src/backend/services/usage/metered-ai.ts  meteredAiRun, assertCanSpend, SpendBlockedError
```

The ledger is merged and **has exactly one writer**:
`src/backend/services/showroom-scrape-workflow.ts:213`. Copy that call site's
shape — it is the reference implementation.

There is **no** API route and **no** page reading `agent_runs` yet. You are
building the first ones.

## The instrumentation contract

```ts
const run = await startRun(env, {
  agent: "brand-research",          // stable slug, matches agent-registry.ts
  operation: "research_brand",
  targetType: "brand",
  targetId: String(brandId),
  targetLabel: brand.name,          // sanctioned denormalized snapshot
  triggeredBy: "cron",              // cron | user | mcp | agent
});

try {
  const pages = await run.step("scrape site", async (step) =>
    step.tool("browser.render", { url }, () => render(url)),
  );
  await run.succeed({ pages: pages.length });
} catch (err) {
  await run.fail(err);              // records error_code + message
  throw err;                        // rethrow — fail() swallows nothing for you
}
```

**Do not wrap `startRun` in try/catch.** It never throws; on a ledger failure it
returns a no-op recorder and the real work proceeds unrecorded. That is
deliberate — losing real work to a telemetry bug is unacceptable. Preserve it.

**Use the step-scoped `step.tool(...)`, not `run.tool(...)`, inside a step.**
Attribution is passed as an argument precisely so concurrent steps
(`Promise.all` over pages) cannot steal each other's tool calls.

## Phase order and definition of done

| Phase | Deliverable | Done when |
|---|---|---|
| **P0** | `agent-registry.ts` + 6 wrapped surfaces + `agent_run_id` threaded into `recordUsage` + retention sweep | Ledger fills for brand research, product research, image processing, showroom backfill queue, orchestrator audit, deep-research job. Verified by querying remote D1. |
| **P1** | Migration `gemini_usage_log.agent_run_id` + `agent-runs-query.ts` + `admin-agents.ts` router | Every endpoint 200s with a Zod-validated shape and appears in `/openapi.json`. |
| **P2** | shadcn primitives: `table`, `progress`, `collapsible`, `skeleton`, `pagination`, `timeline` | Installed via the shadcn CLI under the Monolith dark profile. Not hand-rolled. |
| **P3** | `/admin/system/agents/queue` + `/queue/[id]` | Real runs render, grouped by status; detail shows step trace + tool calls; Retry/Cancel/Approve work. |
| **P4** | `/admin/system/agents/failed` | Filters by agent/status/error; grouped-by-`error_code` view answers "5 runs failed the same way". |
| **P5** | `/admin/system/agents/usage` | Spend pace vs cap, provider mix, breaker events, unit cost, cost-by-agent. Reconciles to within 5% of the AI Gateway rollup. |
| **P6** | Nav + QC + changelog | Sidebar entries live, `pnpm run test:pr <n> -- --preview` green, changelog entry has branch + PR + test output + migration status. |

## Retrofitting the supplied templates — read this before writing JSX

Four shadcn/ReUI templates were supplied as the visual reference. They are
generic SaaS mockups. **Adopt the layout and interaction; replace the domain
model entirely.** PRD §5.1 has the full mapping. The traps:

- **Delete the owner-avatar column.** There are no per-run human owners in this
  system. Render the **agent identity** (`agent` + `operation`) there instead.
- **Delete the `Production / Staging / Development` badge.** There is one
  environment. Render the **surface** (`workflow` / `durable-object` / `cron` /
  `mcp` / `user`) — derived from `triggered_by` + the agent registry.
- **Delete the editable "Run Settings" form** (priority, max retries, notify
  owners). No per-run settings store exists. A form that silently discards its
  input is worse than no form. Render read-only run facts plus the three real
  actions.
- **Replace the fictional providers** (`OpenRoute Primary`, `Northstar Claude
  Pool`) with the real `METERED_PROVIDERS` enum.
- **Keep, because they map to real columns:** progress ring (`steps_done /
  steps_total`), `Needs approval` (`status`), `Retrying` (`attempt > 1`), the
  error chip (`error_code`), the step-trace timeline and its collapsible tool
  calls (our exact 3-table shape).

Three things the templates do **not** have and you must add:

1. **Attempt/retry lineage** — walk `parent_run_id` and render the chain, so an
   earlier failure is never lost behind its replacement.
2. **Runaway detector card** — runs/hour for one agent against its own 7-day
   trailing baseline. This is the card that would have caught the
   `RemodelOrchestrator` incident that burned ~$50/day for weeks.
3. **Uninstrumented-surface banner** — name the surfaces not yet writing to the
   ledger. An empty queue must read as "not wired", never as "healthy".

## Page shell (mandatory)

Every page is a thin Astro shell mounting one React island. Canonical example:
`src/frontend/pages/admin/studio.astro`.

```astro
---
import BaseLayout from "@/layouts/BaseLayout.astro";
import { AgentQueueApp } from "@/components/system/agents/AgentQueueApp";
---
<BaseLayout title="Agent Run Queue — The Monolith" description="Live agent run backlog, grouped by status.">
  <main class="container mx-auto px-4 py-8 pb-12">
    <div class="mb-8">
      <h1 class="mb-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
        <!-- 24px lucide icon, class="size-6 text-muted-foreground" aria-hidden -->
        Run Queue
      </h1>
      <p class="text-muted-foreground">Every agent execution, grouped by status.</p>
    </div>
    <AgentQueueApp client:only="react" />
  </main>
</BaseLayout>
```

`class`, never `className`, in `.astro`. Astro only applies `class`; a
`className` on a native element is a dead attribute, the Tailwind classes never
land, and the page silently collapses into the top-left corner.

## Before you open a PR

```bash
git worktree list                                  # who else is in here
git fetch origin && git log --oneline HEAD..origin/main
gh pr list --limit 20                              # read their FILE lists
```

If another open PR touches the same files, say so and propose an order. Then:

```bash
pnpm run db:generate            # only if schema changed
pnpm run migrate:remote         # then VERIFY the column exists on remote
pnpm run deploy:preview
pnpm run test:pr <n> -- --preview
npx tsc --noEmit
pnpm run preview:delete         # after merge, from this branch's worktree
```

Paste the real QC output into the PR body and into the changelog entry. Never
paraphrase a test result.
