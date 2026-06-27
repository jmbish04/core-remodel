# Handoff: Codebase Integration Convention Guide

> **Summary**: Complete pattern extraction across schema, API, frontend, build pipeline, and integration points. All conventions documented with exact code patterns. Key finding: the project uses two API styles — `OpenAPIHono` (truth-table) and plain `Hono` (budget-tracker). New routes should follow the established pattern matching their complexity.

---

## 1. Observation

### 1.1 Schema Conventions

**Source files analyzed:**
- `src/backend/db/schema/home/floors.ts` (19 lines)
- `src/backend/db/schema/home/rooms.ts` (39 lines)
- `src/backend/db/schema/home/truth_table_activities.ts` (78 lines)
- `src/backend/db/schema/home/budget_tracker_items.ts` (160 lines)
- `src/backend/db/schema/home/remodel_scenarios.ts` (24 lines)
- `src/backend/db/schema/home/budget_tracking.ts` (29 lines)
- `src/backend/db/schema/index.ts` (55 lines)

#### Import Pattern (EXACT — copy-paste ready)
```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
```

When indexes are needed:
```ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
```

When referencing other tables:
```ts
import { floors } from "./floors";  // relative import within home/
```

#### Column Definition Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Auto-increment PK | `integer("id").primaryKey({ autoIncrement: true })` | floors.ts:9, rooms.ts:10 |
| Text UUID PK | `text("id").primaryKey()` | remodel_scenarios.ts:9, truth_table_activities.ts:23 |
| Text field | `text("name").notNull()` | floors.ts:11 |
| Integer field | `integer("level_order").notNull().default(0)` | floors.ts:12 |
| Real (float) | `real("market_adjustment_pct").notNull().default(0)` | truth_table_activities.ts:47 |
| Boolean | `integer("is_active", { mode: "boolean" }).notNull().default(true)` | rooms.ts:24, truth_table_activities.ts:26 |
| Timestamp (auto) | `integer("datetime_created", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)` | ALL files |
| Timestamp (nullable) | `integer("replaced_at", { mode: "timestamp" })` | truth_table_activities.ts:28 |
| JSON text | `text("metadata")` | rooms.ts:33, remodel_scenarios.ts:16 |
| JSON mode | `text("payload", { mode: "json" })` | budget_tracking.ts:15 |

#### FK Reference Pattern
```ts
// With onDelete cascade:
floorId: integer("floor_id")
  .notNull()
  .references(() => floors.id, { onDelete: "cascade" }),

// With onDelete set null:
scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
  onDelete: "set null",
}),

// Simple reference (no onDelete):
budgetRowId: text("budget_row_id")
  .references(() => budgetRows.id)
  .notNull(),
```

#### Unique / Index Patterns
```ts
// Unique inline:
key: text("key").notNull().unique(),

// Separate index/uniqueIndex definitions (third arg to sqliteTable):
(t) => ({
  byScopeKey: index("idx_tta_scope_key").on(t.scopeKey),
  byTrade: index("idx_tta_trade").on(t.trade),
  activeTrackUnique: uniqueIndex("ux_tta_track_revision").on(
    t.trackId,
    t.revisionNumber,
  ),
}),
```

Index naming: `idx_{table_abbrev}_{column}` for regular, `ux_{table_abbrev}_{columns}` for unique.

#### Type Export Pattern
```ts
export type TruthTableActivity = typeof truthTableActivities.$inferSelect;
export type TruthTableActivityInsert = typeof truthTableActivities.$inferInsert;
```

**Note**: Only `truth_table_activities.ts` exports types. Other schema files do NOT. The new tables should follow the truth_table pattern and export both Select and Insert types.

#### JSDoc Pattern
Each table has a `/** ... */` doc block above the `export const` describing the table purpose.

#### Column Name Convention
- DB column names: `snake_case` (e.g., `datetime_created`, `is_active`)
- JS property names: `camelCase` (e.g., `datetimeCreated`, `isActive`)
- Drizzle handles the mapping via `integer("db_name")` syntax

#### Standard Timestamp Columns
Almost every table ends with:
```ts
datetimeCreated: integer("datetime_created", { mode: "timestamp" })
  .notNull()
  .default(sql`(unixepoch())`),
```

Tables with mutable data also have:
```ts
datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
  .notNull()
  .default(sql`(unixepoch())`),
```

#### Revision Chain Pattern
Tables with revision tracking use:
```ts
trackId: text("track_id").notNull(),
revisionNumber: integer("revision_number").notNull().default(1),
isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
replacedByActivityId: text("replaced_by_activity_id"),
replacedAt: integer("replaced_at", { mode: "timestamp" }),
```

### 1.2 Schema Barrel (index.ts)

**Pattern**: One `export * from "./category/filename"` per schema file. Grouped by domain folder:
```ts
export * from "./home/floors";
export * from "./home/rooms";
export * from "./home/remodel_scenarios";
// ... 23 more home/* exports
export * from "./home/questionnaire";
export * from "./admin/workflow_schedules";
```

**⚠️ FINDING: `budget_tracking.ts` exists but is NOT exported from `index.ts`**. This means `budgetRows`, `syncSessions`, `budgetRowRevisions` are NOT accessible via `@backend/db`. This may be intentional (legacy/unused) or an oversight.

### 1.3 API Conventions

**Two API patterns coexist:**

#### Pattern A: OpenAPIHono with Zod (truth-table.ts)
```ts
import { truthTableActivities } from "@backend/db";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

export const truthTableRouter = new OpenAPIHono<{ Bindings: Env }>();

truthTableRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    request: { query: ListQuerySchema },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({...}) },
        },
        description: "Activity list",
      },
    },
    tags: ["truth-table"],
  }),
  async (c) => {
    const q = c.req.valid("query");
    const db = drizzle(c.env.DB);
    // ... query logic
    return c.json({...});
  },
);
```

#### Pattern B: Plain Hono (budget-tracker.ts)
```ts
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  // ...
} from "@backend/db";
import { desc, eq, inArray, max, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const budgetTrackerRouter = new Hono<{ Bindings: Env }>();

budgetTrackerRouter.get("/items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    // ... query logic
    return c.json({...});
  } catch (error) {
    return c.json(
      {
        error: "Failed to list budget tracker items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
```

#### DB Access Pattern
```ts
const db = drizzle(c.env.DB);  // Always created per-request from c.env.DB binding
```

#### Error Handling
- OpenAPIHono: uses HTTP status responses defined in route schema (404 → `{ error: string }`)
- Plain Hono: try/catch wrapping with `{ error: string, details: string }` at 500

#### ID Generation
```ts
function newId(prefix = "tta") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}
// For track IDs:
const trackId = `track_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
// For budget tracker:
const trackId = crypto.randomUUID();  // raw UUID
```

#### Router Mounting (api/index.ts)
```ts
import { budgetTrackerRouter } from "./routes/budget-tracker";
// ...
app.route("/api/budget-tracker", budgetTrackerRouter);
```

The main app is `new Hono<{ Bindings: Env; Variables: Variables }>()` — note it uses both Bindings AND Variables generics.

#### Data Import Pattern
All schema tables are imported from `@backend/db` (which resolves to `src/backend/db/schema/index.ts` per tsconfig paths).

### 1.4 Frontend Conventions

#### Astro Page Structure
```astro
---
import BaseLayout from "@/layouts/BaseLayout.astro";
import { ComponentName } from "@/components/ComponentName";
---

<BaseLayout
  title="Page Title — The Monolith"
  description="Description for SEO."
>
  <ComponentName client:only="react" />
</BaseLayout>
```

**Key details:**
- `@/` resolves to BOTH `src/frontend/*` AND `src/backend/*` (tsconfig paths line 11)
- Layouts: `@/layouts/BaseLayout.astro`
- Components: `@/components/ComponentName`
- Hydration: always `client:only="react"` (never `client:load` or `client:visible`)
- Some pages add Astro-level HTML wrapping (budget-tracker.astro adds `<main>` + heading); others delegate entirely to the React component (truth-table.astro, budget-reconciliation.astro)

#### BaseLayout Structure
- `<html class="dark">` — dark mode enforced
- Includes `AppSidebar` (client:only="react"), `Footer`, `Toaster` (sonner), `VisitorActivityTracker`
- Content slot renders inside `<div class="flex min-h-svh md:pl-64">`

#### React Component Pattern (TruthTableApp)
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
// lucide-react icons individually imported
// Custom monolith design system components
import { KPI, MonolithCard, PageHeader, ... } from "./monolith";

export function TruthTableApp() {
  // State hooks at top
  // fetch functions with useCallback
  // useEffect for initial load
  // Event handlers
  // Return JSX with zinc-950 dark theme
}
```

#### React Component Pattern (BudgetTrackerApp)
```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
```

**Two UI approaches coexist:**
1. **Custom "monolith" design system** — TruthTableApp uses `./monolith` exports (zinc-950 raw Tailwind)
2. **shadcn/ui components** — BudgetTrackerApp uses `@/components/ui/*` (Card, Badge, Button, Input)

#### Data Fetching Pattern
```tsx
const fetchList = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(`/api/truth-table?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ListResponse;
    setActivities(data.activities);
  } catch (e) {
    setError(e instanceof Error ? e.message : "Failed to load");
  } finally {
    setLoading(false);
  }
}, [dependencies]);

useEffect(() => {
  fetchList();
}, [fetchList]);
```

#### Sidebar Navigation
```ts
// src/frontend/components/AppSidebar.tsx line 25-36
const WORKSPACE_ITEMS: SidebarItem[] = [
  { href: "/planning", label: "Planning" },
  { href: "/budget-tracker", label: "Budget Tracker" },
  { href: "/truth-table", label: "Truth Table" },
  // ...
];
```

New pages need entries added to `WORKSPACE_ITEMS` array.

### 1.5 Build Pipeline

#### package.json Scripts
```json
"db:generate": "drizzle-kit generate",
"db:seed": "npx wrangler@latest d1 execute DB --remote --file=seed.sql",
"migrate:local": "pnpm run db:generate && npx wrangler@latest d1 migrations apply DB --local",
"migrate:remote": "pnpm run db:generate && npx wrangler@latest d1 migrations apply DB --remote",
"deploy": "pnpm run build && cp .assetsignore dist/.assetsignore && pnpm run migrate:remote && npx wrangler@latest deploy",
"cf-typegen": "wrangler types --include-runtime false"
```

**Pipeline:**
1. `drizzle-kit generate` — reads `src/backend/db/schema/index.ts`, outputs SQL migrations to `./drizzle/`
2. `wrangler d1 migrations apply DB` — applies migrations to D1
3. `astro build` — builds frontend
4. `wrangler deploy` — deploys worker

#### Drizzle Config
```ts
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/backend/db/schema/index.ts",
  out: "./drizzle",
});
```

#### Existing Seed Approach
- **`seed.sql`** — hand-written SQL INSERT statements for `image_reviews` table
- **`scripts/generate-seed.mjs`** — Node.js script that reads JSON → generates `seed.sql`
- **`db:seed` script** — `npx wrangler@latest d1 execute DB --remote --file=seed.sql`

The existing seed is **SQL-based** via wrangler d1 execute.

#### Astro Config
- `srcDir: "./src/frontend"` — Astro only sees `src/frontend/`
- `output: "server"` — SSR mode
- `adapter: cloudflare()` — CF Workers adapter
- React integration enabled
- Tailwind v4 via Vite plugin

#### shadcn/ui Config (components.json)
```json
{
  "style": "base-vega",
  "rsc": false,
  "tsx": true,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

#### TypeScript Path Aliases
```json
"@/*": ["src/frontend/*", "src/backend/*"],
"@frontend/*": ["src/frontend/*"],
"@backend/*": ["src/backend/*"],
"@backend/db": ["src/backend/db/schema/index.ts"],
"@backend/db/*": ["src/backend/db/*"]
```

**⚠️ CRITICAL**: `@backend/db` resolves to `src/backend/db/schema/index.ts` directly. This means ALL table imports MUST go through the barrel file, and the barrel file MUST re-export new tables.

---

## 2. Logic Chain

1. **Schema files** follow a strict pattern: imports from `drizzle-orm` + `drizzle-orm/sqlite-core`, camelCase JS props mapped to snake_case DB columns, standard timestamp columns at the end.

2. **New schema files** MUST be added to `src/backend/db/schema/index.ts` barrel or they won't be importable via `@backend/db`. The `budget_tracking.ts` file demonstrates this: it exists but is unreachable because it's missing from the barrel.

3. **API routes** use `drizzle(c.env.DB)` pattern and import tables from `@backend/db`. New routes MUST be imported and mounted in `api/index.ts`.

4. **Frontend pages** follow the `BaseLayout + React island (client:only="react")` pattern. New pages need sidebar entries in `AppSidebar.tsx`.

5. **Seeding** currently uses SQL files executed via `wrangler d1 execute`. The new budget seed script (`scripts/seed-budget.ts`) has complex data transformations (JSON parsing, FK resolution, deduplication). **Recommendation: TypeScript script** that generates SQL or uses wrangler d1 execute with generated SQL.

6. **Migration generation** is automatic via `drizzle-kit generate` reading the schema barrel file. No manual SQL migration files needed.

---

## 3. Caveats

- **`budget_tracking.ts` is NOT exported** from the barrel — unclear if this is intentional. The new budget tables should not collide with table names `budget_rows`, `sync_sessions`, or `budget_row_revisions`.
- **Two API patterns** coexist (OpenAPIHono vs plain Hono). The PROJECT.md doesn't specify which to use for new routes. The budget-tracker uses plain Hono; consistency suggests new budget routes should too.
- **Two UI patterns** coexist (monolith raw Tailwind vs shadcn/ui). BudgetTrackerApp uses shadcn/ui, suggesting new budget components should follow shadcn/ui.
- The `@/` path alias resolves to BOTH `src/frontend/*` and `src/backend/*` — potential for ambiguous imports if both paths have matching files.

---

## 4. Conclusion

### Integration Checklist

| # | Action | File | Details |
|---|--------|------|---------|
| 1 | Create 9 schema files | `src/backend/db/schema/home/{name}.ts` | Follow exact patterns from §1.1 |
| 2 | Add 9 exports to barrel | `src/backend/db/schema/index.ts` | Add after line 39 (last `home/*` export before images) |
| 3 | Run `pnpm run db:generate` | — | Generates migration SQL in `./drizzle/` |
| 4 | Create seed script | `scripts/seed-budget.ts` | TypeScript script reading `proofs/data/` JSON+TSV |
| 5 | Add `db:seed-budget` script | `package.json` | `"db:seed-budget": "npx tsx scripts/seed-budget.ts"` or SQL approach |
| 6 | Create 4 API route files | `src/backend/api/routes/budget-{data,scenarios,assumptions,snapshot}.ts` | Use plain Hono pattern (matching existing budget-tracker) |
| 7 | Import & mount 4 routers | `src/backend/api/index.ts` | Add imports + `app.route("/api/budget-data", ...)` etc. |
| 8 | Create 5 Astro pages | `src/frontend/pages/{name}.astro` | Follow BaseLayout + client:only pattern |
| 9 | Create 5 React components | `src/frontend/components/{Name}.tsx` | Use shadcn/ui (Card, Badge, Button) pattern |
| 10 | Add sidebar entries | `src/frontend/components/AppSidebar.tsx` | Add to `WORKSPACE_ITEMS` array (line 25-36) |
| 11 | Run `pnpm run cf-typegen` | — | Only if wrangler.jsonc changes (shouldn't be needed for D1 schema changes) |

### Schema File Template (copy-paste ready)

```ts
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Import FK targets if needed:
// import { rooms } from "./rooms";

/**
 * [Table description in JSDoc format]
 */
export const tableName = sqliteTable("table_name", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // ... columns ...
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type TableName = typeof tableName.$inferSelect;
export type TableNameInsert = typeof tableName.$inferInsert;
```

### API Route Template (copy-paste ready)

```ts
import { tableName } from "@backend/db";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const router = new Hono<{ Bindings: Env }>();

router.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(tableName).all();
    return c.json({ data: rows, total: rows.length });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { router as myRouter };
```

### Astro Page Template

```astro
---
import BaseLayout from "@/layouts/BaseLayout.astro";
import { MyComponent } from "@/components/MyComponent";
---

<BaseLayout
  title="Page Title — The Monolith"
  description="Page description for SEO"
>
  <MyComponent client:only="react" />
</BaseLayout>
```

### Seeding Approach Recommendation

**Recommend: TypeScript script that generates SQL → executed via wrangler d1 execute**

Rationale:
1. Existing pattern: `scripts/generate-seed.mjs` generates `seed.sql`
2. Complex data transformations (JSON parsing, TSV parsing, FK resolution) are easier in TS than raw SQL
3. Idempotency: SQL can use `INSERT OR IGNORE` / `INSERT OR REPLACE`
4. The `db:seed` script already uses `npx wrangler@latest d1 execute DB --remote --file=seed.sql`

Proposed approach:
```
scripts/seed-budget.ts  → reads proofs/data/*.json + *.tsv
                        → resolves FKs (floors/rooms lookups)
                        → generates seed-budget.sql
                        → optionally executes via wrangler d1 execute
```

Package.json addition:
```json
"db:seed-budget": "npx tsx scripts/seed-budget.ts && npx wrangler@latest d1 execute DB --remote --file=seed-budget.sql"
```

### Potential Conflicts

| Risk | Description | Mitigation |
|------|-------------|------------|
| Table name collision | `budget_tracking.ts` defines `budget_rows`, `sync_sessions` | New tables use different names per PROJECT.md |
| Missing barrel export | `budget_tracking.ts` is NOT in index.ts | Don't depend on it; add only new tables to barrel |
| Route path collision | `/api/budget-tracker` already exists | New routes use `/api/budget-data`, `/api/budget-scenarios`, etc. |
| Sidebar order | New pages insert into WORKSPACE_ITEMS | Add after existing "Budget Tracker" entry |

---

## 5. Verification Method

### Build Verification
```bash
# After schema changes:
pnpm run db:generate          # Should generate new migration file in ./drizzle/
pnpm run migrate:local        # Test locally first

# After API/frontend changes:
pnpm run build                # Astro build should succeed

# Full deploy test:
pnpm run deploy               # Build → migrate:remote → deploy
```

### Schema Verification
- `drizzle-kit generate` should produce a single migration file with all 9 new tables
- No errors about missing references (all FK targets must exist in barrel)

### Invalidation Conditions
- If `drizzle-kit generate` fails: check that all schema files are exported from `index.ts`
- If `astro build` fails: check that `@/` imports resolve correctly (may need `@frontend/` prefix for ambiguous paths)
- If API returns 500: check that `drizzle(c.env.DB)` has access to the DB binding in `wrangler.jsonc`
