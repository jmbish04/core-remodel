# Showroom Scout

Discovers, vets, scores and routes remodel showrooms for a day of in-person
sourcing. Reasons in California time, excludes big-box and already-registered
showrooms by default, and replans live while the user is driving.

## Architecture

Two agent runtimes, split by what each is actually good at:

| Runtime | Owns |
|---|---|
| **Cloudflare Agents SDK** (`ShowroomScout extends Agent<Env, ScoutState>`) | identity, session state, streaming transport, resumability, route persistence |
| **OpenAI Agents SDK** (`run()` inside `execute()`) | goal interpretation, planning, tool orchestration, scoring, route adaptation |

The model underneath the OpenAI loop is swappable via the `aisdk()` bridge —
Gemini or Workers AI, selected by env var. No OpenAI key or spend is required.

```
POST /api/showroom-scout/:session/start   →  DO RPC startScout()
POST /api/showroom-scout/:session/update  →  DO RPC sendUpdate()   (live replan)
GET  /api/showroom-scout/:session         →  DO RPC getScoutState()
WS   /agents/showroom-scout/:session      →  broadcast state (progress + results)
```

`setState` broadcasts to every connected client, so progressive status, tool
progress and the final route stream for free, and a phone that loses signal in
a parking garage resumes with full context.

## Tools

The agent does **not** get a bespoke tool system. `mcp-bridge.ts` adapts the
existing MCP registry (`src/backend/mcp/`) into Agents SDK tools and calls the
same handlers **in-process** — no HTTP, no MCP round-trip, no duplicated logic.
A tool registered once serves both the claude.ai connector and this agent.

Allow-listed (see `SCOUT_TOOL_ALLOWLIST`): `search_showrooms`,
`import_showroom_from_place`, `find_known_showrooms`, `list_showrooms`,
`get_showroom`, `plan_drive_route`, `create_drive_list`,
`analyze_drive_coverage` — plus two locals: `web_search` and
`publish_scout_result`.

Added to the registry by this feature (available to the connector too):
- `find_known_showrooms` — batch directory dedupe
- `plan_drive_route` — traffic-aware, hours-constrained sequencing

## Four constraints that are load-bearing

Change these only with the reasoning, not just the code.

### 1. Grounded search is a separate call, not a grounded loop

Google supports combining built-in Google Search grounding with custom function
declarations **only on Gemini 3**. On Gemini 2.5 the request does not cleanly
fail — it silently misbehaves, commonly emitting a fabricated `functionCall`
instead of searching. The scout loop is function-tool-heavy, so grounding it
directly would produce confident, unsourced, invented showrooms on exactly the
models most likely to be configured.

So: the loop runs function tools with **no** grounding, and `tools/web-search.ts`
makes a **grounding-only** request with no function declarations. Correct on
both model generations.

Also never use `useSearchGrounding: true` — that provider option *replaces* the
tools object outright and your function tools silently disappear.

### 2. `@ai-sdk/google` must stay on v3

`@openai/agents-extensions` peer-declares `@ai-sdk/provider ^2 || ^3`, and
`ai@6` ships v3. `@ai-sdk/google@4` jumped to `@ai-sdk/provider@4` and is
incompatible with the `aisdk()` bridge. `pnpm-workspace.yaml` pins the override
and `@ai-sdk/provider@3.0.14` is a direct devDependency — without it pnpm
auto-installs a phantom v4 to satisfy the unmet peer and hands it to the adapter.

### 3. Non-strict tools are unvalidated — the bridge validates

The Agents SDK accepts Zod parameters only when `strict: true`, and strict JSON
schema forbids `.optional()`, which the registry uses throughout. So bridged
tools run non-strict with a converted JSON Schema — and the SDK explicitly does
**not** validate input against it. `mcp-bridge.ts` re-validates with each tool's
own Zod shape before the handler runs, because model output reaching a D1 write
is a trust boundary.

### 4. Timing arithmetic belongs in code, not the model

The agent supplies judgment (`priority`, `dwellMinutes`); `plan_drive_route` and
`services/drive-route-planner.ts` own ETAs, traffic and hours feasibility.
Models get this subtly wrong and a 12-minute error means a locked door.
`scripts/tests/test_route_planner.mjs` covers it — `pnpm run test:route-planner`.

## Config

```jsonc
"SHOWROOM_SCOUT_PROVIDER": "gemini",        // | "workers-ai"
"SHOWROOM_SCOUT_MODEL": "gemini-2.5-flash",
"SHOWROOM_SCOUT_SEARCH_MODEL": "gemini-2.5-flash"  // must support grounding
```

Requires the existing `GEMINI_API_KEY` and `GOOGLE_MAPS_API` secrets. Search
spend lands in `gemini_usage_log`; Maps spend in `google_maps_usage_log`.

## Tuned against live runs

Six live runs against real Gemini. Every item below is a defect that actually
happened, not a precaution. `pnpm run test:scout-smoke` reproduces the harness
(costs real Gemini quota; not in CI).

| Symptom observed | Cause | Fix |
|---|---|---|
| Agent planned a route for "7:12 AM" nobody asked for | `resolveWindow` returned an **inverted window** (start 7:20 PM, end 12:00 PM) when "saturday morning" was asked on Saturday evening. The model silently invented a plausible time instead of reporting nonsense. | Invariant `start < end` enforced; passed windows roll to the next occurrence with `rolledForward: true`. Regression test sweeps every phrase × 7 days × 6 hours. |
| Whole run died on a transient Gemini `503` | Agents SDK retries are **opt-in** and inert without a `policy`. ~15 paid searches discarded. | `retry.ts` — retries 5xx/429/network with jittered backoff, never retries 4xx or aborts. |
| Model emitted tool name `PublishScoutResultCandidatesHours` | Publish schema too large/deep for `gemini-2.5-flash`, plus `.default()` which strict JSON schema forbids. | Split into `publish_candidate` (singular) / `publish_run_summary` / `publish_route`; all `.default()` removed; long tail moved to optional `extras`. |
| 27 searches, 472s, incl. `"<name> address latitude longitude placeId"` | Every schema field was required, so the model went hunting for each one. **A required field is an instruction to go find it.** | Trimmed core schema, explicit search budget, "never search to fill a schema field". Now ~12–14 searches / ~240s. |
| Ended turn saying "I will now vet and score these" | Model treated the turn as resumable. Nothing runs after it stops. | "How to end a turn" section + an explicit pre-reply checklist. |
| Planned a route, described it in prose, never published it | Checklist named `publish_candidates` only, so the literal check passed. | `plan_drive_route` and `publish_route` declared a PAIR; checklist covers each publish tool. |
| Excluded a showroom as "Known in directory" that the dedupe tool never returned | Fabricated exclusion reason. | Exclusion reasons must match tool output; only claim "already in directory" on `known: true`. |
| Prose restated every published field, crowding out remaining tool calls | No length guidance. | Reply capped ~150–250 words; the app renders the detail. |
| Routed a showroom to 8:24 AM that it had itself published as **closed Saturdays** | `plan_drive_route` only knows the hours it is handed. | `publish_route` cross-checks every stop against the hours on its own published candidate and rejects the route. |
| A candidate lost to "a technical error with the `showroomStoreId` field" | Model asked to hand-carry an internal DB id. | Field removed from the model-facing schema; `knownInDirectory` is what the rule needs. |
| `detours: 0` on every run | The model was asked to *invent* detours with no idea what was near the path. | Planner computes cheapest-insertion cost for unrouted stops; `publish_route` rejects a route ignoring a cheap, open option. |
| Budget drifted to 27–30 searches, then published nothing | A prose budget is a request, not a limit. | Enforced in `web_search` (12, env-configurable); past the cap it refuses and tells the model to publish. Results also carry a standing publish reminder — the system-prompt rule faded by the time it mattered. |

**The pattern worth remembering:** every durable fix moved a guarantee from the
prompt into code. Instruction tuning traded one failure for another; enforcement
in the tool layer held. Reach for a guardrail before another paragraph.

Verified working end to end: per-showroom publish, honest exclusions, real
traffic-aware ETAs from the live Routes API, opening statements, call-aheads,
and a McDonald's food stop inserted on-route.

## Known gaps

- **Other agent namespaces are unauthenticated.** `routeAgentRequest` runs ahead
  of every auth gate in `_worker.ts`. This feature gates `/agents/showroom-scout`
  specifically; the other `/agents/*` namespaces predate it and remain open.
  Worth closing separately.
- **Tracing is disabled.** OpenAI's exporter needs an OpenAI key we do not have,
  and `AsyncLocalStorage` is only partially supported on Workers so traces would
  be inaccurate anyway. The `timeline` in agent state is the trace.
- **Never run inside the Worker.** All live runs used the Node harness. The DO
  wrapper, `routeAgentRequest` auth gate and D1-backed tools
  (`find_known_showrooms` against the real directory, Maps usage logging) are
  type- and bundle-verified only. Deploying this branch would advance the
  production DO migration tag (v15) and block `main` — merge, then deploy.
- **Detour publishing: guardrail proven, model response not yet observed live.**
  The computation, the offerable filter and the missed-detour detection are all
  unit-tested (including the exact live failure: planner offers +0 min, route
  publishes none → flagged). What has NOT been seen in a live run is the model
  *receiving* that rejection and adding the detour on a retry. Live runs so far
  either had only expensive options (+19/+51/+684 min) or cheap ones that were
  closed on arrival (+3/+5 min opening at 10:00) — in every case `detours: []`
  was the correct answer and the guardrail correctly stayed silent. Confirming
  the retry path needs a run with a cheap option that is genuinely open.
- **`publish_route` is skipped on roughly a third of runs.** Candidates publish
  reliably; the route sometimes gets described in prose instead. The paired-call
  instruction and the end-of-turn checklist improved it but did not eliminate it.
  The likely next move is the same one that worked everywhere else: stop asking,
  and have the runtime publish the route from the `plan_drive_route` result
  directly rather than waiting for the model to relay it.
- **`gemini-2.5-flash` is the weak link** for structured output. If publish
  reliability regresses, try a stronger model before enlarging any schema.
- **No frontend.** v1 is headless by design.
