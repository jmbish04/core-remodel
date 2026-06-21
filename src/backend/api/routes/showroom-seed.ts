/**
 * @fileoverview Seed data API — one-shot endpoint to populate
 * showroom reference data (cities, categories, product areas, stores).
 *
 * POST /api/showroom-stores/seed
 *
 * Protected by access auth via the parent router.
 * Idempotent — uses onConflictDoNothing.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";

import { seedBayAreaCities } from "@backend/db/seeds/seed-bay-area-cities";
import { seedStoreCategories } from "@backend/db/seeds/seed-store-categories";
import { seedProductAreas } from "@backend/db/seeds/seed-product-areas";
import { seedShowroomStores } from "@backend/db/seeds/seed-showroom-stores";

export const showroomSeedRouter = new Hono<{ Bindings: Env }>();

showroomSeedRouter.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);

  try {
    // Order matters: cities first (stores reference cities)
    await seedBayAreaCities(db);
    await seedStoreCategories(db);
    await seedProductAreas(db);
    await seedShowroomStores(db);

    return c.json({
      success: true,
      message: "Seeded cities, categories, product areas, and stores.",
    });
  } catch (err: any) {
    console.error("Seed error:", err);
    return c.json({ error: err.message }, 500);
  }
});
