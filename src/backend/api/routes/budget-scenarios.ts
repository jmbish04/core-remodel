import { budgetVarianceScenarios, budgetVarianceLineItems, projectSystemVariables } from "@backend/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const budgetScenariosRouter = new Hono<{ Bindings: Env }>();

// 1. List all kitchen scenarios
budgetScenariosRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(budgetVarianceScenarios).orderBy(budgetVarianceScenarios.scenarioKey).all();
    return c.json({ scenarios: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list budget variance scenarios",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 2. Get scenario comparison grid
budgetScenariosRouter.get("/comparison", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    
    // Fetch all scenarios
    const scenarios = await db.select().from(budgetVarianceScenarios).orderBy(budgetVarianceScenarios.scenarioKey).all();
    
    // Fetch all line items
    const lineItems = await db.select().from(budgetVarianceLineItems).orderBy(budgetVarianceLineItems.sortOrder).all();
    
    // Create comparison grid
    // Group items by label
    const gridMap = new Map<string, { label: string; costs: Record<string, number | null>; notes: string }>();
    
    lineItems.forEach(item => {
      const scenario = scenarios.find(s => s.id === item.scenarioId);
      if (!scenario) return;
      
      const key = scenario.scenarioKey; // "a", "b", "c", "d"
      const label = item.lineItemLabel;
      
      if (!gridMap.has(label)) {
        gridMap.set(label, {
          label,
          costs: { a: null, b: null, c: null, d: null },
          notes: item.notes || ""
        });
      }
      
      const gridItem = gridMap.get(label)!;
      gridItem.costs[key] = item.costAmount;
      if (item.notes && !gridItem.notes.includes(item.notes)) {
        gridItem.notes = gridItem.notes ? `${gridItem.notes} | ${item.notes}` : item.notes;
      }
    });

    const grid = Array.from(gridMap.values());

    return c.json({
      scenarios,
      comparisonGrid: grid
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load budget scenario comparison",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 3. Set active kitchen scenario
budgetScenariosRouter.post("/select", async (c) => {
  try {
    const body = await c.req.json() as { scenarioKey: string };
    const scenarioKey = body.scenarioKey?.toLowerCase();
    
    if (!["a", "b", "c", "d"].includes(scenarioKey)) {
      return c.json({ error: "Invalid scenario key. Must be a, b, c, or d." }, 400);
    }
    
    const db = drizzle(c.env.DB);
    
    const labelMap: Record<string, string> = {
      a: "Scenario A",
      b: "Scenario B",
      c: "Scenario C",
      d: "Scenario D"
    };

    const valueText = labelMap[scenarioKey];
    
    await db
      .update(projectSystemVariables)
      .set({ valueText })
      .where(eq(projectSystemVariables.variableKey, "ACTIVE_KITCHEN_SCENARIO"))
      .run();
      
    return c.json({ success: true, activeScenario: valueText });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update active kitchen scenario",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetScenariosRouter };
