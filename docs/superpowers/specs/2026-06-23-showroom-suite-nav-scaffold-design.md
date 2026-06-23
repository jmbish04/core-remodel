# Showroom Suite — Nav Cleanup + Page Scaffolds

**Date:** 2026-06-23
**Status:** Approved (slice 1 of the Showroom Suite work)
**Branch:** `claude/kind-blackburn-3aabcf`

## Context

The "Claude AI design portfolio" at
`docs/0008_design_ai_implementation/core-remodel-showrooms/Showroom Suite.dc.html`
is a single monolithic Design-Component export (~666KB, all mock data, custom DC
runtime) containing 8 screens. The goal is to install those screens as
individual pages in the main Astro frontend nav, and to clean up the existing
shopping-related nav.

This spec covers **only the first slice**: nav cleanup + scaffolding each new
page with a build-plan card. Wiring each page to D1 / agents is later work,
tracked by the phase numbers below. A parallel session (`core-remodel-0007-fe`)
is also touching the frontend, so edits to shared files (`AppSidebar.tsx`) are
kept surgical.

## 1. Nav cleanup (`src/frontend/components/AppSidebar.tsx`)

- Section header `Shopping Research` → **`Admin - Shopping`**.
- **Shopping Journal** moved out of `Admin - Tools` into `Admin - Shopping`.
- **Sourcing Research** reframed as **Deep Research** (the typed
  showroom/material/product research surface). The old route
  `/admin/showroom/sourcing` becomes a 301 redirect to
  `/admin/showroom/research`; the legacy `SourcingResearchApp` component file is
  retained for reference.

Final `Admin - Shopping` order: Showroom Dashboard *(existing)* · Materials
Schedule · Showrooms · Products · Deep Research · Compare · Field Scan ·
Shopping Journal *(moved)* · Closet Research *(existing — the pattern)*.

## 2. Pages (mapped from the 8 Showroom Suite screens)

Six become top-level nav items; the three detail viewports are dynamic
sub-routes reached from their list pages.

| Page | Route | In nav | Phase |
|---|---|:---:|:---:|
| Materials Schedule | `/admin/showroom/schedule` | ✅ | 1 |
| Showrooms (bulk discovery) | `/admin/showroom/showrooms` | ✅ | 1 |
| Products (catalog) | `/admin/showroom/products` | ✅ | 2 |
| Deep Research (typed) | `/admin/showroom/research` | ✅ | 2 |
| Compare | `/admin/showroom/compare` | ✅ | 3 |
| Field Scan | `/admin/showroom/scan` | ✅ | 3 |
| Material detail | `/admin/showroom/material/[id]` | ➖ | 4 |
| Showroom detail | `/admin/showroom/store/[id]` | ➖ | 4 |
| Product detail | `/admin/showroom/product/[id]` | ➖ | 4 |

### Phasing rationale

- **Phase 1** — the materials list + showroom discovery (the seed everything
  feeds from).
- **Phase 2** — product catalog + the Gemini→agent→portal Deep Research engine.
- **Phase 3** — decision support (Compare) + field capture (Scan).
- **Phase 4** — the three detail viewports.

## 3. Scaffold contract

Each new page renders one reusable component,
`src/frontend/components/showroom/PhaseScaffold.tsx`, inside `BaseLayout`. The
component shows a shadcn `Card` with:

- a **Phase N** badge + "Not yet built" badge + source-screen badge,
- the page title and a one/two-line purpose statement,
- a numbered **implementation steps** checklist.

No mock data — the card is purely the build plan, so each route exists in nav
and tells whoever opens it exactly what remains.

## Product direction captured for later phases

Research is **typed**, not generic "sourcing":

- **Showroom research** — bulk-discover showrooms to visit from the materials
  list → upsert D1 showroom records (reviews, deals, day-trip routing).
- **Material research** — e.g. "fridge" → specs / budget → find deals,
  showrooms.
- **Product research** — deep dive on a specific product: reviews, sales,
  gotchas (e.g. Invisacook ✗ natural stone), lead times, alternatives,
  showrooms.

The Deep Research page turns Gemini deep-research findings (via the agent) into
a review portal modeled on **Closet Research**
(`src/frontend/components/showroom/ClosetResearchApp.tsx`): a markdown→shadcn
typography tab, a generated mini-web-app tab, and an assistant-ui RAG chat
modal.

## Out of scope (this slice)

D1 schemas, API routes, agent wiring, real data, the assistant-ui chat modal,
and extracting any actual UI out of the DC monolith. Those are Phases 1–4.
