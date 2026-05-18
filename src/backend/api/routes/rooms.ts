import { remodelScenarios, roomActionItems, rooms, scenarioRoomPlans } from "@backend/db";
import { ensureHomeCatalogSeed, getHomeCatalog } from "@backend/services/home-catalog";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const roomsRouter = new Hono<{ Bindings: Env }>();

roomsRouter.get("/catalog", async (c) => {
  try {
    await ensureHomeCatalogSeed(c.env);
    const catalog = await getHomeCatalog(c.env);
    return c.json({
      success: true,
      ...catalog,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load room catalog",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.get("/scenarios", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const scenarios = await db
      .select()
      .from(remodelScenarios)
      .orderBy(asc(remodelScenarios.datetimeCreated))
      .all();

    const plans = await db
      .select()
      .from(scenarioRoomPlans)
      .orderBy(asc(scenarioRoomPlans.datetimeCreated))
      .all();

    const plansByScenario = new Map<string, typeof plans>();
    for (const plan of plans) {
      if (!plansByScenario.has(plan.scenarioId)) {
        plansByScenario.set(plan.scenarioId, []);
      }
      plansByScenario.get(plan.scenarioId)!.push(plan);
    }

    return c.json({
      success: true,
      scenarios: scenarios.map((scenario) => ({
        ...scenario,
        plans: plansByScenario.get(scenario.id) || [],
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list scenarios",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/scenarios", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
      budgetLowCents?: number;
      budgetHighCents?: number;
    };

    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: "Scenario name is required" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(remodelScenarios)
      .values({
        id,
        name,
        description: body.description?.trim() || null,
        budgetLowCents: typeof body.budgetLowCents === "number" ? body.budgetLowCents : null,
        budgetHighCents: typeof body.budgetHighCents === "number" ? body.budgetHighCents : null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    const created = await db
      .select()
      .from(remodelScenarios)
      .where(eq(remodelScenarios.id, id))
      .get();

    return c.json({ success: true, scenario: created }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create scenario",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/scenarios/:scenarioId/plans", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const scenarioId = c.req.param("scenarioId");
    const body = (await c.req.json()) as {
      roomId?: number;
      proposedUse?: string;
      stage?: string;
      estimatedCostCents?: number;
      notes?: string;
    };

    const scenario = await db
      .select()
      .from(remodelScenarios)
      .where(eq(remodelScenarios.id, scenarioId))
      .get();

    if (!scenario) {
      return c.json({ error: "Scenario not found" }, 404);
    }

    if (!body.roomId || !Number.isFinite(body.roomId)) {
      return c.json({ error: "roomId is required" }, 400);
    }

    const room = await db.select().from(rooms).where(eq(rooms.id, body.roomId)).get();
    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    const proposedUse = body.proposedUse?.trim();
    if (!proposedUse) {
      return c.json({ error: "proposedUse is required" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(scenarioRoomPlans)
      .values({
        id,
        scenarioId,
        roomId: room.id,
        proposedUse,
        stage: body.stage?.trim() || "considering",
        estimatedCostCents:
          typeof body.estimatedCostCents === "number" ? body.estimatedCostCents : null,
        notes: body.notes?.trim() || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    await db
      .update(remodelScenarios)
      .set({
        datetimeUpdated: now,
      })
      .where(eq(remodelScenarios.id, scenarioId))
      .run();

    const plan = await db
      .select()
      .from(scenarioRoomPlans)
      .where(eq(scenarioRoomPlans.id, id))
      .get();

    return c.json({ success: true, plan }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create scenario room plan",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.get("/:roomId/action-items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomId = Number(c.req.param("roomId"));
    if (!Number.isFinite(roomId)) {
      return c.json({ error: "Invalid room ID" }, 400);
    }

    const scenarioId = c.req.query("scenarioId");

    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    const items = scenarioId
      ? await db
          .select()
          .from(roomActionItems)
          .where(
            and(eq(roomActionItems.roomId, roomId), eq(roomActionItems.scenarioId, scenarioId)),
          )
          .orderBy(asc(roomActionItems.datetimeCreated))
          .all()
      : await db
          .select()
          .from(roomActionItems)
          .where(eq(roomActionItems.roomId, roomId))
          .orderBy(asc(roomActionItems.datetimeCreated))
          .all();

    return c.json({ success: true, room, items });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list room action items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/:roomId/action-items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomId = Number(c.req.param("roomId"));
    if (!Number.isFinite(roomId)) {
      return c.json({ error: "Invalid room ID" }, 400);
    }

    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    const body = (await c.req.json()) as {
      scenarioId?: string;
      category?: string;
      title?: string;
      details?: string;
      status?: string;
      priority?: number;
      estimatedCostCents?: number;
    };

    const title = body.title?.trim();
    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(roomActionItems)
      .values({
        id,
        roomId,
        scenarioId: body.scenarioId?.trim() || null,
        category: body.category?.trim() || "general",
        title,
        details: body.details?.trim() || null,
        status: body.status?.trim() || "open",
        priority:
          typeof body.priority === "number" && Number.isFinite(body.priority) ? body.priority : 2,
        estimatedCostCents:
          typeof body.estimatedCostCents === "number" ? body.estimatedCostCents : null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    const created = await db.select().from(roomActionItems).where(eq(roomActionItems.id, id)).get();

    return c.json({ success: true, item: created }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create room action item",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { roomsRouter };
