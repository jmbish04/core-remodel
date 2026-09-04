# Production is running code from before four merged PRs — deploy it after the startup-CPU fix?

- **Date raised:** 2026-09-04
- **Raised by:** fix-cpu-load-time session (orca/fix-cpu-load-time)
- **Status:** decided

## What happened

The live worker at `core-remodel.hacolby.workers.dev` last deployed on
**2026-09-03 at 15:42 UTC** (08:42 Pacific). Four pull requests merged to `main`
**after** that, between 10:52 and 11:33 Pacific:

| PR | What it was |
| --- | --- |
| #412 | Budget & Procurement Command Center |
| #413 | MCP connector — tool list restored, API-key auth, Code Mode on `/mcp` |
| #414 | Follow-up fixes to #412 |
| #415 | shadcn `@reui` registry in `components.json` |

None of them are live. This is almost certainly a *consequence* of the bug just
fixed: deploys started failing validation with `Script startup exceeded CPU time
limit [code: 10021]` right around then, so nothing has shipped since.

It was found while checking whether this branch broke anything. Two QC scripts
disagreed between the preview and production, and both differences traced to
production serving older code, not to the change under test:

- `GET /api/budget/grid` returns 200 on production and 400 on any current-`main`
  build, because #412 made three query parameters required.
- `GET /mcp/sse` with the admin cookie returns 401 on production and opens a real
  event stream on any current-`main` build, because #413 is what made that cookie
  a valid credential there.

Both were reproduced on a scratch deployment of clean `origin/main` with none of
this branch's changes, so the branch is exonerated either way.

## Why it matters

The Budget & Procurement Command Center and the MCP connector fixes are finished,
reviewed and merged, and nobody can use them. The MCP one in particular means
Claude's tool list on the live connector is still the broken pre-#413 surface.

It also makes production an unreliable yardstick: any QC script that compares a
branch against production is now measuring four PRs of drift as well as the
branch, which is exactly the confusion this cost an hour to unpick today.

## The question

Once #416 (the startup-CPU fix) merges, should I deploy `main` to production —
which ships #412, #413, #414 and #415 along with it?

## Options

1. **Merge #416, then deploy `main`.** *(recommended — those four PRs are merged
   and reviewed; the only reason they are not live is a bug that is now fixed,
   and leaving production four PRs behind makes every future comparison harder.)*
   Run `gh workflow run "Deploy (manual)" --ref main -f confirm=deploy -f
   run_migrations=true`, then verify against the deployed URL. #412 carries
   migrations 0184/0185, which are already applied to the remote database, so the
   migration step should be a no-op — but it runs before the code goes live either
   way, which is the safe order.
2. **Merge #416 and deploy only that.** Not actually possible without reverting
   the other four on a branch and deploying that; deploying `main` deploys all of
   it. Listed only to say why it is not on the table.
3. **Merge #416 and leave production where it is.** Someone else deploys when they
   are ready to watch it. Costs nothing now, but the four PRs stay dark and the
   drift keeps distorting QC comparisons.

## Default if no answer

**Option 3** — I will merge #416, delete its preview worker, and leave production
alone. Deploying four other people's PRs is not mine to decide, and the deploy is
one command whenever you want it.

## Decision

**Option 1 — merge, then deploy `main`.** — 2026-09-04

Justin: *"try deploying"*.

Deployed via the `Deploy (manual)` GitHub Action against `main` at `9f1afbbe`,
with `run_migrations=true`. That ships #412 (Budget & Procurement Command
Center), #413 (MCP connector fixes), #414, #415, and the startup-CPU work in
#416/#417/#418 — everything merged since the 2026-09-03 15:42 UTC deploy.

Verified against the DEPLOYED URL, not just the green Action:

| Check | Result |
| --- | --- |
| Cloudflare deployment record | new deployment `f9330fac` at 2026-09-04T09:17:11Z (previous: 2026-09-03T15:42:07Z) |
| Cron triggers still registered | 6 — `* * * * *`, `0 11 * * *`, `0 14 * * *`, `0 9 * * 1`, `15 */4 * * *`, `30 13 * * 1` |
| Startup-CPU work live | `api_route_registry` reports `96 mount prefix(es), 96 dispatched … Every router imported cleanly` — the post-#417 wording |
| #412 live | `GET /api/budget/grid` → 400 bare, 200 with `from`/`to`/`view` |
| #413 live | authenticated `GET /mcp/sse` → 200, stream held open |
| Routing regression guard | `pnpm run test:pr 416` against production — 18 passed, 0 failed |
| Health session | 76 success / 10 degraded / 5 failure — same failure set as before the deploy, all pre-existing data-quality, AI-spend and Tesla-telemetry items; nothing routing- or startup-related |

No 10021. The deploy itself is the first successful production deploy since
2026-09-03 15:42 UTC.
