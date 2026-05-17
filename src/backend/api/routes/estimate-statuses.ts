import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { estimateStatuses } from "@backend/db";

const estimateStatusesRouter = new Hono<{ Bindings: Env }>();

const DEFAULT_ESTIMATE_STATUSES = [
  {
    name: "reviewing",
    description: "Reviewing / Not yet accepted",
    sortOrder: 10,
    isTerminal: false,
  },
  {
    name: "negotiating",
    description: "Negotiating with vendor or contractor",
    sortOrder: 20,
    isTerminal: false,
  },
  {
    name: "accepted",
    description: "Accepted and selected",
    sortOrder: 30,
    isTerminal: true,
  },
  {
    name: "rejected",
    description: "Rejected / not selected",
    sortOrder: 40,
    isTerminal: true,
  },
];

async function ensureEstimateStatuses(env: Env) {
  const db = drizzle(env.DB);
  for (const status of DEFAULT_ESTIMATE_STATUSES) {
    await db
      .insert(estimateStatuses)
      .values({
        ...status,
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .onConflictDoNothing()
      .run();
  }
}

estimateStatusesRouter.get("/", async (c) => {
  try {
    await ensureEstimateStatuses(c.env);
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(estimateStatuses).orderBy(asc(estimateStatuses.sortOrder)).all();
    return c.json({ statuses: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load estimate statuses",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { estimateStatusesRouter, ensureEstimateStatuses };

