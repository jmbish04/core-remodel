import { tradeData, standardCosts, staticBudgetItems, workItemTypes, rooms } from "@backend/db";
import { asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const budgetDataRouter = new Hono<{ Bindings: Env }>();

// 1. Get Trades (Truth Table) list with optional filtering
budgetDataRouter.get("/trades", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const category = c.req.query("category");
    const search = c.req.query("search");

    let query = db.select().from(tradeData);
    
    // Apply filters in memory or via SQL (D1 supports clean where clauses)
    const conditions = [];
    if (category) {
      conditions.push(eq(tradeData.category, category));
    }
    if (search) {
      conditions.push(like(tradeData.workItem, `%${search}%`));
    }

    const rows = await db
      .select()
      .from(tradeData)
      .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined)
      .orderBy(tradeData.category)
      .all();

    return c.json({ trades: rows, total: rows.length });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list trade data",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 2. Get Standard Costs (Room cost allocations) list
budgetDataRouter.get("/standard-costs", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomName = c.req.query("roomName");

    const rows = await db
      .select({
        id: standardCosts.id,
        roomName: standardCosts.roomName,
        floorName: standardCosts.floorName,
        workItem: standardCosts.workItem,
        quantity: standardCosts.quantity,
        measurementType: standardCosts.measurementType,
        unitPrice: standardCosts.unitPrice,
        sfUnitPrice: standardCosts.sfUnitPrice,
        tax: standardCosts.tax,
        overheadAndProfit: standardCosts.overheadAndProfit,
        rcv: standardCosts.rcv,
        totalCost: standardCosts.totalCost,
        totalSfCost: standardCosts.totalSfCost,
        notes: standardCosts.notes,
      })
      .from(standardCosts)
      .where(roomName ? eq(standardCosts.roomName, roomName) : undefined)
      .orderBy(standardCosts.floorName, standardCosts.roomName)
      .all();

    return c.json({ standardCosts: rows, total: rows.length });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list standard costs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 3. Get Static Budget Items (merged sheets)
budgetDataRouter.get("/static-items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const category = c.req.query("category");

    const rows = await db
      .select()
      .from(staticBudgetItems)
      .where(category ? eq(staticBudgetItems.category, category) : undefined)
      .orderBy(staticBudgetItems.category, staticBudgetItems.itemDescription)
      .all();

    return c.json({ staticItems: rows, total: rows.length });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list static budget items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// 4. Get Work Item Types list (reference lookup)
budgetDataRouter.get("/work-item-types", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(workItemTypes).orderBy(workItemTypes.name).all();
    return c.json({ types: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list work item types",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetDataRouter };
