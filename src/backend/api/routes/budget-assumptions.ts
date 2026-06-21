import { assumptionLineItems, assumptionMicroVariances, projectSystemVariables } from "@backend/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const budgetAssumptionsRouter = new Hono<{ Bindings: Env }>();

// 1. Get room-grouped assumptions summary
budgetAssumptionsRouter.get("/summary", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    
    // Fetch assumptions and system variables
    const [lineItems, sysVars] = await Promise.all([
      db.select().from(assumptionLineItems).orderBy(assumptionLineItems.sortOrder).all(),
      db.select().from(projectSystemVariables).all()
    ]);
    
    // Group assumptions by section_name
    const sections: Record<string, typeof lineItems> = {};
    lineItems.forEach(item => {
      const section = item.sectionName;
      if (!sections[section]) sections[section] = [];
      sections[section].push(item);
    });

    return c.json({
      sections,
      variables: sysVars
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load assumptions summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 2. Get shower micro-variance matrix
budgetAssumptionsRouter.get("/shower-matrix", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(assumptionMicroVariances).orderBy(assumptionMicroVariances.sortOrder).all();
    
    const baseScenarios = rows.filter(r => !r.isAddon);
    const addons = rows.filter(r => r.isAddon);

    return c.json({
      baseScenarios,
      addons
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load shower micro-variances",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 3. Update global variables or user shower selections
budgetAssumptionsRouter.post("/variables", async (c) => {
  try {
    const body = await c.req.json() as { key: string; value: string };
    const { key, value } = body;
    
    if (!key || value === undefined) {
      return c.json({ error: "Key and Value are required" }, 400);
    }
    
    const db = drizzle(c.env.DB);
    
    // Check if key exists, if not insert it
    const existing = await db
      .select()
      .from(projectSystemVariables)
      .where(eq(projectSystemVariables.variableKey, key))
      .get();
      
    if (existing) {
      await db
        .update(projectSystemVariables)
        .set({ valueText: value })
        .where(eq(projectSystemVariables.variableKey, key))
        .run();
    } else {
      await db
        .insert(projectSystemVariables)
        .values({
          variableKey: key,
          valueText: value,
          mappingRefKey: key,
          category: "User Custom Selection",
          unit: typeof value === "boolean" ? "Boolean" : "String"
        })
        .run();
    }
    
    return c.json({ success: true, key, value });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update global variables",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetAssumptionsRouter };
