# ClickUp Integration — Implementation Walkthrough

## Summary

Full-stack ClickUp integration for a home remodel project management app. ClickUp is the source of truth for tasks; D1 stores an immutable audit trail, AI-generated flags, and system-level alerts. A `RemodelOrchestrator` Durable Object agent runs every 4 hours to flag missing details and calculate the critical path.

---

## Files Created / Modified

### Infrastructure
| File | Change |
|------|--------|
| [wrangler.jsonc](file:///Volumes/Projects/workers/core-remodel/wrangler.jsonc) | Added `CLICKUP_TOKEN`, `CLICKUP_TEAM_ID` secrets; `REMODEL_ORCHESTRATOR` DO binding; v12 migration |
| [_worker.ts](file:///Volumes/Projects/workers/core-remodel/src/_worker.ts) | Added `RemodelOrchestrator` export |

### D1 Schema (`src/backend/db/schema/scrum/`)
| File | Description |
|------|-------------|
| [clickup_revision_log.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/scrum/clickup_revision_log.ts) | Immutable audit trail — every ClickUp mutation logged with full request/response payloads |
| [clickup_task_flags.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/scrum/clickup_task_flags.ts) | Per-task AI/algorithmic flags (AI_AUDIT, CRITICAL_PATH, OVERDUE, DEPENDENCY_BLOCKED) |
| [clickup_system_alerts.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/scrum/clickup_system_alerts.ts) | Project-wide risk alerts (UI-only, no push notifications) |
| [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/scrum/index.ts) | Barrel export |
| [schema/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/db/schema/index.ts) | Updated to include `scrum/index` |
| [0058_thin_franklin_storm.sql](file:///Volumes/Projects/workers/core-remodel/drizzle/0058_thin_franklin_storm.sql) | Generated migration |

### ClickUp Client
| File | Description |
|------|-------------|
| [clickup-client.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/services/clickup-client.ts) | Typed API v2 client with 429 retry, pagination, link-only attachment strategy |

### API Routes
| File | Description |
|------|-------------|
| [clickup.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/clickup.ts) | 13 Hono endpoints: task CRUD, attachment upload, revision log, flags, alerts, orchestrator trigger/status |
| [api/index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/index.ts) | Registered `clickupRouter` at `/api/clickup` with `requireAccessAuth` |

### Orchestrator Agent (`src/backend/ai/agents/RemodelOrchestrator/`)
| File | Description |
|------|-------------|
| [types.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/ai/agents/RemodelOrchestrator/types.ts) | State interface + defaults |
| [critical-path.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/ai/agents/RemodelOrchestrator/critical-path.ts) | DAG CPM algorithm (Kahn's topological sort + forward/backward pass) |
| [index.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/ai/agents/RemodelOrchestrator/index.ts) | Agent class with `this.schedule()` loop, Workers AI audit, D1 flag/alert writes |

### Frontend (`src/frontend/components/clickup/`)
| File | Description |
|------|-------------|
| [types.ts](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/clickup/types.ts) | Shared frontend types |
| [ClickUpKanban.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/clickup/ClickUpKanban.tsx) | DnD Kanban board with flag badge overlays |
| [ClickUpGantt.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/clickup/ClickUpGantt.tsx) | Frappe-gantt chart with critical path highlighting |
| [ClickUpTaskModal.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/clickup/ClickUpTaskModal.tsx) | Create/edit modal with flags, attachments, revision history |
| [ClickUpTasksPage.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/clickup/ClickUpTasksPage.tsx) | Top-level page with alerts banner, orchestrator badge, view toggle |
| [tasks.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/tasks.astro) | Astro page route at `/admin/tasks` |

### Type Declarations
| File | Description |
|------|-------------|
| [frappe-gantt.d.ts](file:///Volumes/Projects/workers/core-remodel/src/types/frappe-gantt.d.ts) | Type shim for frappe-gantt (ships without TS types) |

---

## Verification
- **TypeScript**: `pnpm tsc --noEmit` — 0 errors in all new files
- **Migration**: Generated `0058_thin_franklin_storm.sql` via `drizzle-kit generate`
- **Types**: `pnpm wrangler types` — `CLICKUP_TOKEN`, `CLICKUP_TEAM_ID`, `REMODEL_ORCHESTRATOR` confirmed in Env

## Before First Deploy

1. **Add secrets** to the Cloudflare Secrets Store:
   - `CLICKUP_TOKEN` — ClickUp Personal API Token
   - `CLICKUP_TEAM_ID` — ClickUp Workspace/Team ID

2. **Run the migration** remotely: `pnpm drizzle-kit migrate --remote`

3. **Configure the Orchestrator** with your ClickUp List ID after deploy:
   ```
   POST /api/clickup/orchestrator/trigger
   ```
   Or call `configureList(listId)` via the DO stub.
