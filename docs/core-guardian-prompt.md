# Prompt for the `core-guardian` worker

Paste this into your coding agent building `core-guardian`. It carries the full
context of the incident that motivated it and specifies detection + automated
shut-off across the whole account.

---

## Mission

Build **`core-guardian`**, a standalone Cloudflare Worker whose only job is to
stop me from ever getting another surprise Cloudflare bill. It watches billing
and usage across my **entire account** (every Worker, every Durable Object,
every service), detects runaway spend early, alerts me, and — where safe —
takes automated action to stop the bleeding without me having to be awake.

## Why this exists — the incident (real, learn from it)

One of my Workers, `core-remodel`, had a Durable Object bug that cost me
**over $700** before I noticed it on the invoice. Root cause:

- The DO used the Cloudflare Agents SDK and called `this.schedule()` from
  `onStart()`. `this.schedule()` is **append-only and does not dedupe**, and
  `onStart()` fires on **every DO wake, not once**. Pending schedules
  compounded.
- Its internal SQLite table `cf_agents_schedules` grew to ~1,000,000 rows.
  Every alarm full-scanned it.
- Result: **~3 billion DO row reads per hour, ~67 billion/day, ~$50/day**,
  climbing, for days — invisible until the bill.

Key lessons that must shape `core-guardian`'s design:

1. **The signal was in the analytics API the whole time.** Per-namespace DO
   `rowsRead` showed the runaway hours before any human would look. Guardian
   must poll usage continuously, not wait for billing to post.
2. **Billing is a lagging, daily-bucketed indicator.** A fix deployed midday
   still shows the morning's runaway on that day's total. Guardian must reason
   in **hourly** (or finer) granularity and compare rate-of-change, not just
   daily totals.
3. **Thresholds should trip at ~1000x-normal but still-cheap levels.** A
   healthy DO namespace here reads thousands of rows/day. 1B/day is 1000x
   normal yet only ~$1 — trip there, long before it's real money.
4. **Detection without action still cost me money for days.** Guardian must be
   able to *act*, not just notify.

## What Guardian must detect

Cover the whole account, not one Worker. At minimum:

- **Durable Objects**: per-namespace `rowsRead`, `rowsWritten`, `cpuTime`,
  `activeTime`, request count, error rate. Flag any namespace whose rows-read
  rate is anomalous vs its own recent baseline OR over an absolute ceiling.
  Specifically detect the `cf_agents_schedules` runaway shape (huge rowsRead
  with modest rowsWritten and steady alarm invocations).
- **Workers**: per-script requests, CPU time, subrequests, errors. Flag sudden
  sustained spikes and error storms (which often mean retry loops = spend).
- **Other metered products** as available via the API: Workers AI neurons, AI
  Gateway requests, R2 ops/egress, KV reads/writes, D1 rows read/written,
  Queues, Vectorize, Browser Rendering, Images. Anything with a per-unit price.
- **Account-level billing**: pull the billing/usage endpoints to track
  month-to-date cost and per-service cost, and alert on a daily-spend
  derivative (today's run-rate vs the trailing 7-day median).

## Data sources (use the real APIs)

- **GraphQL Analytics API** (`POST https://api.cloudflare.com/client/v4/graphql`):
  - `durableObjectsPeriodicGroups` — `rowsRead`, `rowsWritten`, `cpuTime`,
    `activeTime`, grouped by `namespaceId`, filterable by `date` or
    `datetimeHour`. **This is the primary DO runaway detector.**
  - `durableObjectsInvocationsAdaptiveGroups` — `requests`, `errors` per
    namespace.
  - `workersInvocationsAdaptive` — per-script requests, CPU, errors, subrequests.
  - AI Gateway, R2, D1, KV, Queues datasets as needed.
  - Requires an API token with **Account Analytics: Read**.
- **REST API** (`.../client/v4/accounts/{account_id}/...`):
  - `workers/durable_objects/namespaces` — map `namespaceId → {name, class,
    script}` so alerts name the culprit (needs **Workers Scripts: Read**).
  - `workers/scripts` — enumerate all Workers.
  - Billing/usage endpoints for month-to-date cost.
- Token handling: read the token from a Worker **secret** (never hardcode).
  Support a token with least privilege for read, and a **separate, optional,
  higher-privilege token** for the shut-off actions below (so read-only
  deployments can't mutate anything).

## What Guardian must DO (automated shut-off / mitigation)

Escalating, each gated by a config flag so I choose how aggressive it is:

1. **Alert (always on):** push a notification the moment a threshold trips —
   with namespace/script name, the metric, the rate, the estimated $/day, and a
   deep link. Channels: whatever I configure (email, webhook, Slack, a status
   page). Re-alert on escalation, not every poll (dedupe/cooldown).
2. **Self-heal via the owning app (preferred, safe):** if the runaway resource
   exposes a remediation RPC, call it. `core-remodel`'s Agent DOs expose
   `scheduleGuard(maxRows)` which purges the runaway `cf_agents_schedules`
   table. Guardian should support a registry mapping
   `class → { how to reach it, remediation call }` and invoke it.
3. **Throttle / disable the trigger:** for a runaway driven by a cron or a
   Workflow, disable that trigger via the API (e.g. remove/disable the
   schedule) to stop the loop without killing the whole Worker.
4. **Kill switch (most aggressive, explicit opt-in per Worker):** disable the
   offending Worker (e.g. via `wrangler`/API script disable or by flipping a
   route) to hard-stop spend. Only for Workers I've marked as safe to auto-
   disable. Always alert loudly when this fires, and make re-enable one command.
5. **Never** take a destructive action against data (no dropping tables, no
   deleting namespaces). Mitigation targets *execution and scheduling*, never
   stored data. Purging a runaway scheduler table is fine **only** through the
   app's own vetted RPC.

## Architecture

- Cloudflare Worker with a **Cron Trigger**. Two cadences: a fast poll
  (every 1–5 min) for the cheap DO/Worker rate checks, and an hourly deeper
  sweep (full account, all products, billing run-rate).
- Persist a rolling baseline + alert state in **D1** (or a DO): last-seen
  per-namespace rates, active incidents, cooldowns, what action was taken. You
  need history to compute "vs baseline" and to dedupe alerts.
- A tiny **status UI / API** (`/health`, `/incidents`) so I can see current
  state and manually trigger or clear a mitigation.
- **Config-driven**: thresholds, which resources are auto-remediable, which are
  kill-switch-eligible, alert channels — all in config/D1, not hardcoded.
- Fail safe and loud: if Guardian itself can't reach the API (bad token, 401),
  it must record and alert that it is **blind**, because a silent guardian is
  the same as no guardian.

## Acceptance criteria

- Replaying the `core-remodel` incident (a namespace reading tens of billions
  of rows/day) trips within one poll, names the namespace + class, estimates
  the $/day, and — for a resource with a registered remediation — fires it and
  confirms the rate drops on the next poll.
- Month-to-date spend and per-service run-rate are queryable at any time.
- No false kill-switch on normal load; thresholds are baseline-relative with an
  absolute ceiling.
- Every automated action is logged with before/after metrics and is reversible.
- Guardian alerts if its own credentials or API access break.

## Reference implementation to mirror

My `core-remodel` repo already has the small version of this you're scaling up:

- `scripts/do_billing_watch.py` — the daily/hourly DO billing report + GraphQL
  query shapes.
- `scripts/doBugCheck.mjs` — the static + billing pre-deploy gate.
- `src/backend/services/billing-guard/check.ts` — the in-app hourly guard that
  queries analytics, alerts via `health_checks`, and auto-remediates via
  `scheduleGuard()`.

Guardian is the account-wide, multi-product, action-taking generalization of
these three. Start by porting the GraphQL DO query and the threshold logic,
prove the alert path end-to-end, then add products and the escalating actions.
