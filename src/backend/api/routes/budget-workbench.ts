/**
 * @fileoverview Phase 4 budget workbench — decision inbox + per-room finance
 * rollup, read API.
 *
 * Mounted at `/api/budget` in `src/backend/api/index.ts`, alongside
 * `budget-grid.ts`'s `/grid`, `/plan-schedule`, `/grid/seed` (no path
 * collision — this router owns `/rooms-finance` and `/inbox`). Behind the
 * same `requireAccessAuth` gate already applied to `/api/budget/*`.
 *
 * Both routes are thin wrappers over the `services/budget/*` aggregations —
 * same split as `budget-grid.ts` over `loadBudgetGrid` — so the
 * `get_budget_inbox` MCP tool can read the identical inbox derivation
 * instead of duplicating the query/derivation logic.
 */
import { loadBudgetInbox } from "@backend/services/budget/inbox";
import { loadRoomsFinance } from "@backend/services/budget/rooms-finance";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const budgetWorkbenchRouter = new Hono<{ Bindings: Env }>();

// --- GET /api/budget/rooms-finance ----------------------------------------

budgetWorkbenchRouter.get("/rooms-finance", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomsFinance = await loadRoomsFinance(db);
    return c.json(roomsFinance);
  } catch (error) {
    return c.json(
      {
        error: "Failed to load rooms finance",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// --- GET /api/budget/inbox --------------------------------------------------

budgetWorkbenchRouter.get("/inbox", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const inbox = await loadBudgetInbox(db);
    return c.json(inbox);
  } catch (error) {
    return c.json(
      {
        error: "Failed to load budget inbox",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetWorkbenchRouter };
