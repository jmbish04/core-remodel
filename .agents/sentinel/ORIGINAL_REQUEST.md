# Original User Request

## Initial Request — 2026-05-24T18:12:57-07:00

Build a **Bid Portfolio** system for the core-remodel app at `/Volumes/Projects/workers/core-remodel`. This is a production feature for a homeowner-facing renovation management app running on Cloudflare Workers (Hono API + Astro SSR + React + shadcn/ui dark theme + Drizzle ORM on D1). The system allows the homeowner to create shareable, configurable bid portfolios that present project scope and details to contractors, architects, and civil engineers — each receiving their own unique, tracked link with privacy-controlled content visibility and an embedded AI chat assistant.

Working directory: /Volumes/Projects/workers/core-remodel

## Requirements

### R1. Contact Management & Bid Portfolio CRUD

Create a homeowner-facing admin interface (protected behind existing auth) where the homeowner can:
- Create/edit/archive contact records for companies (contractors, architects, civil engineers) with fields: company name, contact name, title, email, phone, business type (contractor/architect/civil_engineer/other), license number, website, notes.
- Create bid portfolios linked to a contact, generating a unique shareable token/link (e.g. `/bid/{token}`).
- Configure each portfolio's visibility settings: which rooms to include, which floor areas, whether to show budget ranges (yes/no), which remodel scenarios to expose, a custom welcome message, an overview statement, and an expiration date.
- View analytics per portfolio: total visits, unique sessions, pages viewed, time spent, last visited, and a timeline of visitor events.

This must use Drizzle ORM on the existing D1 database (`DB` binding). New schema tables should follow the existing pattern in `src/backend/db/schema/` (integer timestamps via `unixepoch()`, autoIncrement PKs, etc.). API routes should be Hono routes mounted under `/api/bid-portfolios/` following the existing pattern in `src/backend/api/routes/`.

### R2. Public Bid Portfolio Viewer (PDF-like Presentation)

Build a public-facing portfolio viewer at `/bid/{token}` that:
- Uses a **dedicated minimal layout** — NO sidebar navigation, NO header nav from the main app. Clean, focused, document-like experience with only a slim top bar showing the project name and a chat toggle.
- Renders as a **multi-page, PDF-like slide deck** inspired by the existing proof of concept at `proofs/concepts/colby remodel rfp/` (dark theme, Geist fonts, oklch color tokens, `deck-stage` slide metaphor). Each "page" should be a full-viewport section that scrolls vertically like pages in a PDF document.
- **Slide types** should include:
  - **Cover slide**: Project name, prepared-for company name, date, welcome message from homeowner
  - **Project Overview slide**: Overview statement, property details, remodel scope summary
  - **Room-by-room slides**: For each included room — listing photos from the D1 images table (Cloudflare Images delivery URLs), room dimensions, current condition notes, planned scope items
  - **Scope & Budget slides** (conditional on config): Budget ranges for included scope items using data from `budget_tracker_items` and `assumption_line_items` — showing min/avg/max ranges, NOT exact numbers, and only when the portfolio is configured to share budget info
  - **Scenarios slide** (conditional): Kitchen scenario comparison, shower matrix selections — from the budget dashboard data model
  - **Inspiration/Moodboard slides**: Relevant inspiration photos and AI-generated design notes for included rooms
  - **Questions & Next Steps slide**: CTA for the contact to leave comments/questions, timeline expectations
- Include a **print/download button** that triggers `window.print()` with `@media print` CSS optimized for 8.5" × 11" pages (proper page breaks between slides, white background for print, hidden interactive elements).
- Track every page view, click, and session via the existing `visitorSessions` / `visitorEvents` tables, linking each event to the specific portfolio's contact token.

### R3. Contact Interaction Layer (Comments & Questions)

Enable the contact (contractor/architect) viewing a portfolio to:
- Submit comments and questions on specific slides or the portfolio as a whole. These are stored in a new `bid_portfolio_comments` table linked to the portfolio and optionally to a room/section.
- The homeowner sees all comments in their admin dashboard with notification support via the existing `notifications` table.
- Comments appear inline on the portfolio viewer with a collapsible thread UI.

### R4. AI Chat Assistant (Cloudflare Agents SDK + assistant-ui)

Integrate an AI chat assistant into the portfolio viewer using:
- **Backend**: A new `BidPortfolioAgent` Durable Object extending `Agent` from `agents` package (following the existing `BudgetAgent` / `RenovationAgent` pattern). This agent:
  - Receives the portfolio configuration (which rooms, whether budget is shared, etc.) as context on initialization
  - Uses Workers AI (`@cf/openai/gpt-oss-120b`) to answer questions about the project scope, timeline, materials, and design intent
  - **Respects privacy boundaries**: If budget details are restricted in the portfolio config, the agent gracefully deflects budget questions with helpful but non-revealing responses (e.g., "I'd recommend discussing budget specifics directly with the homeowner — I can help you understand the scope and materials instead.")
  - Logs all chat interactions to the D1 database for the homeowner to review
- **Frontend**: Use `@assistant-ui/react` with `useChatRuntime` and `AssistantChatTransport` (matching the existing `BudgetDashboardApp` pattern). The chat UI should be a slide-out panel triggered by a floating button on the portfolio viewer, styled to match the dark theme.
- Wire the agent in `wrangler.jsonc` as a new Durable Object binding `BID_PORTFOLIO_AGENT` with class `BidPortfolioAgent`, and add the appropriate SQLite migration tag.

### R5. Differentiated Content for Contractor vs. Architect vs. Civil Engineer

The portfolio presentation should adapt based on the contact's `businessType`:
- **Contractors**: Emphasize scope of work, structural details, material specifications, trade catalog data, timeline expectations. Show "What we need from you" sections per room.
- **Architects**: Emphasize design intent, inspiration references, spatial relationships, floor plans/dimensions, aesthetic goals. Include moodboard slides and design notes.
- **Civil Engineers**: Emphasize structural elements, drainage/foundation details, load-bearing wall assessments, grading/utility considerations.

The slide ordering, emphasis, and language should shift based on `businessType` — not just which slides are shown, but how the content within slides is presented.

## Acceptance Criteria

### Database Schema
- [ ] New Drizzle schema tables: `bid_portfolios`, `bid_portfolio_room_configs`, `bid_portfolio_comments`, `bid_portfolio_chat_messages` created in `src/backend/db/schema/`
- [ ] Schema exported from `src/backend/db/schema/index.ts`
- [ ] Drizzle migration generated successfully via `drizzle-kit generate`

### API Routes
- [ ] CRUD routes for bid portfolios at `/api/bid-portfolios/` with proper auth middleware
- [ ] Public portfolio data endpoint at `/api/bid-portfolios/public/{token}` (no auth required, returns configured data)
- [ ] Portfolio analytics endpoint returning visit/session data
- [ ] Comments CRUD endpoint
- [ ] Chat endpoint for the AI agent

### Frontend — Admin
- [ ] Homeowner can create a new contact and bid portfolio from the admin UI
- [ ] Portfolio configuration form with room selection, budget visibility toggle, welcome message editor
- [ ] Analytics dashboard showing per-portfolio engagement metrics
- [ ] Comments review panel showing contact questions

### Frontend — Public Viewer
- [ ] Portfolio renders at `/bid/{token}` with no main app navigation
- [ ] PDF-like vertical scroll layout matching the RFP proof-of-concept design language
- [ ] Print/download produces clean 8.5" × 11" pages
- [ ] Visitor tracking fires on page view and click events
- [ ] AI chat panel slides out from a floating button
- [ ] Comments can be submitted inline

### AI Agent
- [ ] `BidPortfolioAgent` Durable Object functions correctly with `@callable()` methods
- [ ] Agent respects portfolio configuration boundaries (budget privacy, room scope)
- [ ] Chat messages are persisted and reviewable by homeowner
- [ ] Registered in `wrangler.jsonc` with proper bindings and migration

### Build & Deploy
- [ ] `pnpm run build` completes without errors
- [ ] TypeScript compilation succeeds with no type errors
- [ ] Existing tests continue to pass
