# Phase 2: CSV Ingestion & Budget Reconciliation

## Overview

Phase 2 extends the Apps Script integration with a comprehensive CSV ingestion system that includes:

1. **CSV Ingestion Endpoint** - Accepts remodelum.com format exports
2. **Delta Analysis Engine** - Compares CSV data against existing D1 records with transaction isolation
3. **Workers AI Validation** - Validates cost estimates and category classifications
4. **Real-time WebSocket Telemetry** - Broadcasts budget updates to connected clients
5. **Shadcn UI Reconciliation Workspace** - Interactive UI with "The Monolith" design system

## Architecture

### Backend Components

#### 1. CSV Ingestion Route (`src/backend/api/routes/csv-ingestion.ts`)

**Endpoint**: `POST /api/budget-tracker/csv-ingestion`

**Request Schema**:

```typescript
{
  rows: Array<{
    Type: string;
    Category: string;
    Name: string;
    Cost: string | number;
    Description: string;
  }>;
  sourceRef?: string;
  changedBy?: string;
  dryRun?: boolean;
  validateWithAI?: boolean;
}
```

**Response Schema**:

```typescript
{
  success: boolean;
  dryRun: boolean;
  summary: {
    totalRows: number;
    newItems: number;
    updatedItems: number;
    unchangedItems: number;
    conflicts: number;
    aiValidated: number;
  };
  deltas: DeltaResult[];
  transactionId?: string;
  errors?: Array<{ rowIndex: number; error: string }>;
}
```

**Features**:

- Full Zod validation for type safety
- OpenAPI documentation via `@hono/zod-openapi`
- Transaction isolation for batch operations
- Dry-run mode for preview before applying changes
- Optional Workers AI validation

#### 2. Delta Analysis Engine

The delta analysis engine compares incoming CSV rows against existing D1 records:

**Delta States**:

- `new` - Item doesn't exist in database
- `updated` - Item exists but has changes
- `unchanged` - Item exists with identical values
- `conflict` - Item has conflicting changes (reserved for future use)

**Process**:

1. Parse and validate CSV rows with Zod
2. For each row, query D1 for matching records (by item name)
3. Compare fields and detect changes
4. Optionally validate with Workers AI
5. Return comprehensive delta analysis
6. Apply changes with transaction isolation (if not dry-run)

#### 3. Workers AI Validation Pipeline

Uses `@cf/meta/llama-3.1-8b-instruct` to validate budget items:

**Validation Checks**:

- Is this a reasonable budget item?
- Is the category appropriate?
- Is the cost reasonable for this type of item?
- Suggest better category if current seems wrong
- Provide rationale for assessment

**AI Response**:

```typescript
{
  validated: boolean;
  categoryConfidence: number; // 0-1
  costReasonable: boolean;
  suggestedCategory: string;
  rationale: string;
}
```

#### 4. Real-time WebSocket Telemetry

**Endpoint**: `GET /api/budget-tracker/realtime`

Upgrades to WebSocket connection using the existing `ESTIMATE_COLLAB` Durable Object with room name "budget".

**Event Broadcasting**:

- `csv.ingestion.completed` - Fired after successful CSV import
- `budget.item.created` - New item created
- `budget.item.revised` - Item updated
- `budget.expense.created` - New expense created
- `budget.expense.revised` - Expense updated

### Frontend Components

#### Budget Reconciliation Workspace (`src/frontend/components/BudgetReconciliationApp.tsx`)

**Features**:

- CSV file upload with drag-and-drop
- Real-time WebSocket connection for live updates
- Dry-run mode to preview changes before applying
- Toggle for AI validation
- Comprehensive delta visualization with status icons
- Summary statistics dashboard
- "The Monolith" design system:
  - Base background: `oklch(0.145 0 0)` (#12111A)
  - Zinc topography for surface variations
  - No traditional borders - uses `ring-1 ring-border/40`
  - Translucent overlays for depth

**Page Route**: `/budget-reconciliation`

## Database Schema

Uses existing schemas:

- `budgetTrackerItems` - Main budget line items with revision tracking
- `budgetExpenseEntries` - Actual expenses with revision tracking
- `budgetRows` - Apps Script sync schema (simple)
- `budgetRowRevisions` - Revision history for Apps Script sync

## Usage Guide

### 1. Export CSV from remodelum.com

Ensure CSV has the following columns:

- `Type` - "expense" or project type
- `Category` - Budget category
- `Name` - Item name/title
- `Cost` - Cost amount (numeric or currency string)
- `Description` - Optional description

### 2. Import via Reconciliation Workspace

1. Navigate to `/budget-reconciliation`
2. Upload CSV file
3. Enable AI validation (optional but recommended)
4. Click "Dry Run (Preview)" to analyze changes
5. Review delta analysis
6. Click "Apply Changes" to commit to database

### 3. Monitor Real-time Updates

The realtime telemetry panel shows all budget events as they occur across the system.

## API Documentation

Full OpenAPI documentation is available at `/` (root) via Scalar API Reference.

The CSV ingestion endpoint is fully documented with:

- Request/response schemas
- Example payloads
- Error responses
- Validation rules

## Transaction Safety

All database operations use Drizzle ORM with transaction isolation:

```typescript
await db.batch([...operations]);
```

**Revision Tracking**:

- All updates create new revisions instead of modifying existing records
- Previous revisions are marked inactive with `replacedAt` timestamp
- Full audit trail maintained
- Ability to view historical changes via `/items/:trackId/revisions`

## Error Handling

- Individual row errors don't fail entire batch
- Errors reported per-row in response
- Transaction rollback on critical failures
- Graceful AI validation fallback

## Performance Considerations

- Batch operations for multiple rows
- Parallel AI validation when enabled
- WebSocket fan-out via Durable Objects
- Delta analysis before DB writes (avoids unnecessary updates)

## Future Enhancements

- Conflict resolution strategies
- Undo/redo for imports
- Scheduled imports via Cron Triggers
- Export reconciliation reports
- Multi-user collaboration with optimistic locking

## Testing

Manual testing checklist:

1. ✅ CSV upload and parsing
2. ✅ Delta analysis accuracy
3. ✅ Dry-run mode (no DB changes)
4. ✅ Apply changes mode (DB updates)
5. ✅ AI validation responses
6. ✅ WebSocket connectivity
7. ✅ Real-time event broadcasting
8. ✅ UI responsiveness
9. ✅ Error handling
10. ✅ Transaction isolation

## Related Files

- `/src/backend/api/routes/csv-ingestion.ts` - CSV ingestion endpoint
- `/src/backend/api/routes/budget-tracker.ts` - Budget tracker routes + WebSocket endpoint
- `/src/backend/api/index.ts` - API router mounting
- `/src/frontend/components/BudgetReconciliationApp.tsx` - React UI component
- `/src/frontend/pages/budget-reconciliation.astro` - Page route
- `/src/backend/realtime/publish.ts` - Realtime event publishing utility
- `/src/backend/realtime/EstimateCollabHub.ts` - WebSocket Durable Object

## Design System

**The Monolith** theme applied throughout:

```css
/* Base canvas */
background: oklch(0.145 0 0); /* #12111A */

/* Surface variations */
bg-zinc-900/50 ring-1 ring-border/40  /* Primary surfaces */
bg-zinc-800/50 ring-1 ring-border/40  /* Secondary surfaces */
bg-zinc-800 ring-1 ring-border/40     /* Interactive elements */

/* Status colors */
text-green-400 ring-green-700/40      /* New items */
text-yellow-400 ring-yellow-700/40    /* Updated items */
text-red-400 ring-red-700/40          /* Conflicts */
text-purple-400 ring-purple-700/40    /* AI validated */
text-zinc-500                          /* Unchanged items */
```

No traditional borders - exclusively using translucent ring utilities for depth and definition.
