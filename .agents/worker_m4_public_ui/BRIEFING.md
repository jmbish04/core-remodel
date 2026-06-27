# BRIEFING — 2026-05-24T18:29:24

## Mission
Create the public-facing Bid Portfolio viewer — a slide-deck-style presentation at `/bid/[token]`.

## 🔒 My Identity
- Archetype: implementer, qa, specialist
- Roles: implementer, qa, specialist
- Working directory: /Volumes/Projects/workers/core-remodel/.agents/worker_m4_public_ui/
- Original parent: 6ed2dc92-f7af-41cf-a9ce-3a0541c6bb9c
- Milestone: M4 Public Portfolio Viewer

## 🔒 Key Constraints
- BaseLayout enforces sidebar/auth — need minimal BidLayout.astro
- Public pages: no auth, no sidebar
- Dark theme: bg-zinc-950, emerald accents (matching BudgetDashboardApp)
- assistant-ui chat panel using useChatRuntime + AssistantChatTransport pattern
- API endpoints: /api/bid-portfolios/public/:token/*

## Current Parent
- Conversation ID: 6ed2dc92-f7af-41cf-a9ce-3a0541c6bb9c
- Updated: 2026-05-24T18:29

## Task Summary
- **What to build**: Slide-deck-style public portfolio viewer
- **Files**: BidLayout.astro, bid/[token].astro, BidPortfolioViewerApp.tsx
- **Success criteria**: pnpm run build passes, all sections rendered

## Key Decisions Made
- Use BidLayout.astro instead of BaseLayout (no sidebar, no auth)
- Reuse HeadSEO.astro for meta tags
- Emerald accent color (consistent with BudgetDashboardApp)

## Artifact Index
- src/frontend/layouts/BidLayout.astro — minimal public layout
- src/frontend/pages/bid/[token].astro — dynamic route page
- src/frontend/components/BidPortfolioViewerApp.tsx — main viewer component
