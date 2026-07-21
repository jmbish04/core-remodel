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

import { eq, and } from "drizzle-orm";
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

  const created: string[] = [];
  for (const name of PLUMBING_SUBCATEGORIES) {
    const [existing] = await db
      .select({ id: subcategories.id })
      .from(subcategories)
      .where(and(eq(subcategories.name, name), eq(subcategories.categoryId, plumbing.id)));
    if (existing) continue;

    await db.insert(subcategories).values({ name, categoryId: plumbing.id });
    created.push(name);
  }

  console.log(`✅ Plumbing subcategories seeded (${created.length} new: ${created.join(", ") || "none"}).`);
  return { categoryId: plumbing.id, created };
}
