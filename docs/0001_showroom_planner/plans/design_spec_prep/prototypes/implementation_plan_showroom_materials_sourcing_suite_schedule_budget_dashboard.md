# Showroom & Materials Sourcing Suite — Materials Dashboard

Implement the **Materials Schedule & Budget Dashboard** as the first page of the Showroom & Materials Sourcing Suite, establishing the core data bindings, the horizontal budget breakdown chart (Recharts), the grouped materials table with AI alerts, and the sidebar procurement timeline.

## User Review Required

> [!IMPORTANT]
> **Orchestration Mode Confirmation**: By default, we will run in `current-agent` mode to build the prototypes and components inline in this session. Please let us know if you prefer to switch to `jules` orchestration.
> 
> **Routing Alignment**: We will mount the Materials Dashboard at `/admin/materials` and update the sidebar links. The current `/admin/showroom` page will be used as the Showrooms Directory (to be built next).

## Open Questions

> [!WARNING]
> None at the moment. We are proceeding based on the visual specifications in `.stitch/DESIGN.md` and `PRD.md`.

## Proposed Changes

### Backend Route Additions

#### [MODIFY] [showroom-stores.ts](file:///Volumes/Projects/workers/core-remodel/src/backend/api/routes/showroom-stores.ts)
Add a new `GET /products/:pid` endpoint to fetch full material details (including notes, research logs, similar models, and product area mapping) to power the Material Detail Viewport (`material-viewport.astro`).

---

### Frontend Components

#### [NEW] [MaterialsDashboard.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/showroom/MaterialsDashboard.tsx)
Build the primary dashboard component with:
- **Metrics Summary Cards**: Total budget allocated, actual spent, and active alerts count.
- **Budget Allocation Chart**: A Recharts stacked horizontal bar chart mapping allocated vs spent across the 6 major product areas (Kitchen, Bathroom, Closet, Living, Exterior, General).
- **Materials Directory Table**: Grouped by room, columns for Name, Product Area, Budget, Qty, Status Badge (Wishlist, Selected, Purchased, Delivered), and AI Alert flags.
- **Procurement Timeline Panel**: Timeline mapping upcoming order deadlines to construction phases.
- **State States**: Default DATA state, empty state placeholder, skeleton LOADING block, and error display.

#### [NEW] [materials.astro](file:///Volumes/Projects/workers/core-remodel/src/frontend/pages/admin/materials.astro)
Create the Astro route for `/admin/materials`, wrapping `MaterialsDashboard` with `BaseLayout` and `client:only="react"`.

#### [MODIFY] [AppSidebar.tsx](file:///Volumes/Projects/workers/core-remodel/src/frontend/components/AppSidebar.tsx)
Update the "Shopping Research" navigation section to include:
- `Materials Schedule` -> `/admin/materials`
- `Showrooms Directory` -> `/admin/showroom`
- `Closet Research` -> `/rooms/closets`

---

## Verification Plan

### Automated Tests
- Run `tsc --noEmit` to ensure zero compilation errors are introduced in frontend or backend files.

### Manual Verification
- Navigate to `/admin/materials` in the dev server.
- Verify the horizontal Recharts bar chart maps colors to the Monolith specifications (`--chart-1` through `--chart-5` custom hex/oklch values).
- Confirm table groups materials by room.
- Verify the responsive behavior (collapsing columns and table wrapping).
