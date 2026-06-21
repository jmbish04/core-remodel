import { loadBudgetSnapshot } from "@backend/services/budget-model";
import { Hono } from "hono";

const budgetSnapshotRouter = new Hono<{ Bindings: Env }>();

budgetSnapshotRouter.get("/", async (c) => {
  try {
    return c.json(await loadBudgetSnapshot(c.env));
  } catch (error) {
    return c.json(
      {
        error: "Failed to compute budget snapshot",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetSnapshotRouter };
