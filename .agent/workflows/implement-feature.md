# Workflow: Monolith Integration, Clasp, Row-Versioned D1 Tracking Engine, and Agents SDK Sidebar Sync

## Objective

Integrate, modularize, and migrate an existing standalone Google Apps Script renovation budgeting project into the `core-remodel` repository using `clasp` management, GitHub Actions CI/CD workflows, a versioned D1 database layer via Drizzle ORM, Hono sync API routes, and a stateful WebSocket agent using the Cloudflare Agents SDK.

## Implementation Steps

### Phase 1: Tooling Scaffolding & CI/CD Layout

1. Create directory paths under `src/appsscript/`.
2. Configure `.clasp.json` inside the directory using the current spreadsheet target ID.
3. Establish an `appsscript.json` manifest specifying runtime parameters (`V8`, timezone context, Stackdriver).
4. Create `.github/workflows/deploy-appsscript.yml` linking to branch main updates using repository secret parameters (`CLASP_TOKEN`) to run automated `clasp push` tasks.

### Phase 2: Relational Schema & Migration Pipeline (D1 / Drizzle)

1. Design schema modules at `src/backend/db/schema/home/budget_tracking.ts`.
2. Map tables: `budget_rows` (with string format unique IDs `brId_${id}` to prevent spreadsheet numerical conversion errors), `budget_row_revisions` (tracking mathematical string values and raw formula expressions like `=SUM(...)`), and `sync_sessions` tracking transport payloads.
3. Execute database structural updates using `pnpm run db:generate`. Run migrations remotely across cloud targets via `pnpm wrangler d1 migrations apply --remote`.

### Phase 3: Core API Infrastructure (Hono Sync Routes)

1. Add Hono endpoint routes inside `src/backend/api/routes/budget-tracker.ts`.
2. Write `GET /api/budget/pull` pulling active rows joined to their latest revision numbers.
3. Write `POST /api/budget/push` wrapping batch calculations inside strict database transaction logic blocks, tracking operational update sessions, and updating omitted records to `is_active = false`.

### Phase 4: Apps Script Refactor & Visual Diff Compilation Engine

1. Rebuild `budget.js` to execute external api calls using `UrlFetchApp`.
2. Implement cell validation loops comparing sheet metrics against database payload vectors.
3. Code conditional formatting markers painting inactive rows red, changed values yellow, and appending delta changes to a clean `Sync Logs` page using the formatting rule: `field: oldVal -> newVal`.

### Phase 5: Stateful Cloudflare Agent Setup & Sidebar Integration

1. Implement a stateful agent class extending the platform `Agent` class under `src/backend/ai/agents/BudgetAgent/index.ts`.
2. Configure wrangler endpoints mapping real-time WebSocket protocol upgrades down to the class context.
3. Refactor `Sidebar.html` using Monolith styling schemas to process streaming feedback tokens and fire interactive quick-action buttons.
4. Integrate the structural automation framework: create custom server tool definitions that write payload strings over WebSockets, enabling the client sidebar tool to execute `google.script.run` spreadsheet tasks and push confirmations back up to the edge agent.
