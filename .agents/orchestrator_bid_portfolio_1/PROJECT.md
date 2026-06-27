# PROJECT.md — Bid Portfolio System

## Architecture
A full-stack feature addition to the core-remodel Cloudflare Workers app. The system enables homeowners to create configurable, shareable bid portfolios for contractors/architects/civil engineers with visitor tracking, AI chat, and role-adapted content.

### Module Boundaries
```
src/backend/db/schema/bid-portfolios/   ← M1: New Drizzle schema files
src/backend/api/routes/bid-portfolios.ts ← M2: Hono API routes
src/frontend/components/bid-portfolio/  ← M3: Admin React components
src/frontend/pages/bid/                 ← M4: Public viewer pages
src/backend/ai/agents/BidPortfolioAgent/ ← M5: AI Durable Object agent
```

### Data Flow
1. Admin creates contacts + portfolios → stored in D1 via Drizzle → API routes
2. Portfolio generates unique token → public viewer at `/bid/{token}`
3. Public viewer fetches portfolio data via public API (no auth)
4. Visitor events tracked via existing `visitorSessions`/`visitorEvents` tables
5. Comments submitted by contacts → stored in `bid_portfolio_comments` → notifications
6. AI chat via `BidPortfolioAgent` DO → chat messages persisted to D1

### Shared Interfaces
- `Env` type in `worker-configuration.d.ts` — must add `BID_PORTFOLIO_AGENT` binding
- `_worker.ts` entry point — must export `BidPortfolioAgent` and add routing for `/bid/` paths
- `wrangler.jsonc` — must add DO binding + migration tag v6
- `src/backend/api/index.ts` — must mount bid-portfolios router
- `src/backend/db/schema/index.ts` — must export new schema tables

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Database Schema & Migrations | New Drizzle schema tables: `contacts`, `bid_portfolios`, `bid_portfolio_room_configs`, `bid_portfolio_comments`, `bid_portfolio_chat_messages` in `src/backend/db/schema/bid-portfolios/`. Export from `index.ts`. | none | PLANNED |
| 2 | API Routes | CRUD for contacts & bid portfolios, public token endpoint, analytics, comments, chat routes. All under `/api/bid-portfolios/`. Mount in `src/backend/api/index.ts`. | M1 | PLANNED |
| 3 | Admin Frontend | Contact management UI, portfolio creation form, analytics dashboard, comments review panel. React components in `src/frontend/components/bid-portfolio/`. Astro pages. | M2 | PLANNED |
| 4 | Public Portfolio Viewer | PDF-like slide deck at `/bid/{token}`. Minimal layout, slide types, print CSS, visitor tracking, comments UI, role-based adaptation. New Astro layout + page. | M2 | PLANNED |
| 5 | AI Chat Agent | `BidPortfolioAgent` DO with privacy-respecting chat, assistant-ui frontend panel, wrangler.jsonc bindings, chat message persistence. Integration wiring in `_worker.ts`. | M1, M2, M4 | PLANNED |

## Interface Contracts

### Schema → API (M1 → M2)
Tables exported from `src/backend/db/schema/index.ts`:
- `contacts` — company/person records with businessType enum
- `bidPortfolios` — portfolio config with token, contactId FK, visibility settings
- `bidPortfolioRoomConfigs` — room-to-portfolio mappings with visibility overrides
- `bidPortfolioComments` — contact comments on portfolios/slides
- `bidPortfolioChatMessages` — AI chat message persistence

### API → Frontend (M2 → M3, M4)
Hono routes at `/api/bid-portfolios/`:
- `GET /api/bid-portfolios/contacts` — list contacts
- `POST /api/bid-portfolios/contacts` — create contact
- `PUT /api/bid-portfolios/contacts/:id` — update contact
- `GET /api/bid-portfolios/` — list portfolios
- `POST /api/bid-portfolios/` — create portfolio
- `PUT /api/bid-portfolios/:id` — update portfolio
- `GET /api/bid-portfolios/:id/analytics` — analytics data
- `GET /api/bid-portfolios/public/:token` — public portfolio data (no auth)
- `POST /api/bid-portfolios/public/:token/comments` — submit comment
- `GET /api/bid-portfolios/:id/comments` — list comments (admin)
- `POST /api/bid-portfolios/public/:token/track` — track visitor events

### Agent → Frontend (M5 → M4)
- `BidPortfolioAgent` DO with `@callable()` method `chat()`
- API route `POST /api/bid-portfolios/public/:token/chat` — chat endpoint
- Frontend uses `@assistant-ui/react` with `AssistantChatTransport` 

## Code Layout

### Existing Conventions (MUST FOLLOW)
- Schema files in `src/backend/db/schema/<module>/` with:
  - `integer("id").primaryKey({ autoIncrement: true })`
  - `integer("datetime_created", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)`
  - Import from `drizzle-orm` and `drizzle-orm/sqlite-core`
- API routes in `src/backend/api/routes/` as Hono routers
- Agent DOs in `src/backend/ai/agents/<AgentName>/index.ts` extending `Agent` from `agents`
- Frontend components in `src/frontend/components/`
- Pages in `src/frontend/pages/`
- Layout in `src/frontend/layouts/`

### New Files (planned)
```
src/backend/db/schema/bid-portfolios/
  contacts.ts
  bid_portfolios.ts
  bid_portfolio_room_configs.ts
  bid_portfolio_comments.ts
  bid_portfolio_chat_messages.ts

src/backend/api/routes/
  bid-portfolios.ts              (main CRUD + admin routes)
  bid-portfolio-public.ts        (public token-based routes)

src/frontend/components/bid-portfolio/
  ContactManager.tsx
  PortfolioForm.tsx
  PortfolioAnalytics.tsx
  CommentsReview.tsx
  BidPortfolioAdmin.tsx          (orchestrator component)

src/frontend/pages/
  bid-portfolios.astro           (admin page)
  bid/[token].astro              (public viewer page)

src/frontend/layouts/
  BidLayout.astro                (minimal layout for public viewer)

src/frontend/components/bid-portfolio/viewer/
  CoverSlide.tsx
  OverviewSlide.tsx
  RoomSlide.tsx
  BudgetSlide.tsx
  ScenariosSlide.tsx
  InspirationSlide.tsx
  NextStepsSlide.tsx
  PortfolioViewer.tsx            (main viewer component)
  ChatPanel.tsx                  (assistant-ui chat panel)
  CommentForm.tsx
  PrintStyles.css

src/backend/ai/agents/BidPortfolioAgent/
  index.ts
```

### Wiring Changes
- `wrangler.jsonc`: Add `BID_PORTFOLIO_AGENT` DO binding + v6 migration tag
- `worker-configuration.d.ts`: Add `BID_PORTFOLIO_AGENT` type
- `src/_worker.ts`: Export `BidPortfolioAgent`, add `/bid/` routing 
- `src/backend/api/index.ts`: Mount bid-portfolio routers
- `src/backend/db/schema/index.ts`: Export new schema modules
