/**
 * @fileoverview Seed the `plumbing` category's subcategories.
 *
 * `categories` already carries a "plumbing" row (0020-C2) but it has zero
 * subcategories, so material/product mappings can never say WHAT KIND of
 * plumbing fixture something is (a toilet vs a faucet vs a shower valve).
 * Looked up by category NAME, never a hardcoded id (AGENTS.md: definitions
 * are config, not enums).
 *
 * `subcategories` has no unique index on (name, category_id), so
 * `onConflictDoNothing()` would not fire — guard idempotency with a
 * select-first check instead.
 */

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { categories } from "../schema/config/categories";
import { subcategories } from "../schema/config/subcategories";

const PLUMBING_SUBCATEGORIES = [
  "Toilet",
  "Faucet",
  "Shower Valve",
  "Shower Head",
  "Sink",
  "Bathtub",
  "Drain",
  "Water Heater",
] as const;

export async function seedPlumbingSubcategories(db: DrizzleD1Database) {
  const [plumbing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.name, "plumbing"));
  if (!plumbing) {
    console.warn('[seed-plumbing-subcategories] no "plumbing" category found — skipping');
    return { categoryId: null, created: [] as string[] };
  }

  // One read for what already exists, one batched write for what does not —
  // rather than a SELECT + INSERT per name. Each query is a network round trip
  // on D1, so the loop cost 16 of them for 8 subcategories.
  //
  // `onConflictDoNothing` is NOT relied on here: there is no unique index on
  // (name, category_id), so it would never fire and duplicates would accumulate
  // on every re-run. The pre-read is what makes this idempotent.
  const existing = await db
    .select({ name: subcategories.name })
    .from(subcategories)
    .where(eq(subcategories.categoryId, plumbing.id))
    .all();
  const have = new Set(existing.map((row) => row.name));

  const created = PLUMBING_SUBCATEGORIES.filter((name) => !have.has(name));
  if (created.length > 0) {
    const stmts = created.map((name) =>
      db.insert(subcategories).values({ name, categoryId: plumbing.id }),
    );
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }

  console.log(`✅ Plumbing subcategories seeded (${created.length} new: ${created.join(", ") || "none"}).`);
  return { categoryId: plumbing.id, created };
}
