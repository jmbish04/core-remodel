# Handoff Report — M2 API Routes

## Observation

### Files Created
1. **`src/backend/api/routes/bid-portfolios.ts`** — Admin CRUD routes (auth required)
2. **`src/backend/api/routes/bid-portfolio-public.ts`** — Public routes (no auth)

### File Modified
3. **`src/backend/api/index.ts`** — Router imports + mounting + auth middleware

### Build Result
- `pnpm run build` — **SUCCESS** (no TypeScript errors, Vite build completes)

---

## Routes Implemented

### `bid-portfolios.ts` — Admin routes (`bidPortfoliosRouter`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/contacts` | List all non-archived contacts |
| `POST` | `/contacts` | Create a contact (validates companyName, contactName, businessType) |
| `PUT` | `/contacts/:id` | Update a contact |
| `DELETE` | `/contacts/:id` | Soft-delete (sets isArchived=true) |
| `GET` | `/` | List all portfolios with joined contact info |
| `POST` | `/` | Create portfolio (generates `crypto.randomUUID()` token, validates contactId) |
| `PUT` | `/:id` | Update portfolio config |
| `DELETE` | `/:id` | Archive portfolio (sets status='archived') |
| `GET` | `/:id/rooms` | List room configs for a portfolio with joined room data |
| `POST` | `/:id/rooms` | Bulk upsert room configs (delete existing + re-insert) |
| `GET` | `/:id/analytics` | Return visitor events/sessions for portfolio token path |
| `GET` | `/:id/comments` | List all comments for a portfolio |
| `PUT` | `/comments/:commentId/read` | Mark comment as read |

### `bid-portfolio-public.ts` — Public routes (`bidPortfolioPublicRouter`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/:token` | Full portfolio data: portfolio + contact + room configs + photos + inspiration images + budget ranges (if enabled) + scenarios. Returns 410 Gone if expired. |
| `POST` | `/:token/track` | Record visitor event. Creates visitor session with CF geolocation headers, inserts event. |
| `GET` | `/:token/comments` | List comments for public viewer |
| `POST` | `/:token/comments` | Submit comment + create notification for homeowner |
| `POST` | `/:token/chat` | Placeholder — returns 501 Not Implemented (M5) |

### API Index Wiring (`index.ts`)

- Added imports for `bidPortfoliosRouter` and `bidPortfolioPublicRouter`
- Added conditional auth middleware at `/api/bid-portfolios/*` that **skips** `/api/bid-portfolios/public` paths
- Mounted public router at `/api/bid-portfolios/public` BEFORE admin router
- Mounted admin router at `/api/bid-portfolios`

---

## Logic Chain

1. **Schema tables exist** — All 5 bid-portfolio schema files in `src/backend/db/schema/bid-portfolios/` are confirmed present and exported from `schema/index.ts` (lines 66-70).
2. **Followed existing patterns** — Route structure mirrors `estimate-contacts.ts` (CRUD pattern), `budget-tracker.ts` (complex queries), and `notifications.ts` (simple CRUD).
3. **Auth separation** — Public routes use a separate Hono router mounted at `/api/bid-portfolios/public`. The auth middleware uses a conditional check to skip paths starting with `/api/bid-portfolios/public`, ensuring public routes remain unauthenticated.
4. **Token generation** — Uses `crypto.randomUUID()` for portfolio tokens (available in Workers runtime).
5. **Expiration check** — Public GET endpoint checks both `status` field and `expirationDate` timestamp, returning 410 Gone for expired portfolios.
6. **Budget data gating** — Budget tracker items and assumption line items are only returned when `showBudgetRanges` is true on the portfolio.
7. **Visitor tracking** — Uses existing `visitorSessions` and `visitorEvents` tables with CF request headers for geolocation.
8. **Notifications** — Comment submission creates a notification for the first user in the system (homeowner), matching the existing notifications table schema.

## Caveats

1. **Visitor session ID stability** — The current tracking implementation generates a new `visitorId` per request. In production, M4 (Public Viewer) should use a cookie-based stable visitor ID via `setVisitorCookie()` from `@backend/utils/access`. The tracking endpoint is designed to work with `onConflictDoUpdate` for session upserts once cookie-based IDs are in place.
2. **Notification userId** — Uses `db.select().from(users).limit(1)` to find the homeowner. This works for a single-user system but may need refinement if multi-user support is added.
3. **Analytics query efficiency** — For large datasets, the analytics query uses `like()` for path matching. Consider adding an index on `visitor_events.path` if performance is a concern.
4. **Chat route** — Returns 501 as a placeholder. M5 will implement the actual BidPortfolioAgent integration.

## Conclusion

All M2 API routes are implemented and building successfully. The admin routes provide full CRUD for contacts and portfolios, room config management, analytics, and comment management. The public routes provide token-based portfolio data access, visitor tracking, comment submission with notifications, and a chat placeholder. The wiring in `index.ts` correctly separates auth-required admin routes from unauthenticated public routes.

## Verification Method

```bash
cd /Volumes/Projects/workers/core-remodel
pnpm run build
```

Expected: Build completes with no errors. Check output for `[build] Complete!`

Files to inspect:
- `src/backend/api/routes/bid-portfolios.ts` — 13 route handlers
- `src/backend/api/routes/bid-portfolio-public.ts` — 5 route handlers
- `src/backend/api/index.ts` — lines 49-50 (imports), 71-78 (auth middleware), 119-120 (route mounting)
