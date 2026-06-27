# Project: Budget Management System

## Architecture
- **Runtime**: Cloudflare Workers + Astro SSR
- **DB**: D1 (SQLite) via Drizzle ORM — existing schema barrel at `src/backend/db/schema/index.ts`
- **API**: Hono framework (`OpenAPIHono<{ Bindings: Env }>`) mounted at `src/backend/api/index.ts`
- **Frontend**: Astro pages (`src/frontend/pages/`) + React islands (`src/frontend/components/`) + shadcn/ui + Tailwind v4
- **Package manager**: pnpm

## Existing Resources
- **Schema directory**: `src/backend/db/schema/home/` (26 files including floors.ts, rooms.ts, truth_table_activities.ts)
- **Schema barrel**: `src/backend/db/schema/index.ts` (re-exports all)
- **API router index**: `src/backend/api/index.ts` (app.route() mounting pattern)
- **Drizzle config**: `drizzle.config.ts` → outputs to `./drizzle/`
- **Reference tables**: `floors` (id, key, name), `rooms` (id, floorId, roomCode, roomName)
- **Existing route example**: `truth-table.ts` — uses `OpenAPIHono<{ Bindings: Env }>`, Zod schemas, `drizzle(c.env.DB)`
- **Existing page example**: `truth-table.astro` — imports BaseLayout + React island with `client:only="react"`
- **Data sources**: `proofs/data/` — JSON export (10 sheets) + TSV assumptions file

## Data Source Details
### JSON Export (281KB)
- **Truth Table** (152 rows): work_item, description, category, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale
- **Standard Costs** (196 rows): room, floor, work_item, Work Item Type, quantity, measurement_type, unit prices, tax, O&P, RCV, total costs, notes
- **Static Budget Items** (55 rows): Category, Floor, Area/Room, Comparison, Item Description, Estimated QTY, Unit, min/avg/max costs, Notes
- **Budget Variance** (14 rows): 4 kitchen scenarios (A-D) with deviation totals
- **Sheet6** (8 rows): Infrastructure/permit items

### Assumptions TSV (17.5KB)
- Rows 1-11: PMO summary (Phase 1: $266k, Phase 2: $49.8k, $300k cap)
- Rows 12-16: 4 global system variables
- Room sections: Backyard, Lower Level, Kitchen (Scenario C), Upper Level, Guest Bathrooms, Primary Bathroom, Mechanical, Site Assets
- Primary bath shower micro-variances: Scenarios A-F (rows 79-116) + add-ons (Steam/Smart)

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Schema | 9 new Drizzle tables in `src/backend/db/schema/home/` + schema index updates + migration generation | none | PLANNED |
| 2 | Seeding | Parse JSON + TSV, deduplicate, seed all tables with FK relationships. Idempotent script. | M1 | PLANNED |
| 3 | API Routes | CRUD for all budget tables + scenario comparison + assumptions summary + budget snapshot endpoints | M1, M2 | PLANNED |
| 4 | Frontend Dashboard | 5 React island components in Astro pages + shadcn/ui dark theme | M3 | PLANNED |
| 5 | Deploy | `pnpm run deploy` to Cloudflare Workers | M4 | PLANNED |

## Implementation Grouping
- **M1+M2 combined**: Schema tables and seeding are tightly coupled (FK design requires data understanding). Single sub-orchestrator.
- **M3**: API layer (separate module boundary, depends on M1+M2 schema)
- **M4**: Frontend (separate module boundary, depends on M3 API)
- **M5**: Final deployment milestone

## Interface Contracts

### Schema → API
- All 9 new tables exported from `src/backend/db/schema/index.ts`
- Tables use `sqliteTable()` from `drizzle-orm/sqlite-core`
- PK patterns: integer auto-increment (for reference tables) or text UUIDs (for data rows)
- FK references: `references(() => table.column, { onDelete: "cascade" })`
- Timestamps: `integer("datetime_created", { mode: "timestamp" }).default(sql\`(unixepoch())\`)`

### API → Frontend
- All routes follow OpenAPIHono pattern with Zod schemas
- Mount pattern: `app.route("/api/budget/*", budgetRouter)` in `src/backend/api/index.ts`
- Response format: JSON with standard pagination `{ data: [], total, limit, offset }`

### Frontend Conventions
- Astro page imports `BaseLayout` + React island with `client:only="react"`
- React components in `src/frontend/components/`
- shadcn/ui components in `src/frontend/components/ui/`
- Dark theme enforced in `<html class="dark">`

## Code Layout

### New Files to Create
```
src/backend/db/schema/home/
├── work_item_types.ts          # M1
├── trade_data.ts               # M1
├── standard_costs.ts           # M1
├── static_budget_items.ts      # M1
├── budget_variance_scenarios.ts # M1
├── budget_variance_line_items.ts # M1
├── assumption_line_items.ts    # M1
├── assumption_micro_variances.ts # M1
└── project_system_variables.ts # M1

scripts/
└── seed-budget.ts              # M2

src/backend/api/routes/
├── budget-data.ts              # M3 (trades + standard costs + static items)
├── budget-scenarios.ts         # M3 (variance scenarios + comparisons)
├── budget-assumptions.ts       # M3 (assumptions + micro-variances + system vars)
└── budget-snapshot.ts          # M3 (computed totals)

src/frontend/pages/
├── budget-dashboard.astro      # M4
├── trades.astro                # M4
├── assumptions.astro           # M4
├── kitchen-scenarios.astro     # M4
└── bathroom-scenarios.astro    # M4

src/frontend/components/
├── TradesDataBrowser.tsx        # M4
├── BudgetAssumptionsView.tsx    # M4
├── KitchenScenarioComparator.tsx # M4
├── BathroomVariancePicker.tsx   # M4
└── BudgetSummaryDashboard.tsx   # M4
```

## Acceptance Criteria (Key Data Integrity Checks)
- Budget variance deviation totals: A=$177,284, B=$80,000, C=$117,304, D=$40,000
- trade_data: all 152 rows (deduplicated)
- standard_costs: all 196 rows
- static_budget_items: all 55 rows
- budget_variance_scenarios: 4 kitchen scenarios
- assumption_line_items: all items from TSV grouped by room
- assumption_micro_variances: all shower scenarios (A-F × 1-2 + add-ons)
- project_system_variables: 4 global variables from TSV rows 12-16
- All FK relationships must resolve
