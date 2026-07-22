# 0029 — Provider Pricing & Health · Coding-agent brief

First action: `git fetch origin main -q && git log --oneline HEAD..origin/main | wc -l` must print 0.
Read `AGENTS.md` in full before editing. Read `docs/0029_provider_pricing_and_health/IMPLEMENTATION_PLAN.md`.

## What exists already (do not rebuild)

- `gemini_usage_log` — provider-agnostic usage ledger with token columns and a
  nullable `estimated_cost_usd` that currently has no writer.
- `services/usage/metering.ts` — `recordUsage`, `canSpend`, the spend breaker.
- `services/usage/metered-ai.ts` — `meteredAiRun`, the wrapper adopted at the
  hot call sites.
- `services/agent-runs.ts` — `startRun`; instrument the weekly refresh with it.
- `/admin/system/agents/usage` + `components/system/agents/AgentUsageApp.tsx`.

## Build order

**P1 — catalog.** `model_pricing` + `pricing_fetch_runs` tables. Four fetchers:
Anthropic / Gemini / OpenAI parse **Markdown** (the sources are `.md` /
`.md.txt`, so `HTMLRewriter` does not apply — write a small Markdown-table
reader, no dependency); Workers AI reads the Cloudflare models API and converts
`neuron_per_unit` at `$0.011 / 1,000 neurons`. Weekly cron `0 9 * * 1`. Set a
`User-Agent` on every fetch. A provider that fails keeps its old prices.

**P2 — cost + latency.** `latency_ms` on `gemini_usage_log`. `recordUsage`
computes cost from the catalog when the caller did not supply one: input and
output priced separately. A catalog miss stores **NULL, never 0**.

**P3 — registry + health.** Friendly names and groups (Cloudflare Bindings / AI
Providers / Integrations). Per-provider health (`SUCCESS` / `PARTIAL` /
`FAILURE` / `OFFLINE`), median latency, uptime since last error.

**P4 — UI.** Grouped provider table, health badge + latency + uptime per row,
currency as `$ 100.00`, integers with thousands separators.

## Rules that will bite you here

- `db.batch()`, never `db.transaction()` — D1 rejects `BEGIN` (error 7500).
- `pnpm run db:generate` then `pnpm run migrate:remote`; never raw SQL, never
  hand-edit a migration.
- `pnpm run build` is esbuild and does NOT type-check — run `npx tsc --noEmit`.
- Never log `CLOUDFLARE_WRANGLER_API_TOKEN` or any secret-store value.
- One PR per phase, each with a QC script run against `--preview`.
- You own the deploy: `pnpm run deploy` from main after merge, and say so.
