# 0029 — Provider Pricing & Health

**Status:** in progress · **Plan slug:** `0029_provider_pricing_and_health`
**Changelog:** `/admin/changelog/preview/0029-provider-pricing-and-health`

## Problem

`/admin/system/agents/usage` shipped in 0026 and reports **$0 for every
provider**. Not because nothing was spent — 7.5M tokens and 1,398 calls in the
current cycle — but because `gemini_usage_log.estimated_cost_usd` has no writer.
The column exists, is nullable, and is null almost everywhere.

A cost dashboard that renders `$0` is worse than no cost dashboard, because it
reads as reassurance.

Alongside that: providers render as raw enum values (`CF_IMAGES`), sit in one
flat list regardless of what kind of thing they are, expose no health signal,
and every number on the page is unformatted (`1398`, `$0.001`).

## Goals

1. **Know the real price.** A refreshed-weekly catalog of published rates,
   normalized to USD per million tokens, in D1 where it can be joined.
2. **Price input and output separately.** Output tokens cost 3–5× input at every
   major vendor; a blended rate is not an approximation, it is wrong.
3. **Say what a provider is.** Friendly names, grouped by kind — Cloudflare
   bindings, AI providers, integrations.
4. **Say whether it is working.** Health, latency and uptime per provider,
   derived from the ledger rather than asserted.
5. **Render numbers like numbers.** `$ 100.00`, `1,398`.

## Non-goals

- Not a billing system. These are *estimates* from published list prices; the
  AI Gateway reconciliation already on the page remains the cross-check.
- Not replacing `/admin/system/integration/usage` (0028), which reports usage
  by model and feature. This owns the **price list** and **provider health**.
- No per-token real-time metering from vendor APIs. Weekly published rates are
  accurate enough to catch a 10× surprise, which is the actual risk.

## Success criteria

1. `model_pricing` holds rows for Anthropic, Gemini, OpenAI and Workers AI, with
   `fetched_at` inside the last 7 days.
2. New `gemini_usage_log` rows carry a non-null `estimated_cost_usd` whenever
   the model is in the catalog — and **null, never 0**, when it is not.
3. The provider table renders three groups, friendly names, and a health badge,
   latency and uptime per row.
4. A provider whose doc page fails to fetch keeps its previous prices and shows
   up as a failed run on `/admin/system/agents/failed`.
5. QC green against the branch preview and then production.

## Risks

| Risk | Mitigation |
|---|---|
| A vendor changes its doc layout and the parser silently returns nothing | Zero parsed models is recorded as `status = "error"`, never as an empty successful refresh. Previous prices are retained. |
| Wrong prices land and quietly inflate every cost | `source_url` + `source_note` on every row; the catalog is inspectable at `/api/admin/agents/pricing`. |
| Cost backfill rewrites history | No backfill. Only new rows are priced; existing nulls stay null rather than being retro-fitted with today's rates. |
| Weekly cron competes with the per-minute tick | Separate trigger (`0 9 * * 1`), instrumented as its own agent run. |
