# BRIEFING — 2026-05-24T18:17:00-07:00

## Mission
Build a complete Bid Portfolio system for core-remodel app across 5 milestones: DB schema, API routes, admin frontend, public viewer, and AI chat agent.

## 🔒 My Identity
- Archetype: teamwork (Project Orchestrator)
- Roles: orchestrator, user_liaison, human_reporter, successor
- Working directory: /Volumes/Projects/workers/core-remodel/.agents/orchestrator_bid_portfolio_1/
- Original parent: main agent (Sentinel)
- Original parent conversation ID: 198cb2cf-f0be-4e42-bf3d-78c316688a24

## 🔒 My Workflow
- **Pattern**: Project Pattern — multi-milestone SWE build
- **Scope document**: /Volumes/Projects/workers/core-remodel/.agents/orchestrator_bid_portfolio_1/PROJECT.md
1. **Decompose**: 5 milestones along module boundaries (DB → API → Admin UI → Public Viewer → AI Agent)
2. **Dispatch & Execute**:
   - **Sequential dependencies**: M1 → M2 → (M3 + M4 parallel) → M5
   - **Direct (iteration loop)**: Explorer → Worker → Reviewer → gate per milestone
3. **On failure**: Retry → Replace → Redesign
4. **Succession**: At 16 spawns, write handoff.md, spawn successor
- **Work items**:
  1. Database Schema & Migrations [pending]
  2. API Routes [pending]
  3. Admin Frontend [pending]
  4. Public Portfolio Viewer [pending]
  5. AI Chat Agent [pending]
- **Current phase**: 2 (Dispatch & Execute)
- **Current focus**: Dispatching M1 (Database Schema)

## 🔒 Key Constraints
- pnpm only (pnpm-lock.yaml exists)
- Drizzle ORM on D1 — no raw SQL files
- Follow existing code patterns exactly (integer timestamps via unixepoch(), autoIncrement PKs)
- Dark theme throughout, shadcn/ui
- TypeScript strict
- Must pass `pnpm run build` when complete
- Never reuse a subagent after it has delivered its handoff

## Current Parent
- Conversation ID: 198cb2cf-f0be-4e42-bf3d-78c316688a24
- Updated: 2026-05-24T18:17:00-07:00

## Key Decisions Made
- M1-M2 sequential (API depends on schema), M3+M4 can parallelize after API, M5 last
- Skip E2E Testing Track (feature build, not greenfield project)

## Team Roster
| Agent | Type | Work Item | Status | Conv ID |
|-------|------|-----------|--------|---------|

## Succession Status
- Succession required: no
- Spawn count: 0 / 16
- Pending subagents: none
- Predecessor: none
- Successor: not yet spawned

## Active Timers
- Heartbeat cron: not started
- Safety timer: none

## Artifact Index
- PROJECT.md — Project-level architecture, milestones, interfaces, code layout
- progress.md — Liveness heartbeat and step tracking
