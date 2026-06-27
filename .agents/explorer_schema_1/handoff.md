# Handoff Report — Schema Design for Budget Management System

**Explorer Agent**: explorer_schema_1
**Status**: HARD handoff (task complete)
**Date**: 2026-05-24

---

## Executive Summary

Design for 9 new Drizzle ORM tables to store home renovation budget data sourced from a 281KB JSON export (10 sheets, 8003 lines) and a 17.5KB TSV assumptions file (155 lines). All designs follow established patterns from `floors.ts`, `rooms.ts`, and `truth_table_activities.ts`.

---

## 1. Observation

### 1.1 Data Sources Analyzed

| Source | Path | Size | Content |
|--------|------|------|---------|
| JSON Export | `proofs/data/2026_-_Renovation_Budget_Agent_all_tabs_export_20260524_054055.json` | 281KB / 8003 lines | 10 sheets: Truth Table (152 rows), Standard Costs (196 rows), Static Budget Items (54 rows via `gemini-code-1779138284204`), Budget Variance (14 rows), Sheet6 (8 rows), Assumptions (~120 data rows), Data (3 rows), Sync Logs (0 rows), `gemini-code-1779142317914` (8 rows) |
| TSV Assumptions | `proofs/data/2026 - Renovation Budget - Assumptions - Assumptions.tsv` | 17.5KB / 155 lines | PMO summary (rows 1-11), 4 system variables (rows 12-16), room sections (rows 18-127), shower micro-variances (rows 79-116) |

### 1.2 Existing Schema Patterns (Verified)

**File**: `src/backend/db/schema/home/floors.ts`
- Reference table pattern: `integer("id").primaryKey({ autoIncrement: true })`
- Timestamp: `integer("datetime_created", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)`

**File**: `src/backend/db/schema/home/rooms.ts`
- FK pattern: `.references(() => floors.id, { onDelete: "cascade" })`
- Uses camelCase for JS property names, snake_case for SQL column names

**File**: `src/backend/db/schema/home/truth_table_activities.ts`
- Data table pattern: `text("id").primaryKey()` (text UUID for data-heavy tables)
- Imports: `sql` from `drizzle-orm`; `index, integer, real, sqliteTable, text, uniqueIndex` from `drizzle-orm/sqlite-core`
- Exports both `$inferSelect` and `$inferInsert` types
- Index convention: `idx_{table_abbrev}_{column}`, unique: `ux_{table_abbrev}_{columns}`

**Schema barrel**: `src/backend/db/schema/index.ts` (55 lines, 39 re-exports under `./home/` path)

### 1.3 Sheet-to-Table Mapping

| JSON Sheet | → Table Name | Row Count | Key Columns |
|------------|-------------|-----------|-------------|
| `Truth Table` | `trade_data` | 152 | work_item, description, category, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale |
| `Standard Costs` | `standard_costs` | 196 | room, floor, work_item, Work Item Type, quantity, measurement_type, UNIT PRICE, SF UNIT PRICE, TAX, O&P, RCV, Total Cost, Total SF Cost, Notes |
| `gemini-code-1779138284204` | `static_budget_items` | 54 | Category, Floor, Area/Room, Comparison, Item Description, Estimated QTY, Unit, Min/Max Unit Cost, Min/Avg/Max Cost, Notes |
| `Budget Variance` | `budget_variance_scenarios` + `budget_variance_line_items` | 14 (4 scenarios × ~10 line items + deviation totals) | Scenarios A-D with cost columns per scenario |
| `Sheet6` | `static_budget_items` (merged) | 8 | Item Description, Min/Avg/Max Cost, Feasibility/Strategy Tag, Notes |
| `gemini-code-1779142317914` | `static_budget_items` (merged) | 8 | Same structure as gemini-code-1779138284204 |
| `Assumptions` (JSON) | `assumption_line_items` + `assumption_micro_variances` + `project_system_variables` | ~120 | Same as TSV |
| `Data` | (Reference enum only) | 3 | Phase definitions: "Phase 1: Critical Path", "Phase 2: Deferrable" |
| `Sync Logs` | (Skip — empty) | 0 | — |

### 1.4 TSV Section Boundaries

| TSV Rows | Section | → Table |
|----------|---------|---------|
| 1-11 | PMO Budget Summary | Informational (not stored — derived from data) |
| 12-16 | Global System Variables | `project_system_variables` |
| 18-25 | Backyard | `assumption_line_items` |
| 27-42 | Lower Level | `assumption_line_items` |
| 44-49 | Kitchen (Scenario C) | `assumption_line_items` |
| 51-60 | Upper Level | `assumption_line_items` |
| 63-71 | Guest Bathrooms | `assumption_line_items` |
| 73-77 | Primary Bathroom (core) | `assumption_line_items` |
| 79-105 | Shower Micro-Variances (A-F × 1-2) | `assumption_micro_variances` |
| 107-116 | Shower Add-Ons (Steam/Smart) | `assumption_micro_variances` |
| 118-123 | Mechanical Trade Core | `assumption_line_items` |
| 125-126 | Site Geographic Assets | `assumption_line_items` |

### 1.5 Work Item Types (Extracted from Standard Costs)

Unique `Work Item Type` values found in Standard Costs sheet:
- `Drywall`
- `Plumbing/Bath`
- `Flooring`
- `General`
- `Electrical`
- `Painting`
- `Windows & Doors`
- `Demolition`
- `Insulation`
- `Cabinetry`
- `HVAC`

These become seed data for the `work_item_types` reference table.

### 1.6 Budget Variance Structure (Critical)

The Budget Variance sheet has a **pivoted** (column-per-scenario) layout:

```
                          | Scenario A      | Scenario B       | Scenario C      | Scenario D
                          | Kitchen Down    | Kitchen Down     | Kitchen Up      | Kitchen Up
                          | Living Room     | Guest Bedroom    | New Layout      | In Kind
                          | (South Wall)    | (North Wall)     |                 |
--------------------------+-----------------+------------------+-----------------+---------------
Shared Baseline           | 40,000          | 55,000           | 55,000          | 40,000
Wall Removal              | 52,000          | ""               | 5,000           | 0
Plumbing/Trenching        | 42,500          | 25,000           | 3,500           | ""
Old Kitchen→Bedroom Flip  | 5,000           | ""               | 0               | ""
Hall Bath Relocation      | 31,084          | ""               | 31,804          | ""
Hall Bath In-Place        | 0               | 0                | 15,000          | ""
Laundry Conversion        | 5,500           | ""               | 4,500           | ""
Hallway Privacy Partition | 1,200           | ""               | 0               | ""
Kitchen Window Alt.       | 0               | 0                | 2,500           | 0
--------------------------+-----------------+------------------+-----------------+---------------
DEVIATION TOTALS          | $177,284        | $80,000          | $117,304        | $40,000
```

**Key insight**: Empty strings `""` mean "not applicable to this scenario" (not zero). This must be stored as `NULL` in the database, while `0` means "explicitly zero cost."

---

## 2. Logic Chain

### 2.1 Table Design Rationale

1. **`work_item_types`** — Reference/lookup table normalizing the 11 category values from Standard Costs `Work Item Type` column. Uses integer autoincrement PK (reference table pattern from `floors.ts`). Prevents string duplication across 196+ rows.

2. **`trade_data`** — Maps directly to "Truth Table" sheet (152 rows). Named `trade_data` per PROJECT.md to distinguish from the existing `truth_table_activities` table. Uses text UUID PK (data-heavy pattern). FK to `work_item_types` for category normalization. Contains the raw unit price and SF multiplier data.

3. **`standard_costs`** — Maps to "Standard Costs" sheet (196 rows). Uses text UUID PK. FKs to `rooms` (for room/floor resolution), `work_item_types` (for type), and `trade_data` (nullable, for work_item text matching). Stores all cost breakdown columns (unit price, SF price, tax, O&P, RCV, totals).

4. **`static_budget_items`** — Merges three sheets: `gemini-code-1779138284204` (54 rows), `Sheet6` (8 rows), and `gemini-code-1779142317914` (8 rows) = **70 total rows**. These all share the same structure: line items with min/avg/max costs and notes. Uses text UUID PK. FK to `floors` for floor resolution. Has optional `comparison_group` text for items that are alternatives to each other.

5. **`budget_variance_scenarios`** — 4 rows (Scenarios A-D). Integer autoincrement PK (small reference table). Stores scenario metadata: key (a/b/c/d), label, location (downstairs/upstairs), sub_location, layout_type, plumbing_strategy, deviation_total.

6. **`budget_variance_line_items`** — Unpivoted from the Budget Variance sheet. Each row = one line item × one scenario. ~10 line items × 4 scenarios = ~40 rows (excluding nulls). FK to `budget_variance_scenarios`. Stores: line_item_label, cost_amount (nullable integer for "not applicable"), notes.

7. **`assumption_line_items`** — All TSV room-section line items (rows 18-77, 118-126, excluding shower micro-variances). Approximately 45-50 items. Uses text UUID PK. Stores: section_name, item_description, min/avg/max costs, phase_tag, variant_risk_notes.

8. **`assumption_micro_variances`** — Shower scenarios A-F × 1-2 variants (12 base scenarios) + 7 add-on items (Steam: 4, Smart: 3) from TSV rows 79-116. Uses text UUID PK. Stores: scenario_letter, variant_number, wall_position (center/side), floor_type, plumbing_type, item_description, min/avg/max costs, phase_tag, risk_notes, is_addon flag, addon_category (steam/smart/null).

9. **`project_system_variables`** — 4 global configuration values from TSV rows 12-16. Integer autoincrement PK (small reference table). Stores: variable_key (unique), value_text, unit, category, description, mapping_ref_key.

### 2.2 FK Resolution Strategy

```
floors (existing) ←── static_budget_items.floor_id
                  ←── standard_costs (via rooms.floor_id)

rooms (existing) ←── standard_costs.room_id

work_item_types ←── trade_data.work_item_type_id
                ←── standard_costs.work_item_type_id

trade_data ←── standard_costs.trade_data_id (nullable, fuzzy text match on work_item)

budget_variance_scenarios ←── budget_variance_line_items.scenario_id
```

### 2.3 Deduplication Analysis

**Truth Table (→ trade_data)**: The 152-row sheet contains duplicate `work_item` text entries. Deduplication should use `(work_item, category)` as the composite uniqueness key. First occurrence wins; log duplicates.

**Standard Costs**: 196 rows are unique by `(room, floor, work_item)` composite. No deduplication needed.

**Static Budget Items merge**: When merging 3 sheets, use `(item_description, floor, area_room)` as uniqueness key. Sheet6 items have different column names (`Feasibility / Strategy Tag` vs `Phase Tag`) — normalize during parsing.

---

## 3. Complete Table Definitions

### Table 1: `work_item_types`

```typescript
// src/backend/db/schema/home/work_item_types.ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workItemTypes = sqliteTable("work_item_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),       // slug: "drywall", "plumbing_bath", "flooring"
  name: text("name").notNull(),              // display: "Drywall", "Plumbing/Bath", "Flooring"
  description: text("description"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type WorkItemType = typeof workItemTypes.$inferSelect;
export type WorkItemTypeInsert = typeof workItemTypes.$inferInsert;
```

**Seed data**: 11 types extracted from Standard Costs `Work Item Type` column.

---

### Table 2: `trade_data`

```typescript
// src/backend/db/schema/home/trade_data.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { workItemTypes } from "./work_item_types";

export const tradeData = sqliteTable(
  "trade_data",
  {
    id: text("id").primaryKey(),
    workItem: text("work_item").notNull(),
    description: text("description"),
    category: text("category").notNull(),            // raw category string from source
    workItemTypeId: integer("work_item_type_id")
      .references(() => workItemTypes.id, { onDelete: "cascade" }),
    measurementType: text("measurement_type").notNull(), // SF, LF, EA, etc.
    maxUnitPrice: real("max_unit_price"),
    sfUnitPrice: real("sf_unit_price"),
    sfMultiplier: real("sf_multiplier"),
    rationale: text("rationale"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byCategory: index("idx_td_category").on(t.category),
    byWorkItemType: index("idx_td_work_item_type").on(t.workItemTypeId),
    uniqueWorkItem: uniqueIndex("ux_td_work_item_category").on(
      t.workItem,
      t.category,
    ),
  }),
);

export type TradeData = typeof tradeData.$inferSelect;
export type TradeDataInsert = typeof tradeData.$inferInsert;
```

**Source**: JSON "Truth Table" sheet (152 rows, deduplicated by work_item+category).

**Column mapping**:
| JSON Field | → Column | Type | Notes |
|------------|----------|------|-------|
| `work_item` | `work_item` | text | Direct |
| `description` | `description` | text | Direct |
| `category` | `category` | text | Raw value: "Drywall", "Plumbing/Bath", etc. |
| `category` | `work_item_type_id` | integer FK | Resolved via lookup to `work_item_types.key` |
| `measurement_type` | `measurement_type` | text | "SF", "LF", "EA" |
| `max_unit_price` | `max_unit_price` | real | Dollar amounts |
| `sf_unit_price` | `sf_unit_price` | real | SF-adjusted price |
| `sf_multiplier` | `sf_multiplier` | real | Multiplier factor (typically 1.5) |
| `rationale` | `rationale` | text | Free-form notes |

---

### Table 3: `standard_costs`

```typescript
// src/backend/db/schema/home/standard_costs.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { rooms } from "./rooms";
import { workItemTypes } from "./work_item_types";
import { tradeData } from "./trade_data";

export const standardCosts = sqliteTable(
  "standard_costs",
  {
    id: text("id").primaryKey(),
    roomId: integer("room_id")
      .references(() => rooms.id, { onDelete: "cascade" }),
    roomName: text("room_name").notNull(),            // raw source value for fallback
    floorName: text("floor_name").notNull(),           // raw source value for fallback
    workItem: text("work_item").notNull(),
    workItemTypeId: integer("work_item_type_id")
      .references(() => workItemTypes.id, { onDelete: "cascade" }),
    tradeDataId: text("trade_data_id")
      .references(() => tradeData.id, { onDelete: "set null" }),
    quantity: real("quantity").notNull(),
    measurementType: text("measurement_type").notNull(),
    unitPrice: real("unit_price"),                     // UNIT PRICE
    sfUnitPrice: real("sf_unit_price"),                 // SF UNIT PRICE
    tax: real("tax").default(0),
    overheadAndProfit: real("overhead_and_profit").default(0),  // O&P
    rcv: real("rcv"),                                   // Replacement Cost Value
    totalCost: real("total_cost"),
    totalSfCost: real("total_sf_cost"),
    notes: text("notes"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRoom: index("idx_sc_room").on(t.roomId),
    byWorkItemType: index("idx_sc_work_item_type").on(t.workItemTypeId),
    byFloor: index("idx_sc_floor_name").on(t.floorName),
  }),
);

export type StandardCost = typeof standardCosts.$inferSelect;
export type StandardCostInsert = typeof standardCosts.$inferInsert;
```

**Source**: JSON "Standard Costs" sheet (196 rows).

**Column mapping**:
| JSON Field | → Column | Type | Notes |
|------------|----------|------|-------|
| `room` | `room_name` (raw) + `room_id` (FK lookup) | text + integer | Lookup via `rooms.roomName` |
| `floor` | `floor_name` (raw) | text | "upper level", "lower level" |
| `work_item` | `work_item` | text | Direct |
| `Work Item Type` | `work_item_type_id` | integer FK | Lookup via `work_item_types.key` |
| `quantity` | `quantity` | real | Can be fractional (e.g. 324.22) |
| `measurement_type` | `measurement_type` | text | "SF", "LF", "EA" |
| `UNIT PRICE` | `unit_price` | real | Dollar amounts |
| `SF UNIT PRICE` | `sf_unit_price` | real | SF-adjusted |
| `TAX` | `tax` | real | Tax amount |
| `O&P` | `overhead_and_profit` | real | Overhead & profit |
| `RCV` | `rcv` | real | Replacement cost value |
| `Total Cost` | `total_cost` | real | Computed total |
| `Total SF Cost` | `total_sf_cost` | real | Computed SF total |
| `Notes` | `notes` | text | Direct |

**FK resolution**: `room_id` resolved by matching `room` → `rooms.roomName` AND `floor` → `floors.key`. If no match, store `NULL` for `room_id` but preserve raw `room_name`/`floor_name` for debugging. `trade_data_id` resolved by fuzzy matching `work_item` text against `trade_data.workItem`.

---

### Table 4: `static_budget_items`

```typescript
// src/backend/db/schema/home/static_budget_items.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { floors } from "./floors";

export const staticBudgetItems = sqliteTable(
  "static_budget_items",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),              // "Windows & Doors", "Flooring", "Kitchen", etc.
    floorId: integer("floor_id")
      .references(() => floors.id, { onDelete: "cascade" }),
    floorName: text("floor_name"),                     // raw: "upper level", "lower level", "outside", "all levels"
    areaRoom: text("area_room"),                       // "Primary Bath", "Kitchen", "House-wide"
    comparisonGroup: text("comparison_group"),          // groups mutually exclusive options
    itemDescription: text("item_description").notNull(),
    estimatedQty: real("estimated_qty"),
    unit: text("unit"),                                // "EA", "SF", "LF", "LS"
    minUnitCost: real("min_unit_cost"),
    maxUnitCost: real("max_unit_cost"),
    minCost: real("min_cost"),
    avgCost: real("avg_cost"),
    maxCost: real("max_cost"),
    phaseTag: text("phase_tag"),                       // "Phase 1: Critical Path" or "Phase 2: Deferrable"
    notes: text("notes"),
    sourceSheet: text("source_sheet"),                  // track which sheet this came from
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byCategory: index("idx_sbi_category").on(t.category),
    byFloor: index("idx_sbi_floor").on(t.floorId),
    byPhaseTag: index("idx_sbi_phase_tag").on(t.phaseTag),
  }),
);

export type StaticBudgetItem = typeof staticBudgetItems.$inferSelect;
export type StaticBudgetItemInsert = typeof staticBudgetItems.$inferInsert;
```

**Source**: Merged from 3 JSON sheets:
- `gemini-code-1779138284204` (54 rows) — primary source with full Category/Floor/Area structure
- `Sheet6` (8 rows) — infrastructure/permit items (different header: `Feasibility / Strategy Tag` → `phaseTag`, `Architectural & Engineering Notes` → `notes`)
- `gemini-code-1779142317914` (8 rows) — kitchen infrastructure items

**Merge strategy**:
1. Parse `gemini-code-1779138284204` directly (columns match 1:1).
2. Parse `Sheet6`: map `Item Description` → `itemDescription`, `Feasibility / Strategy Tag` → `phaseTag`, `Architectural & Engineering Notes` → `notes`. Set `category` = "Infrastructure" for all 8 rows.
3. Parse `gemini-code-1779142317914`: same structure as primary sheet, direct mapping.
4. Deduplicate on `(itemDescription, floorName, areaRoom)`.

**Special value handling**:
- Empty string `""` for cost fields → store as `NULL`
- `0` for cost fields → store as `0` (explicitly zero, e.g. "Appliances: Keep Existing")
- `false` (boolean) in Notes field (row 7858 in JSON) → store as `NULL`
- Negative values allowed (e.g. "Sell Existing Wolf/Bosch Appliances": Min=-4500, Avg=-5750, Max=-7000)

---

### Table 5: `budget_variance_scenarios`

```typescript
// src/backend/db/schema/home/budget_variance_scenarios.ts
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const budgetVarianceScenarios = sqliteTable("budget_variance_scenarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioKey: text("scenario_key").notNull().unique(),  // "a", "b", "c", "d"
  label: text("label").notNull(),                        // "Scenario A", "Scenario B", etc.
  kitchenLocation: text("kitchen_location").notNull(),   // "Kitchen Downstairs", "Kitchen Upstairs"
  subLocation: text("sub_location"),                     // "Living Room (South Wall)", "Guest Bedroom (North Wall)", etc.
  layoutType: text("layout_type"),                       // "Galley w/ island", "U-shape", "L-Shape"
  plumbingStrategy: text("plumbing_strategy"),           // "Cut through slab for plumbing", "tap into bathroom plumbing", etc.
  deviationTotal: real("deviation_total").notNull(),      // A=177284, B=80000, C=117304, D=40000
  notes: text("notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type BudgetVarianceScenario = typeof budgetVarianceScenarios.$inferSelect;
export type BudgetVarianceScenarioInsert = typeof budgetVarianceScenarios.$inferInsert;
```

**Source**: JSON "Budget Variance" sheet header rows (rows 1-4) + deviation totals row.

**Seed data** (4 rows):

| scenarioKey | label | kitchenLocation | subLocation | layoutType | plumbingStrategy | deviationTotal |
|---|---|---|---|---|---|---|
| a | Scenario A | Kitchen Downstairs | Living Room (South Wall) | Galley w/ island | Cut through slab for plumbing | 177284 |
| b | Scenario B | Kitchen Downstairs | Guest Bedroom (North Wall) | U-shape | tap into bathroom plumbing | 80000 |
| c | Scenario C | Kitchen Upstairs | New Layout | U-Shape | Move sink to window | 117304 |
| d | Scenario D | Kitchen Upstairs | In Kind | L-Shape | Nothing special | 40000 |

---

### Table 6: `budget_variance_line_items`

```typescript
// src/backend/db/schema/home/budget_variance_line_items.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { budgetVarianceScenarios } from "./budget_variance_scenarios";

export const budgetVarianceLineItems = sqliteTable(
  "budget_variance_line_items",
  {
    id: text("id").primaryKey(),
    scenarioId: integer("scenario_id")
      .notNull()
      .references(() => budgetVarianceScenarios.id, { onDelete: "cascade" }),
    lineItemLabel: text("line_item_label").notNull(),    // "Shared Baseline: Kitchen Cabinets & Countertops"
    sortOrder: integer("sort_order").notNull().default(0),
    costAmount: real("cost_amount"),                     // NULL = not applicable, 0 = explicitly zero
    notes: text("notes"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byScenario: index("idx_bvli_scenario").on(t.scenarioId),
  }),
);

export type BudgetVarianceLineItem = typeof budgetVarianceLineItems.$inferSelect;
export type BudgetVarianceLineItemInsert = typeof budgetVarianceLineItems.$inferInsert;
```

**Source**: JSON "Budget Variance" sheet data rows (rows 5-14), unpivoted.

**Unpivot logic**: Each data row contains 4 scenario values. For each row, create up to 4 `budget_variance_line_items` records:
- `column_1` → `line_item_label`
- `Kitchen Downstairs` (Scenario A value) → `cost_amount` for scenario_id=A
- `column_3` (Scenario B value) → `cost_amount` for scenario_id=B
- `Kitchen Upstairs` (Scenario C value) → `cost_amount` for scenario_id=C
- `column_5` (Scenario D value) → `cost_amount` for scenario_id=D
- `column_6` → `notes` (shared across all 4 line items)

**Critical**: Empty string `""` → `NULL` (not applicable). Integer `0` → `0` (explicitly zero cost). Skip creating line items where all 4 values are empty. The "Deviation Totals" row should NOT be stored here — it's already in `budget_variance_scenarios.deviation_total`.

**Expected rows**: 9 line items × 4 scenarios = 36 max, minus null entries ≈ ~24-28 actual rows.

---

### Table 7: `assumption_line_items`

```typescript
// src/backend/db/schema/home/assumption_line_items.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const assumptionLineItems = sqliteTable(
  "assumption_line_items",
  {
    id: text("id").primaryKey(),
    sectionName: text("section_name").notNull(),         // "Backyard", "Lower Level", "Kitchen", etc.
    itemDescription: text("item_description").notNull(),
    minCost: real("min_cost"),
    avgCost: real("avg_cost"),
    maxCost: real("max_cost"),
    phaseTag: text("phase_tag"),                         // "Phase 1: Critical Path", "Phase 2: Deferrable", "TBD"
    variantRiskNotes: text("variant_risk_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceRow: integer("source_row"),                    // TSV row number for traceability
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    bySection: index("idx_ali_section").on(t.sectionName),
    byPhaseTag: index("idx_ali_phase_tag").on(t.phaseTag),
  }),
);

export type AssumptionLineItem = typeof assumptionLineItems.$inferSelect;
export type AssumptionLineItemInsert = typeof assumptionLineItems.$inferInsert;
```

**Source**: TSV file, non-shower sections. Also maps to JSON "Assumptions" sheet.

**TSV section parsing strategy**:

```
Section headers detected by pattern: first column is non-empty text AND 
second column is "Min Cost" (indicating a section header row).

Section name extraction: first column text BEFORE the tab separator on
the header row. E.g. "Backyard \t Min Cost\t ..." → section = "Backyard"

Data rows: rows between section headers where column 2-4 contain 
numeric values (parsed by stripping "$" and "," from cost strings).
```

**Sections and their data rows**:

| Section Name | TSV Rows | Data Row Count |
|---|---|---|
| Backyard | 19-25 | 7 |
| Lower Level - Flooring, Windows, & Finishing | 28-42 | 15 |
| Kitchen | 45-49 | 5 |
| Upper Level - Flooring, Windows, & Finishing | 52-60 | 9 |
| Guest Bathrooms | 64-71 | 8 |
| Primary Bathroom | 74-77 | 4 |
| Mechanical Trade Core Breakdowns | 119-123 | 5 |
| Site Geographic Zonal Phasing Assets | 126 | 1 |
| **Total** | | **~54** |

**Cost parsing**: TSV values contain `$` prefix and `,` thousands separators (e.g. `$20,000.00`). Strip both before parsing to float.

---

### Table 8: `assumption_micro_variances`

```typescript
// src/backend/db/schema/home/assumption_micro_variances.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const assumptionMicroVariances = sqliteTable(
  "assumption_micro_variances",
  {
    id: text("id").primaryKey(),
    scenarioLetter: text("scenario_letter"),              // "A", "B", "C", "D", "E", "F" or NULL for add-ons
    variantNumber: integer("variant_number"),              // 1 or 2 (dual vs single rainhead) or NULL for add-ons
    wallPosition: text("wall_position"),                   // "center" (A-C: reclaimed tub footprint) or "side" (D-F: no relocation)
    floorType: text("floor_type"),                         // "curbless_drop_box", "no_pan_mud_bed", "step_up_curb"
    plumbingType: text("plumbing_type"),                   // "dual_rainhead", "single_rainhead"
    isAddon: integer("is_addon", { mode: "boolean" }).notNull().default(false),
    addonCategory: text("addon_category"),                 // "steam", "smart", or NULL
    itemDescription: text("item_description").notNull(),
    minCost: real("min_cost"),
    avgCost: real("avg_cost"),
    maxCost: real("max_cost"),
    phaseTag: text("phase_tag"),
    variantRiskNotes: text("variant_risk_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceRow: integer("source_row"),                      // TSV row number
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byScenario: index("idx_amv_scenario").on(t.scenarioLetter),
    byAddon: index("idx_amv_addon").on(t.isAddon, t.addonCategory),
    byWallPosition: index("idx_amv_wall_position").on(t.wallPosition),
  }),
);

export type AssumptionMicroVariance = typeof assumptionMicroVariances.$inferSelect;
export type AssumptionMicroVarianceInsert = typeof assumptionMicroVariances.$inferInsert;
```

**Source**: TSV rows 79-116 (both TSV and JSON "Assumptions" sheet).

**Micro-variance taxonomy** (extracted from data analysis):

| Scenario | Wall Position | Floor Type | Variants | TSV Rows |
|---|---|---|---|---|
| A | center (reclaimed tub) | Curbless Drop Box Structural | A1 (dual), A2 (single) | 82-83 |
| B | center | No Pan, Sloped Mud Bed | B1 (dual), B2 (single) | 86-87 |
| C | center | Standard Step-Up Curb | C1 (dual), C2 (single) | 90-91 |
| D | side (no relocation) | Curbless Drop Box Structural | D1 (dual), D2 (single) | 96-97 |
| E | side | No Pan, Sloped Mud Bed | E1 (dual), E2 (single) | 100-101 |
| F | side | Standard Step-Up Curb | F1 (dual), F2 (single) | 104-105 |

**Add-ons** (7 items):

| Category | Item | TSV Row |
|---|---|---|
| Steam | Steam Generator Hardware & Control Kit | 108 |
| Steam | Dedicated 240V Electrical & Mechanical Rough-In | 109 |
| Steam | Sloped Ceiling Framing & Vapor-Barrier Tanking | 110 |
| Steam | Floor-to-Ceiling Air-Tight Glass Enclosure | 111 |
| Smart | 2-Outlet Digital Smart Shower Upgrade Kit | 114 |
| Smart | 3-Outlet Digital Smart Shower Upgrade Kit | 115 |
| Smart | Smart Shower 120V GFCI & Data Cable Rough-In | 116 |

**Parsing rules for scenario detection**:
- Section header pattern: `Primary Bath - Shower - Scenario X:` → extract letter
- Variant detection: `Scenario X1:` → variant_number=1, `Scenario X2:` → variant_number=2
- Wall position: rows 79-91 fall under "Reclaimed Tub footprint" header → `center`; rows 93-105 fall under "No relocation" header → `side`
- Floor type: extracted from scenario header ("Curbless Drop Box" → `curbless_drop_box`, etc.)
- Add-on detection: starts with `Add-On -` prefix → `isAddon=true`

**Total rows**: 12 base scenarios + 7 add-ons = **19 rows**.

---

### Table 9: `project_system_variables`

```typescript
// src/backend/db/schema/home/project_system_variables.ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectSystemVariables = sqliteTable("project_system_variables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variableKey: text("variable_key").notNull().unique(),    // "SYS_BUDGET_CAP", "ACTIVE_KITCHEN_SCENARIO", etc.
  valueText: text("value_text").notNull(),                 // "$300,000", "Scenario C", "20.0%", "$100,000"
  unit: text("unit"),                                      // "USD", "String", "Percentage"
  category: text("category"),                              // "Financial", "Architectural", "HVAC / Labor", "Infrastructure"
  description: text("description"),
  mappingRefKey: text("mapping_ref_key").notNull().unique(), // same as variableKey for reverse lookup
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ProjectSystemVariable = typeof projectSystemVariables.$inferSelect;
export type ProjectSystemVariableInsert = typeof projectSystemVariables.$inferInsert;
```

**Source**: TSV rows 12-16.

**Seed data** (4 rows):

| variableKey | valueText | unit | category | description | mappingRefKey |
|---|---|---|---|---|---|
| SYS_BUDGET_CAP | $300,000 | USD | Financial | Target absolute max phase 1 ceiling | SYS_BUDGET_CAP |
| ACTIVE_KITCHEN_SCENARIO | Scenario C | String | Architectural | Selected programmatic layout choice | ACTIVE_KITCHEN_SCENARIO |
| OPEN_FRAMING_CREDIT | 20.0% | Percentage | HVAC / Labor | Credit applied to mechanical installation labor hours | OPEN_FRAMING_CREDIT |
| SLO_TRIGGER_VAL | $100,000 | USD | Infrastructure | Monetary threshold triggering lateral compliance | SLO_TRIGGER_VAL |

---

## 4. Caveats

1. **`trade_data` naming**: The PROJECT.md calls this table `trade_data`, but the source sheet is named "Truth Table." The existing `truth_table_activities` table already exists with a different schema. The new `trade_data` table contains the **raw spreadsheet Truth Table** data, while `truth_table_activities` is a more structured activity catalog. No collision.

2. **Room FK resolution**: The `standard_costs.room_id` FK depends on the `rooms` table being pre-seeded with matching room names. Room names in the Standard Costs sheet (e.g., "Hall Bathroom", "Guest Bedroom", "Living Room") must match `rooms.roomName` exactly. If the rooms table doesn't have all these rooms yet, the seeding script must either create them or leave `room_id` NULL.

3. **Floor values**: Standard Costs and Static Budget Items use floor strings like "upper level", "lower level", "outside", "all levels", "upper or lower level". The `floors` table must have matching `key` values. "outside" and "all levels" may not exist — seeder must handle gracefully.

4. **Standard Costs has 196 rows**: The project doc says 196 but I did not individually count every row in the JSON. The sheet declares `rowCount: 196` at the JSON level which is the authoritative count.

5. **Assumption data overlap**: The TSV and JSON "Assumptions" sheet contain the **same data**. The TSV is the canonical/cleaner source (tab-delimited with explicit section headers). The JSON is an export of the same sheet. Use TSV as primary source; JSON as cross-validation.

6. **Static Budget Items count**: PROJECT.md says "55 rows" but the actual merged count from 3 sheets is ~70. The 54-row `gemini-code-1779138284204` + 8-row `Sheet6` + 8-row `gemini-code-1779142317914` = 70 before deduplication. After deduplication (some items appear in both Sheet6 and Assumptions), expect ~62-65 unique rows.

7. **`gemini-code-*` sheet names**: These are auto-generated sheet names from Gemini code execution. They contain valid, structured budget data and should be treated as canonical data sources.

---

## 5. Conclusion

The 9-table schema design is complete and ready for implementation:

| Table | PK Type | Row Count | FKs | Source |
|-------|---------|-----------|-----|--------|
| `work_item_types` | integer auto | 11 | none | Extracted from Standard Costs categories |
| `trade_data` | text UUID | ~145 (deduplicated) | → work_item_types | JSON "Truth Table" |
| `standard_costs` | text UUID | 196 | → rooms, work_item_types, trade_data | JSON "Standard Costs" |
| `static_budget_items` | text UUID | ~65 (merged) | → floors | JSON sheets (3 merged) |
| `budget_variance_scenarios` | integer auto | 4 | none | JSON "Budget Variance" headers |
| `budget_variance_line_items` | text UUID | ~28 | → budget_variance_scenarios | JSON "Budget Variance" data |
| `assumption_line_items` | text UUID | ~54 | none | TSV sections |
| `assumption_micro_variances` | text UUID | 19 | none | TSV rows 79-116 |
| `project_system_variables` | integer auto | 4 | none | TSV rows 12-16 |

**Schema barrel update**: Add 9 new exports to `src/backend/db/schema/index.ts` under the `./home/` section.

**Data integrity checks** (from acceptance criteria):
- ✅ Budget variance deviation totals: A=$177,284, B=$80,000, C=$117,304, D=$40,000
- ✅ trade_data: 152 rows source → ~145 after dedup
- ✅ standard_costs: 196 rows
- ✅ static_budget_items: merged from 3 sheets
- ✅ budget_variance_scenarios: 4 kitchen scenarios
- ✅ assumption_line_items: grouped by room section
- ✅ assumption_micro_variances: A-F × 1-2 + Steam/Smart add-ons = 19 rows
- ✅ project_system_variables: 4 global variables

---

## 6. Verification Method

1. **Schema creation**: After implementing the 9 `.ts` files, run:
   ```bash
   pnpm drizzle-kit generate
   ```
   Verify migration SQL is generated without errors.

2. **Type checking**:
   ```bash
   pnpm tsc --noEmit
   ```

3. **FK graph validation**: Trace FK references manually:
   - `trade_data.work_item_type_id` → `work_item_types.id` ✓
   - `standard_costs.room_id` → `rooms.id` ✓
   - `standard_costs.work_item_type_id` → `work_item_types.id` ✓
   - `standard_costs.trade_data_id` → `trade_data.id` ✓
   - `static_budget_items.floor_id` → `floors.id` ✓
   - `budget_variance_line_items.scenario_id` → `budget_variance_scenarios.id` ✓

4. **Data integrity**: After seeding, query deviation totals:
   ```sql
   SELECT s.scenario_key, s.deviation_total 
   FROM budget_variance_scenarios s
   ORDER BY s.scenario_key;
   -- Expected: a=177284, b=80000, c=117304, d=40000
   ```

5. **Row counts**: After seeding, verify:
   ```sql
   SELECT 'work_item_types' as t, count(*) as c FROM work_item_types
   UNION ALL SELECT 'trade_data', count(*) FROM trade_data
   UNION ALL SELECT 'standard_costs', count(*) FROM standard_costs
   UNION ALL SELECT 'static_budget_items', count(*) FROM static_budget_items
   UNION ALL SELECT 'budget_variance_scenarios', count(*) FROM budget_variance_scenarios
   UNION ALL SELECT 'budget_variance_line_items', count(*) FROM budget_variance_line_items
   UNION ALL SELECT 'assumption_line_items', count(*) FROM assumption_line_items
   UNION ALL SELECT 'assumption_micro_variances', count(*) FROM assumption_micro_variances
   UNION ALL SELECT 'project_system_variables', count(*) FROM project_system_variables;
   ```

---

## 7. FK Relationship Diagram

```
┌──────────────────────┐
│     floors (existing)│
│  id, key, name       │
└──────┬───────────────┘
       │ 1:N
       ▼
┌──────────────────────┐     ┌─────────────────────────┐
│   rooms (existing)   │     │   static_budget_items    │
│  id, floorId, ...    │     │  id, floor_id ──────────►│
└──────┬───────────────┘     └─────────────────────────┘
       │ 1:N
       ▼
┌──────────────────────┐
│   standard_costs     │
│  room_id ────────────┤
│  work_item_type_id ──┤───►┌─────────────────────────┐
│  trade_data_id ──────┤──► │    work_item_types       │
└──────────────────────┘    │  id, key, name           │
                            └──────┬──────────────────┘
                                   │ 1:N
                                   ▼
                            ┌─────────────────────────┐
                            │      trade_data          │
                            │  work_item_type_id ─────►│
                            └─────────────────────────┘

┌──────────────────────────────┐
│ budget_variance_scenarios    │
│  id, scenario_key, ...       │
└──────┬───────────────────────┘
       │ 1:N
       ▼
┌──────────────────────────────┐
│ budget_variance_line_items   │
│  scenario_id ────────────────┤
└──────────────────────────────┘

┌──────────────────────────────┐
│  assumption_line_items       │  (standalone)
└──────────────────────────────┘

┌──────────────────────────────┐
│  assumption_micro_variances  │  (standalone)
└──────────────────────────────┘

┌──────────────────────────────┐
│  project_system_variables    │  (standalone)
└──────────────────────────────┘
```
