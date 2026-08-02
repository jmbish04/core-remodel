# Budget AI Implementation Prompt

You are implementing the Budget AI workbench inside the existing `core-remodel` Cloudflare Worker repo.

## Goal

Build a repo-grounded internal budget operating surface that connects:

- `budget_tracker_items`
- `budget_expense_entries`
- room detail
- estimate revisions and line items
- material schedule items
- showroom products
- questionnaire-triggered shadow budget items
- contractor-facing bid portfolios

Do not invent a parallel budgeting system. Reuse the current Worker/D1/Hono/Astro/React structure and extend it.

## Existing Repo Reality

Use the current surfaces, not imaginary ones:

- budget planning ledger: `src/backend/db/schema/home/budget_tracker_items.ts`
- room budget endpoints: `src/backend/api/routes/rooms.ts` and `rooms-extended.ts`
- budget tracker API: `src/backend/api/routes/budget-tracker.ts`
- budget snapshot logic: `src/backend/services/budget-model.ts`
- materials: `src/backend/api/routes/materials.ts`
- showroom products: `src/backend/db/schema/showroom/*`
- estimates: `src/backend/api/routes/estimates.ts`
- bid portfolios: `src/backend/api/routes/bid-portfolios.ts` and `bid-portfolio-public.ts`
- questionnaire triggers: `src/backend/api/routes/construction-checklist.ts`

## Product Contract

Add a new internal route:

- `/admin/budget/workbench`

This route should provide:

1. Executive rollups
2. Decision inbox
3. Room budget board
4. Estimate reconciliation board
5. Materials/product decision board
6. Contractor-visibility preview
7. Sync-history view

## Required Data Principles

- Deterministic math stays in services and D1-backed logic.
- AI may summarize and suggest, but not silently mutate financial facts.
- Reuse existing tables first.
- Add only the smallest missing schema needed for cross-system evidence links and durable budget alerts.
- Preserve the distinction between allowances/placeholders, committed values, actual spend, and protected contingency reserve.
- MCP actions must have parity with frontend actions. If a frontend action produces persisted data points A-D or triggers follow-up logic, the MCP path must do the same.
- Prefer shared backend mutation services so frontend and MCP are just different callers of the same domain logic.

## New Schema To Add

### `budget_tracker_item_links`

Persist links from a budget tracker item revision to:

- room
- questionnaire track
- estimate revision
- estimate line item
- material
- showroom product
- bid portfolio

### `budget_alerts`

Persist derived budget warnings and workbench inbox items such as:

- unmapped estimate lines
- product over target
- room over range
- questionnaire shadow item unreviewed

Also persist selected-product state at the material layer separately from purchased-product state.

Rules:

- selected means current final decision pending purchase
- purchased implies selected
- selected may still change if purchase fails or circumstances change

## New Backend Surface

Create `src/backend/services/budget-workbench.ts` and a matching router at:

- `src/backend/api/routes/budget-workbench.ts`

Provide these endpoints:

- `GET /api/budget-workbench/summary`
- `GET /api/budget-workbench/rooms`
- `GET /api/budget-workbench/estimates`
- `GET /api/budget-workbench/materials`
- `GET /api/budget-workbench/decision-inbox`
- `GET /api/budget-workbench/sync-history`
- `POST /api/budget-workbench/links`
- `POST /api/budget-workbench/alerts/recompute`

Design mutation handlers so MCP-capable operations do not bypass:

- revision creation
- evidence link writes
- alert recomputation or creation
- audit/sync events where applicable
- async follow-up triggers that the frontend action would have caused

## Frontend Surface

Create:

- `src/frontend/pages/admin/budget/workbench.astro`
- `src/frontend/components/BudgetWorkbenchApp.tsx`

Use the existing Monolith/Shadcn dark visual language already present in:

- `TruthTableApp.tsx`
- `BudgetDashboardApp.tsx`
- room-view components
- product/showroom viewports

The page should feel production-ready, not like an admin scaffold.

## UX Behavior

- The overview should immediately show planned, committed, spent, and remaining budget state.
- The overview should also show contingency consumption clearly.
- The decision inbox should drive action, not just reporting.
- Room cards should deep-link naturally into room detail.
- Estimate cards should surface unresolved mapping state.
- Estimate reconciliation must support both revision-level context and line-item-level mapping.
- Low-confidence estimate lines should go into an explicit human-review staging pattern.
- Material cards should reveal product and purchase decision state.
- Contractor visibility preview should clearly separate internal-only intelligence from public brief content, while allowing the homeowner to preview the full internal budget/shareability picture.
- The first release must include a dedicated sync-history view for budget edits.

## Agent Guidance

Upgrade `BudgetAgent` only after the structured workbench services exist.

The agent should consume real workbench outputs and return:

- concise summaries
- top drivers
- unresolved items
- suggested mappings
- explicit `needs_human_mapping` outcomes when evidence is weak

Do not leave the agent operating as a toy snapshot demo.

## Constraints

- Stay inside the unified Worker architecture.
- Prefer existing schema and route patterns.
- Keep APIs typed and implementation-ready.
- Keep budget math deterministic.
- Preserve current dark-theme UX patterns.
- Avoid unnecessary Workflows or new Durable Objects unless the repo’s current behavior truly requires them.
- Do not create separate “frontend logic” and “MCP logic” for the same mutation. Shared service-layer parity is required.

## Acceptance Criteria

- `/admin/budget/workbench` works with live repo data.
- Budget rollups reflect planning, committed, and spent states distinctly.
- At least one durable evidence-linking mechanism exists for budget items.
- Decision inbox is backed by persisted alerts, not only transient UI logic.
- Room, estimate, and materials flows all surface budget context coherently.
- Manual mapping for unresolved estimate lines is clearly supported.
- Contractor visibility is previewable and clearly bounded.
- MCP-triggered mutations can reproduce the same persisted results and downstream effects as equivalent frontend-triggered mutations.
- Selected-product and purchased-product state are both persisted distinctly at the material layer.
- The first release includes a dedicated sync-history view for budget edits.

## Delivery Order

1. Schema additions
2. Aggregation service
3. Router and API mounting
4. Workbench page and React app
5. Existing route enrichments
6. BudgetAgent upgrade
7. Verification
