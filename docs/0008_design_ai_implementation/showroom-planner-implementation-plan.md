# Showroom Planner — Phased Build-Out, Gap Intelligence & Deep-Research Portal

> Canonical implementation plan. The live **Build Progress** page
> (`/admin/showroom/progress`) renders this markdown and tracks per-phase status.

## Context

`docs/0001_showroom_planner` specced a full showroom-sourcing suite. Investigation
(`docs/0008_design_ai_implementation/showroom-backend-reconciliation.md`) shows the
showroom backend is largely **built + migrated** (`/api/showroom-stores`, sweep
sessions, scan, research agent), the **deep-research agent + sourcing UI exist**,
but: the **Materials Schedule domain is uncommitted scratch** (untracked files in
another checkout — build it real here), the nav scaffolds describe already-built
work, and a `/sourcing → /research` redirect **buried the working
`SourcingResearchApp`**. The old `ShowroomDashboard` has a gap-analysis idea worth
generalizing into an **AI gap-intelligence engine**.

**Goal:** ship the suite as 9 real D1-wired pages; replace the dashboard's gap
idea with an AI gap engine across Materials/Products/Showrooms; restore + extend
the deep-research UI into a real portal (interactive visualizer + mindmap + RAG
chat); add the close-the-loop research hand-off — incrementally, one phase per
PR, with the user able to watch progress.

## Locked decisions
- Gap **detection** self-contained here (Workers-AI structured output); deep
  **research** via the existing agent. Detection runs **on-demand** per page; gap
  cards show **age in days**.
- Lifecycle: `open → dismiss (never resurface) → research (creates material record
  + triggers deep research) → findings parsed → closed`.
- **Drop** old `ShowroomDashboard`; carry the gap framework into the three pages.

---

## Execution protocol (applies to EVERY phase)

1. **Branch** off latest `main`: `0008-phase-N-<slug>`.
2. **Implement** the phase (backend + frontend + migration via `pnpm run
   db:generate`; never hand-write SQL).
3. **Verify locally:** `pnpm run build` + `tsc --noEmit` on changed files.
4. **Open PR** to `main` (`gh pr create`), titled `feat(0008/phase-N): …`.
5. **Gemini review loop:** set a **5-minute check-in timer**. On wake, fetch review
   comments. If comments exist → fix + patch + push, reset the timer. Repeat until
   Gemini has reviewed and no actionable comments remain.
6. **Merge** the PR → `main` auto-builds + deploys to prod (verify check-runs).
7. **Test deployed endpoints**. For research-bearing phases, run a **real reno
   deep-research prompt** grounded in the 126 Colby project and confirm findings
   persist to D1.
8. **Update the progress page**: tick completed tasks, attach the PR link, mark the
   next phase active. Then proceed.

---

## Phase 0 — Scaffolding, progress tracker, deep-research restore
Branch `0008-phase-0-scaffold`.
- **Restore** the deep-research route to render `SourcingResearchApp` (undo the
  placeholder redirect that buried it).
- **Per-page TASK placeholders:** `PhaseScaffold` shows each not-yet-built page's
  **phase badge + tasks** (schedule, showrooms, products, compare, scan, detail
  viewports).
- **Live progress page** `/admin/showroom/progress` (`PlannerProgressApp`): a
  phase/task checklist with status + PR links, and a tab rendering this plan
  markdown. Nav entry "Build Progress".

## Phase 1 — Materials Schedule (backend + frontend)
Branch `0008-phase-1-materials`.
- **Schema** `schema/materials/`: `material_schedule_items` + `material_required_specs`;
  add nullable `materialId` FK on `showroom_store_products`.
- **API** `routes/materials.ts` mounted `/api/materials`: list/detail/CRUD,
  `PUT /:id/purchased`, specs CRUD + batch, `GET /:id/match`.
- **Frontend** `MaterialsScheduleApp` + `schedule.astro`: room-grouped grid, KPI
  cards, specs editor, "Research this" hand-off.

## Phase 2 — Gap-intelligence engine (keystone)
Branch `0008-phase-2-gap-engine`.
- **Schema** `showroom_gaps` (context, gapKey, status, materialId, sweepSessionId,
  identifiedAt, …).
- **Detection** `POST …/meta/gaps/analyze?context=` via `generateStructuredOutput`;
  upsert by `gapKey`, skipping `dismissed|closed`.
- **Act:** `GET …/meta/gaps`, `POST …/meta/gaps/dismiss`, `POST …/meta/gaps/research`
  (creates material rows + triggers a sweep; close on completion).
- **Shared FE** `GapPanel` (context prop) on Materials/Products/Showrooms.

## Phase 3 — Showrooms directory + Products catalog
Branch `0008-phase-3-directory-catalog`.
- **Showrooms** directory + Bay-Area hub map + GapPanel; `POST …/discover-from-materials`.
- **Products** filterable catalog + GapPanel; `GET …/products` flat list.
- **Retire** `ShowroomDashboard` after both land.

## Phase 4 — Detail viewports
Branch `0008-phase-4-viewports`. Store/product/material `[id]` viewports reusing
existing context endpoints + `FindingsLedger`/`MediaGallery`.

## Phase 5 — Compare
Branch `0008-phase-5-compare`. Compare endpoints over the existing similar-map
tables + side-by-side UI; "Decide" writes status to the material.

## Deep Research engines (two selectable backends)
- **Engine A — Google Gemini Deep Research API** (existing hosted product). Default.
- **Engine B — Self-hosted "Deep Research OSS" on Cloudflare Agents** (new): port
  the multi-agent iterative loop from `zyakita/gemini-deep-research-oss` to run on
  our infra (Agents-SDK DO/Workflow) calling Gemini + Google Search grounding.
  Both engines emit the same outputs (markdown + citations + structured findings).

## Phase 6 — Deep Research portal + Engine A
Branch `0008-phase-6-research-portal`. *Design pass first.* 3-tab portal:
- **Launcher** (typed: showroom/material/product/generic) with engine selector.
- **Tab A — Findings markdown** (R2 → shadcn typography).
- **Tab B — Interactive visualizer** (agent-generated web app, saved to R2, served
  via sandbox) + **mindmap** (mindmapcn).
- **Tab C — Assistant-UI chat** via `AIChatAgent` + `useAgentChat` +
  `useAISDKRuntime`: chat suggestions, generative UI, tools over D1 + Vectorize RAG.

## Phase 7 — Engine B: self-hosted Deep Research on Cloudflare Agents
Branch `0008-phase-7-cf-research-engine`. *Design pass first.* New
`DeepResearchAgent` implementing the **6-agent loop** (QNA → Research Lead →
Report Plan → Research Deep/gap → Researcher → Reporter) with config (tone, depth,
iterations, breadth, model). Reuses the Gemini grounding + parse path so outputs
match Engine A. Selectable as Engine B.

## Phase 8 — Field Scan bulk capture
Branch `0008-phase-8-field-scan`. *Design pass first.* Offline-first per-product
photo-group capture (in-store or at-home) → bulk research → Workers-AI parse →
HITL populate `showroom_store_products`; `POST …/scan/batch-sync`.

---

## Migration discipline
Generate each phase's migration via `pnpm run db:generate`, apply with
`pnpm run migrate:remote`; never hand-write SQL. Per-phase merges to `main`
auto-deploy prod. Other checkouts hold untracked, divergent `0046`s — ignore them.

## Verification (per phase)
`pnpm run build` + filtered `tsc --noEmit`; clean generated migration; post-merge
prod check-runs green; deployed-endpoint smoke test incl. the real reno research
prompt; progress page updated; pages render real D1 data (no mock data).

## Sequencing
Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Pause after each PR for the Gemini loop +
deploy test before the next. Phases 6–8 each open with a brief design pass.
