# PRD — Deep-Research Plan-Review Gates (a)–(c)

Status: **spec / not yet built**
Owner: 0007 deep-research sourcing
Closes platform-docs gap items **(a)** Gemini returns a reviewable plan, **(b)** onboard agent annotates the plan, **(c)** iterative HITL plan approval.

---

## 1. Goal

Insert a human-in-the-loop **plan-review stage** before any deep-research run executes. A research request should produce a **plan** the homeowner reviews — augmented with an **onboard agent's annotations** — and only an **approved** plan triggers the expensive sweep. The homeowner can request changes and iterate before approving.

This applies to both deep-research pipelines:

- **Admin Research** — `ResearchAgent` + `research_sessions` (`/api/admin/research`, `/admin/research/:id`).
- **Showroom Sourcing sweeps** — `ShowroomResearchAgent` deep-sweep (`/admin/showroom/sourcing`).

---

## 2. Current state (as-built, grounded)

- **Gemini plumbing is ready but unused.** `createDeepResearchInteraction` already accepts `collaborativePlanning` and `previousInteractionId` (`src/backend/services/gemini/deep-research.ts:47–48,129,138–140`). **No caller sets either.** Deep research runs straight through; `output_text` is treated as the final report.
- **Admin `ResearchAgent`** is an `AIChatAgent` DO. `startResearch` is dispatched **fire-and-forget** (`research.ts:70`, `index.ts:287` `waitUntil(monitorResearchStream)`). `research_sessions.researchPlan` exists but is a **write-once input**, never used as an approval gate. `status` enum: `pending|researching|embedding|generating|complete|failed` — **no plan-review state**.
- **Showroom sweeps** run **synchronously inside one HTTP request** (routes `await agent.deepSweepProduct(...)`, blocking up to `deepResearchWaitMs` ≤ 240s). The discovered plan (`reportMarkdown`) is **truncated to 1200 chars and discarded into `researchIntent`** (`deep-sweep.ts:283`). There is **no sweep-session table** to hold a pending plan across two round-trips.
- **Frontend** status is HTTP-polled (`ResearchDetailApp` 3s poll; `SourcingResearchApp`/`PromptStagingCard` await the full sweep synchronously). The `useAgent` WebSocket is used only for RAG chat, not status.
- **Agent→agent RPC** via `getAgentByName` is the established pattern (`showroom-sourcing-monitor.ts:120–142`), reusable for the annotation agent.

---

## 3. Scope & non-goals

**In scope:** the three gates (a/b/c) for both pipelines; persistence of plans + annotations + review state; iterate-until-approved loop; frontend plan-review panels; drizzle migration; deploy.

**Non-goals:** changing the extraction/scrape/embed stages (unchanged after approval); the per-fact/per-image HITL (already shipped in PR #24); rewriting the Gemini service (only callers change).

---

## 4. Key architecture decision — how the plan is produced

Two viable approaches. **Recommendation: "plan-first" (Option B) as the primary mechanism, with collaborative_planning as an optional native enhancement on the admin pipeline.**

### Option A — Gemini native `collaborative_planning: true`
Flip the flag; Gemini's deep-research agent emits a plan and pauses for approval; we chain approval/feedback via `previous_interaction_id`.
- ➕ Truest to "Gemini spits back a plan"; no extra model call.
- ➖ Preview API (`deep-research-preview-04-2026`, revision `2026-05-20`); the exact representation of the paused "awaiting plan" state and the approval-continuation contract are **unverified** and must be validated against live API behavior. Interactions are background/long (8-min default wait). Harder to make deterministic.

### Option B — explicit "plan-first" with a fast model (recommended)
Generate a **structured plan** with a cheap/fast model (`gemini-2.5-flash` via AI Gateway, JSON output — already used for citation planning in `deep-sweep.ts:291–309`) **before** any deep run. Review/annotate/approve that plan, then feed the **approved plan text** as the prompt to the existing deep-research run.
- ➕ Deterministic, fast (seconds, not minutes), cheap, fully controllable JSON shape (steps, sources-to-target, scope, risks). No dependence on preview collaborative_planning semantics. Works identically for both pipelines.
- ➖ The plan is "our" Gemini plan, not the deep-research agent's internal plan (acceptable — the user's requirement is "Gemini returns a plan I review," which this satisfies).

**Decision needed (D1):** confirm Option B (recommended) vs A. The spec below assumes **B**, and is structured so collaborative_planning can be layered on later for admin research without reworking the data model.

---

## 5. The onboard annotation agent — gate (b)

After the plan is generated, an **onboard agent reviews it and appends notes** before the homeowner sees it.

**Recommendation:** implement annotation as a **`reviewPlan` capability on the existing agents** (a method on `ResearchAgent` / `ShowroomResearchAgent`, backed by a shared `annotatePlan()` service using Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via AI Gateway). It produces structured notes: scope concerns, missing angles, redundancy with prior findings, and **negative-constraint reminders pulled from existing rejections** (homeowner ratings ≤ 1 and rejected findings — reuse `prompt-context.ts` constraint builders).

**Alternative (heavier):** a dedicated `PlanCriticAgent` Durable Object with a `@callable reviewPlan`, invoked via `getAgentByName<Env, PlanCriticAgent>(env.PLAN_CRITIC_AGENT, …)`. Requires a new DO binding + `wrangler types`. Use only if we want the critic to hold its own state/history.

**Decision needed (D2):** method/service (recommended) vs dedicated `PlanCriticAgent` DO.

Annotations are stored as JSON (`planAnnotations`) so the frontend can render them as a structured checklist next to the plan.

---

## 6. Data model

Generated via `pnpm run db:generate` (no hand-edited SQL). Pure additive.

### 6.1 Admin research (`research_sessions`) — add columns
- `planStatus` text enum `none|drafting|annotating|awaiting_approval|approved|revising` default `none`
- `planAnnotations` text (JSON: array of `{kind, note}`)
- `planInteractionId` text (nullable — only if Option A is layered on later)
- `planRevision` integer default `0`
- `planApprovedAt` integer timestamp (nullable)
- extend `status` enum with `awaiting_plan_approval` (a paused state distinct from `researching`)

A child table **`research_plan_revisions`** (`id, sessionId FK, revision, planMarkdown, planAnnotations, homeownerFeedback, createdAt`) records each iteration of (c).

### 6.2 Showroom sweeps — NEW table `sourcing_sweep_sessions`
The hardest gap: showroom sweeps have no session. Add (file `src/backend/db/schema/showroom/sweep_sessions.ts`, re-exported from the showroom index):
```
id INTEGER PK
targetType TEXT  -- product|store|category
targetId INTEGER
prompt TEXT
researchMode TEXT  -- quick|deep
maxSources INTEGER
enableMcpBridge INTEGER(bool)
planMarkdown TEXT
planAnnotations TEXT  -- JSON
planStatus TEXT  -- drafting|annotating|awaiting_approval|approved|revising
planRevision INTEGER default 0
status TEXT  -- pending|planning|awaiting_plan_approval|sweeping|complete|failed
resultJson TEXT  -- sweepResult counts after run
errorMessage TEXT
createdAt INTEGER ts
approvedAt INTEGER ts (nullable)
completedAt INTEGER ts (nullable)
```
(A sibling `sourcing_plan_revisions` child table mirrors `research_plan_revisions` for iteration history.)

---

## 7. State machine (per session)

```
pending
  -> planning            (Gemini drafts the plan)
  -> annotating          (onboard agent appends notes)
  -> awaiting_plan_approval
       -- homeowner Approve --> running (sweeping/researching) -> ... -> complete
       -- homeowner Request changes (with feedback) --> revising -> planning   (loop, planRevision++)
failed (from any phase on error)
```
For Option B the `planning`+`annotating` phases are seconds; for admin they run in `waitUntil` background and the page polls. Showroom sweep routes become **async** (return a `sessionId` immediately, frontend polls) — a notable change from today's synchronous response.

---

## 8. API contract

### Admin research (`/api/admin/research`)
- `POST /` — **modified**: when plan-review is on, create session, kick the **plan phase** (background), return `202 { sessionId, status: "planning" }`. (A `?skipPlan=true` or `mode` escape hatch preserves the old straight-through behavior.)
- `GET /:id` — now also returns `planStatus`, `planMarkdown` (from latest revision), `planAnnotations`.
- `POST /:id/approve-plan` — approve current plan → transitions to `researching`, dispatches `monitorResearchStream`. Returns `202`.
- `POST /:id/request-changes` — body `{ feedback }` → `revising`, re-drafts plan (planRevision++), re-annotates, back to `awaiting_plan_approval`.

### Showroom sweeps (`/api/showroom-stores`)
- `POST /products/:productId/research/plan` (and `/:id/research/plan`, `/meta/categories/:categoryId/research/plan`) — discover + annotate plan; create a `sourcing_sweep_sessions` row; return `{ sessionId, planMarkdown, planAnnotations, planStatus }`. **Replaces the deep path of deep-sweep**; quick mode may still go straight through.
- `GET /research/sweep-sessions/:sid` — poll session (plan + status + result).
- `POST /research/sweep-sessions/:sid/approve-plan` — run the approved plan (the existing extraction loop); persist counts to `resultJson`; status `complete`. Runs in background (`waitUntil`) so the route returns immediately.
- `POST /research/sweep-sessions/:sid/request-changes` — body `{ feedback }` → re-plan loop.

All new endpoints documented in `/openapi.json` with unique `operationId`s; gated by existing `requireAccessAuth`.

---

## 9. Agent changes

### ResearchAgent
- Split `startResearch` → `draftPlan(input)` (collaborative or plan-first) that captures the plan, calls `reviewPlan`, persists, sets `awaiting_plan_approval`, **stops** (no `monitorResearchStream`).
- New `@callable approvePlan(sessionId, { feedback? })` and `revisePlan(sessionId, { feedback })`.
- `onConnect` auto-resume (`index.ts:193–201`) must **exclude** `awaiting_plan_approval` so a paused session is not resumed into the run phase.

### ShowroomResearchAgent
- New `@callable discoverPlan(input)` — does the deep-research/plan-first plan step, **persists the full plan** to `sourcing_sweep_sessions` (no more 1200-char truncation), calls `reviewPlan`, returns the session.
- New `@callable runApprovedPlan(sessionId)` — the existing `discoverCitationPlan` → extraction loop, now reading the approved plan from the session. `deepSweepProduct/Store/Category` are refactored to (discoverPlan ➜ [gate] ➜ runApprovedPlan); quick mode can bypass the gate.

### Shared
- `annotatePlan(env, { planMarkdown, target, priorRejections })` service (Workers AI via AI Gateway) returning structured annotations; reuses `prompt-context.ts` negative-constraint builders.

---

## 10. Frontend

- **Admin `ResearchDetailApp`** — add a `PlanReviewPanel` rendered when `status === "awaiting_plan_approval"`: plan markdown (ReactMarkdown, already imported) + agent annotations checklist + **Approve** / **Request changes** (textarea → `request-changes`). The existing 3s poll surfaces transitions. New `STATUS_CONFIG`/`StatusBadge` entry.
- **`ResearchLibraryApp`** — new badge state for awaiting-approval; `handleCreate` starts in plan mode.
- **Sourcing console** — `PromptStagingCard` deep-mode "Launch sweep" becomes "Draft plan" → renders a `SweepPlanReview` interstitial (plan + annotations + Approve/Request-changes) between staging and the `FindingsLedger`/`MediaGallery`. The quick/deep toggle decides whether the plan gate applies. Because the run becomes async, the console polls `GET /research/sweep-sessions/:sid` for completion instead of awaiting the sweep.
- Dark Monolith conventions; shadcn on @base-ui/react; sonner toasts; no `window.confirm`.

---

## 11. Migration & deploy
- One drizzle migration (`pnpm run db:generate`) for the new columns + 2 new tables (+ 2 child tables). Additive; existing rows default to `planStatus: none` / `status: pending`. No DO migration / wrangler change unless D2 chooses the dedicated `PlanCriticAgent` DO (then: new binding + `wrangler types` + migration vN+1 — note this is the **only** path that touches the DO migration tag, currently v10).
- Applied on deploy via the existing `pnpm run migrate:remote` (idempotent `d1-migrate.mjs`).

---

## 12. Phasing (recommended)

**Phase 1 — Admin Research plan-review.** It already has a session table, an async (`waitUntil`) agent, and a detail page. Lowest friction; validates the whole loop (a/b/c) end-to-end.

**Phase 2 — Showroom sweep plan-review.** Adds `sourcing_sweep_sessions`, converts the synchronous sweep routes to async discover→approve→run, and adds the console interstitial. Higher friction (new table + async conversion + polling).

Phase 1 ships independently and de-risks Phase 2.

---

## 12a. Locked decisions (confirmed)

- **D1 = A — Gemini `collaborative_planning`.** Use the native paused-plan flow; chain approval/feedback via `previous_interaction_id`. The paused-state representation + approval-continuation contract are isolated behind small adapter functions (`extractPlanFromInteraction`, `continueInteractionWithApproval`) and must be smoke-tested against the live preview API before merge.
- **D2 = method/service.** `annotatePlan()` shared service (Workers AI llama-3.3-70b via AI Gateway) exposed as `reviewPlan` on the existing agents. No new DO binding; DO migration tag stays **v10**.
- **D3 = admin-first.** Phase 1 = Admin Research plan-review; Phase 2 = showroom sweeps.

## 13. Risks & open decisions

- **D1 — plan source:** Option B plan-first (recommended) vs A collaborative_planning. Drives whether we depend on unverified preview-API semantics.
- **D2 — annotation agent:** method/service (recommended) vs dedicated `PlanCriticAgent` DO (touches wrangler/v-tag).
- **D3 — phasing:** admin-first (recommended) vs both at once.
- **Async conversion (Phase 2)** changes the showroom sweep API from synchronous to poll-based — a real contract change for the console (mitigated by the new session + poll).
- **collaborative_planning validation** (only if D1=A): the paused-state representation and approval-continuation must be confirmed against the live preview API before relying on it.

---

## 14. Acceptance criteria

- A deep-research request (admin and showroom) pauses at `awaiting_plan_approval` with a stored plan + agent annotations; nothing scrapes/embeds before approval.
- Homeowner can Approve (→ run) or Request changes (→ re-planned, iterates, `planRevision` increments) any number of times.
- Approved plan text is what drives the actual run.
- Rejected/feedback context feeds the re-plan (reuses existing negative-constraint builders).
- New endpoints in `/openapi.json` with unique operationIds; `requireAccessAuth` enforced.
- `pnpm run db:generate` clean after the migration; build + `tsc` (no new errors) + oxlint green.
- No DO migration-tag change (unless D2 = dedicated DO).
