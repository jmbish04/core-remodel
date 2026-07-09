# Global Products + Per-Showroom Pricing — Subsystem A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `showroom_store_products` into a truly global product (unique by brand + model #, never owned by a showroom), with per-source price observations and a `ragUuid`-keyed product-photo table paired to Vectorize.

**Architecture:** Repurpose the existing, heavily-referenced `showroom_store_products` table in place (drop `storeId`; add `modelNumber`/`modelKey`/`msrp`; unique index on `(brandId, modelKey)`). Keep `showroom_product_mappings` a bare `(showroomId, productId)` link. Add two new tables — `product_price_observations` (the "prices across showrooms" source of truth, multi-source) and `product_showroom_photos` (the D1 half of a Vectorize pairing, joined by `ragUuid`). Migrate existing `(storeId, price)` down into mappings + observations, dedup by brand+model#, then drop `storeId`.

**Tech Stack:** Cloudflare Workers, D1 + Drizzle ORM (`drizzle-orm@0.33.0`, `drizzle-kit@0.24.2`), Hono + `@hono/zod-openapi@1.3.0`, Zod v4 (`zod@4.4.2`), MCP registry tools (`defineTool`), Cloudflare Images + Vectorize (`PHOTO_INDEX`).

**Spec:** [`docs/superpowers/specs/2026-07-08-global-products-showroom-pricing-design.md`](../superpowers/specs/2026-07-08-global-products-showroom-pricing-design.md)

## Global Constraints

- **Migrations:** schema changes via `pnpm run db:generate` (drizzle-kit) only; NEVER hand-edit generated migration files. Data/backfill migrations are hand-authored `drizzle/NNNN_*.sql` files added to the journal via `drizzle-kit generate --custom`. Apply with `pnpm run migrate:local` (local) / `pnpm run migrate:remote` (prod, via `scripts/d1-migrate.mjs`). NEVER `wrangler d1 execute --file` to apply migrations.
- **Never import `drizzle-zod` in schema files** — it passes `tsc` but breaks `pnpm run build`. Hand-write Zod route/tool schemas.
- **`build` does not type-check.** After code changes run `npx tsc --noEmit` and grep for the files you touched (repo carries ~171 pre-existing baseline errors; only regressions in your files matter).
- **No unit-test framework exists.** Verification per task = (a) migration applies cleanly via `migrate:local`, (b) `tsc --noEmit` shows no new errors in touched files, (c) a node smoke script under `scripts/tests/*.mjs` reads local D1 to assert data shape, (d) `pnpm run build` succeeds. Follow the existing `scripts/tests/test_throttled_pipeline.mjs` pattern.
- **Price columns are free-text TEXT** (e.g. `"$1,299"`, `"call for pricing"`), not integer cents. Coerce numbers to string; never parse to number for storage.
- **Schema files use direct leaf imports** (e.g. `import { brands } from "../brands/brands"`) to avoid circular references through barrels.
- **Money/enum columns:** use `text("col", { enum: [...] as const })` for enums, matching the repo pattern.
- Work happens in the worktree at `.claude/worktrees/happy-borg-aad0f5` on branch `claude/happy-borg-aad0f5`.

---

## File Structure

**Create:**
- `src/backend/db/schema/showroom/price_observations.ts` — `productPriceObservations` table
- `src/backend/db/schema/showroom/product_photos.ts` — `productShowroomPhotos` table (ragUuid-keyed)
- `src/backend/lib/normalize-model.ts` — `normalizeModelKey()` pure helper
- `src/backend/lib/money.ts` — `parsePriceCents()` / `parseDiscountPct()` pure helpers
- `src/backend/mcp/tools/price_observations.ts` — `record_price_observation`, `list_price_observations` tools
- `scripts/tests/test_global_products.mjs` — node smoke script
- Data migrations (via `--custom`): backfill, dedup, drop-storeId gate

**Modify:**
- `src/backend/db/schema/showroom/store_products.ts` — add `modelNumber`/`modelKey`/`msrp`, unique index; later drop `storeId`
- `src/backend/db/schema/showroom/index.ts` — export the two new tables
- `src/backend/mcp/tools/products.ts` — drop `storeId` requirement, add new fields, dedup on `(brandId, modelKey)`, enrich `get_product`
- `src/backend/mcp/registry.ts` (or wherever `productTools` is registered) — register the new tool array
- `src/backend/api/routes/showroom-products.ts` / `showroom-stores.ts` — expose observations in product context
- Any code reading `showroom_store_products.storeId` (found via grep in Task 8)

---

## Task 1: Pure helpers — `normalizeModelKey()`, `parsePriceCents()`, `parseDiscountPct()`

**Files:**
- Create: `src/backend/lib/normalize-model.ts`
- Create: `src/backend/lib/money.ts`
- Test: `scripts/tests/test_global_products.mjs` (created here, extended later)

**Interfaces:**
- Produces: `normalizeModelKey(input): string | null` — uppercases and strips everything except `[A-Z0-9]`; `null` for empty/null.
- Produces: `parsePriceCents(input): number | null` — free-text money → integer cents (×100, rounded); `null` when no number present ("call for pricing").
- Produces: `parseDiscountPct(input): number | null` — free-text discount → percent as a real number (0–100 typical); `null` when no number present.

- [ ] **Step 1: Write the model-key helper**

```ts
// src/backend/lib/normalize-model.ts
/**
 * Normalize a model number into a stable dedup key: uppercase, then strip every
 * character that isn't A–Z or 0–9. "MS 604-01" -> "MS60401". Returns null for
 * null/undefined/empty so no-model# products never collide on a unique index
 * (SQLite treats NULLs as distinct).
 */
export function normalizeModelKey(
  input: string | null | undefined
): string | null {
  if (input == null) return null;
  const key = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length > 0 ? key : null;
}
```

- [ ] **Step 2: Write the money helpers**

```ts
// src/backend/lib/money.ts
/**
 * Parse a free-text price ("$1,299.00", "1,299", "1299") to INTEGER CENTS, or
 * null when there is no parseable number ("call for pricing"). Keeps only digits
 * and the decimal point, then ×100 rounded. Best-effort and HITL-correctable.
 */
export function parsePriceCents(
  input: string | null | undefined
): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Parse a free-text discount ("15%", "15", "15% off") to a percent as a real
 * number, or null when no number is present. Best-effort; a dollars-off markdown
 * won't yield a meaningful percent — leave the text and null the numeric.
 */
export function parseDiscountPct(
  input: string | null | undefined
): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const pct = Number.parseFloat(cleaned);
  return Number.isFinite(pct) ? pct : null;
}
```

- [ ] **Step 3: Write a node smoke script that exercises all three**

```js
// scripts/tests/test_global_products.mjs
// Run: NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs
import assert from "node:assert";
// Dynamic import of the REAL .ts modules. Run under tsx. A static
// `import { x } from ".ts"` from a .mjs entry fails ("no export named x")
// because ESM static-links before tsx transforms; dynamic import() works.
const { normalizeModelKey } = await import("../../src/backend/lib/normalize-model.ts");
const { parsePriceCents, parseDiscountPct } = await import("../../src/backend/lib/money.ts");

// --- Task 1: normalizeModelKey ---
assert.equal(normalizeModelKey("MS 604-01"), "MS60401");
assert.equal(normalizeModelKey("ms604"), "MS604");
assert.equal(normalizeModelKey("  "), null);
assert.equal(normalizeModelKey(null), null);
assert.equal(normalizeModelKey("#$%"), null);
// --- Task 1: parsePriceCents ---
assert.equal(parsePriceCents("$1,299.00"), 129900);
assert.equal(parsePriceCents("1299"), 129900);
assert.equal(parsePriceCents("$12.99"), 1299);
assert.equal(parsePriceCents("call for pricing"), null);
assert.equal(parsePriceCents(null), null);
// --- Task 1: parseDiscountPct ---
assert.equal(parseDiscountPct("15%"), 15);
assert.equal(parseDiscountPct("15% off"), 15);
assert.equal(parseDiscountPct("none"), null);
console.log("OK: helpers (normalizeModelKey, parsePriceCents, parseDiscountPct)");
```

- [ ] **Step 4: Run it**

Run: `NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs`
Expected: `OK: helpers (normalizeModelKey, parsePriceCents, parseDiscountPct)`, exit 0, pristine output.
> tsx (v4) is installed. Use **dynamic** `import()` of the real `.ts` files (as shown above) — a static `import` of `.ts` from a `.mjs` entry fails; `NODE_NO_WARNINGS=1` hides tsx's internal loader deprecation notice. Do not fall back to inlined copies — that guards nothing.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "normalize-model|lib/money"` — Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/backend/lib/normalize-model.ts src/backend/lib/money.ts scripts/tests/test_global_products.mjs
git commit -m "feat(0020): model-key + money/discount parse helpers"
```

---

## Task 2: `product_price_observations` schema

**Files:**
- Create: `src/backend/db/schema/showroom/price_observations.ts`
- Modify: `src/backend/db/schema/showroom/index.ts`

**Interfaces:**
- Produces: `productPriceObservations` table; types `ProductPriceObservation`, `ProductPriceObservationInsert`. Columns per spec A4. `sourcePhotoId` FK is added in Task 3 (after the photos table exists) to avoid a forward reference — leave it as a plain nullable integer here and wire the reference in Task 3.

- [ ] **Step 1: Write the table**

```ts
// src/backend/db/schema/showroom/price_observations.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoid circular refs through the showroom barrel.
import { showroomStoreProducts } from "./store_products";
import { showroomStores } from "./stores";

/**
 * Product Price Observations — the "different prices found across showrooms"
 * source of truth. Each row is ONE price captured from ONE source (a showroom
 * price card you photographed, an online retailer, or the manufacturer's MSRP).
 * Price is NOT a property of the product or the showroom mapping — it is a dated,
 * source-attributed observation, optionally backed by the photo it was read from.
 */
export const productPriceObservations = sqliteTable(
  "product_price_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** Where this price came from. */
    sourceType: text("source_type", {
      enum: ["showroom", "online_retailer", "manufacturer"] as const,
    }).notNull(),

    /** Set when sourceType = 'showroom'. */
    showroomId: integer("showroom_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /** Set when sourceType = 'online_retailer'. */
    retailerName: text("retailer_name"),
    retailerUrl: text("retailer_url"),

    /** Free-text display prices ("$1,299", "call for pricing"). */
    price: text("price"),
    salePrice: text("sale_price"),
    discountInfo: text("discount_info"),

    /** Numeric comparison pairs (derived from the text via money helpers). */
    priceCents: integer("price_cents"),
    salePriceCents: integer("sale_price_cents"),
    discountPct: real("discount_pct"),

    condition: text("condition", {
      enum: ["new", "floor_model", "clearance", "as_is"] as const,
    }),

    leadTime: text("lead_time"),
    notes: text("notes"),

    /** Visit / capture / scrape date. */
    observedAt: integer("observed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** FK to product_showroom_photos.id — wired in Task 3. Nullable. */
    sourcePhotoId: integer("source_photo_id"),

    /** 0–100; 100 for manual entry, lower for AI extraction. */
    confidence: integer("confidence").notNull().default(100),

    /** HITL. Manual entries may be inserted as 'approved'. */
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"] as const,
    })
      .notNull()
      .default("pending"),
    reviewReason: text("review_reason"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    productIdx: index("price_observations_product_idx").on(table.productId),
    showroomIdx: index("price_observations_showroom_idx").on(table.showroomId),
  })
);

export type ProductPriceObservation =
  typeof productPriceObservations.$inferSelect;
export type ProductPriceObservationInsert =
  typeof productPriceObservations.$inferInsert;
```

- [ ] **Step 2: Export from the barrel**

Add to `src/backend/db/schema/showroom/index.ts`:

```ts
export * from "./price_observations";
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm run db:generate`
Expected: a new `drizzle/00XX_*.sql` creating `product_price_observations`. Open it and confirm it only CREATEs the new table + indexes (no unexpected drops).

- [ ] **Step 4: Apply locally**

Run: `pnpm run migrate:local`
Expected: applies without error; table created.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "price_observations|schema/showroom/index"` — Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/backend/db/schema/showroom/price_observations.ts src/backend/db/schema/showroom/index.ts drizzle/
git commit -m "feat(0020): product_price_observations table (multi-source price history)"
```

---

## Task 3: `product_showroom_photos` schema (ragUuid ↔ Vectorize) + wire `sourcePhotoId`

**Files:**
- Create: `src/backend/db/schema/showroom/product_photos.ts`
- Modify: `src/backend/db/schema/showroom/index.ts`
- Modify: `src/backend/db/schema/showroom/price_observations.ts` (add the real FK on `sourcePhotoId`)

**Interfaces:**
- Produces: `productShowroomPhotos` table; types `ProductShowroomPhoto`, `ProductShowroomPhotoInsert`. `ragUuid` is unique NOT NULL — the join key written to both the D1 row and the Vectorize `PHOTO_INDEX` vector metadata.

- [ ] **Step 1: Write the table**

```ts
// src/backend/db/schema/showroom/product_photos.ts
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";
import { showroomStores } from "./stores";

/**
 * Product Showroom Photos — the D1 half of a Vectorize pairing. Each row is a
 * photo captured of a product (or its price card) at a showroom (or online).
 * `ragUuid` is written onto BOTH this row AND the Vectorize vector metadata in
 * PHOTO_INDEX, so a visual-quality / similar-products query hits Vectorize, gets
 * back ragUuids, and joins here for the AI-returned `attributes` + `status`.
 * Mirrors the existing browser_run_pages.ragUuid convention.
 */
export const productShowroomPhotos = sqliteTable(
  "product_showroom_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Join key shared with the Vectorize vector's metadata. 1 photo = 1 vector. */
    ragUuid: text("rag_uuid").notNull(),

    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** Nullable — a photo may come from an online source, not a showroom. */
    showroomId: integer("showroom_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /** Stored asset path: CF Images delivery URL (current pipeline) or R2 URL. */
    imageUrl: text("image_url"),
    cfImageId: text("cf_image_id"),

    /** Primary material category depicted (aligned to browse-by categories in B). */
    category: text("category"),

    photoKind: text("photo_kind", {
      enum: ["product", "price_card", "spec_sheet", "unknown"] as const,
    })
      .notNull()
      .default("unknown"),

    /** AI structured-response payload: {metal, finish, dominantColors, brand,
     * modelNumber, style, price, salePrice, discountInfo, ...} + per-field confidence. */
    attributes: text("attributes", { mode: "json" }),

    status: text("status", {
      enum: ["pending_review", "approved", "rejected"] as const,
    })
      .notNull()
      .default("pending_review"),
    reviewReason: text("review_reason"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    ragUuidUniq: uniqueIndex("product_showroom_photos_rag_uuid_uniq").on(
      table.ragUuid
    ),
    productIdx: index("product_showroom_photos_product_idx").on(table.productId),
    showroomIdx: index("product_showroom_photos_showroom_idx").on(
      table.showroomId
    ),
  })
);

export type ProductShowroomPhoto = typeof productShowroomPhotos.$inferSelect;
export type ProductShowroomPhotoInsert =
  typeof productShowroomPhotos.$inferInsert;
```

- [ ] **Step 2: Wire the `sourcePhotoId` FK in price_observations**

In `src/backend/db/schema/showroom/price_observations.ts`, add the leaf import and change the `sourcePhotoId` column to a real reference:

```ts
// add near the other leaf imports:
import { productShowroomPhotos } from "./product_photos";
```
```ts
// replace the plain sourcePhotoId column with:
    sourcePhotoId: integer("source_photo_id").references(
      () => productShowroomPhotos.id,
      { onDelete: "set null" }
    ),
```

- [ ] **Step 3: Export from the barrel**

Add to `src/backend/db/schema/showroom/index.ts` (before `price_observations` so the referenced table is defined first is not required for TS, but keep grouped):

```ts
export * from "./product_photos";
```

- [ ] **Step 4: Generate + apply the migration**

Run: `pnpm run db:generate` then `pnpm run migrate:local`
Expected: creates `product_showroom_photos` (+ unique index on `rag_uuid`) and adds the `source_photo_id` FK. Inspect the generated SQL — confirm no drops.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "product_photos|price_observations"` — Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/backend/db/schema/showroom/ drizzle/
git commit -m "feat(0020): product_showroom_photos (ragUuid<->Vectorize) + link observations.sourcePhotoId"
```

---

## Task 4: Add `modelNumber`, `modelKey`, `msrp`, `msrpCents` to the product (additive, non-destructive)

**Files:**
- Modify: `src/backend/db/schema/showroom/store_products.ts`

**Interfaces:**
- Produces: four new nullable columns on `showroomStoreProducts`: `modelNumber` (text), `modelKey` (text), `msrp` (text), `msrpCents` (integer cents). `storeId` is UNTOUCHED in this task.

- [ ] **Step 1: Add the columns**

In `src/backend/db/schema/showroom/store_products.ts`, inside the `sqliteTable(... {})` column map, after `productType`:

```ts
  /** Real model identifier, promoted out of jsonDetails/sku. Nullable. */
  modelNumber: text("model_number"),

  /**
   * Normalized model number (normalizeModelKey) — the field the (brandId, modelKey)
   * unique index uses. Maintained app-side. Null for no-model# products (they never
   * collide: SQLite treats NULLs as distinct in unique indexes).
   */
  modelKey: text("model_key"),

  /** Manufacturer core / list price (MSRP) — text + numeric pair. Nullable. */
  msrp: text("msrp"),
  msrpCents: integer("msrp_cents"),
```

- [ ] **Step 2: Generate + apply**

Run: `pnpm run db:generate` then `pnpm run migrate:local`
Expected: `ALTER TABLE ... ADD COLUMN` for each new column. No drops.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep store_products` — Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/backend/db/schema/showroom/store_products.ts drizzle/
git commit -m "feat(0020): add modelNumber/modelKey/msrp to products (additive)"
```

---

## Task 5: Backfill migration — model keys, observations, mappings

**Files:**
- Create (via `--custom`): `drizzle/00XX_backfill_global_products.sql`

**Interfaces:**
- Consumes: columns from Tasks 2–4. Produces: every existing product has `modelNumber`/`modelKey` where recoverable; one `product_price_observations` row per product that had a `price`; a `showroom_product_mappings` row for each product's current `storeId`.

- [ ] **Step 1: Create an empty custom migration**

Run: `npx drizzle-kit generate --custom --name backfill_global_products`
Expected: creates an empty `drizzle/00XX_backfill_global_products.sql` registered in the journal.

- [ ] **Step 2: Write the backfill SQL**

Edit the generated file to contain (each statement separated by `--> statement-breakpoint`, matching the applier's split):

```sql
-- Backfill modelNumber from sku where a sku exists and modelNumber is empty.
UPDATE showroom_store_products
SET model_number = sku
WHERE model_number IS NULL AND sku IS NOT NULL AND trim(sku) <> '';
--> statement-breakpoint
-- Derive modelKey = uppercase(model_number) with non-alphanumerics stripped.
-- SQLite has no regexp_replace; strip the common separators seen in model #s.
UPDATE showroom_store_products
SET model_key = upper(
  replace(replace(replace(replace(replace(model_number,' ',''),'-',''),'/',''),'.',''),'#','')
)
WHERE model_number IS NOT NULL AND trim(model_number) <> '';
--> statement-breakpoint
-- Ensure each product's owning store exists as a showroom_product_mapping.
INSERT INTO showroom_product_mappings (showroom_id, product_id, created_at)
SELECT p.store_id, p.id, unixepoch()
FROM showroom_store_products p
WHERE p.store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM showroom_product_mappings m
    WHERE m.showroom_id = p.store_id AND m.product_id = p.id
  );
--> statement-breakpoint
-- Create one showroom price observation per product that carries a price.
INSERT INTO product_price_observations
  (product_id, source_type, showroom_id, price, discount_info, lead_time,
   condition, observed_at, confidence, review_status, created_at, updated_at)
SELECT p.id, 'showroom', p.store_id, p.price,
       coalesce(p.possible_discounts, p.trade_discount), p.lead_time,
       'new', coalesce(p.updated_at, unixepoch()), 100, 'approved',
       unixepoch(), unixepoch()
FROM showroom_store_products p
WHERE p.price IS NOT NULL AND trim(p.price) <> '';
--> statement-breakpoint
-- Derive numeric price_cents from the copied text price (strip $ , spaces; ×100).
-- Only for rows that look numeric (contain a digit, no letters) so "call for
-- pricing" stays text with a NULL numeric.
UPDATE product_price_observations
SET price_cents = CAST(round(
  CAST(replace(replace(replace(price,'$',''),',',''),' ','') AS REAL) * 100
) AS INTEGER)
WHERE price IS NOT NULL
  AND price GLOB '*[0-9]*'
  AND price NOT GLOB '*[A-Za-z]*';
```

> Note: the app-side `normalizeModelKey` also strips `[^A-Z0-9]` beyond these five separators. The SQL covers the separators that actually appear in this data; any residue is corrected when a product is next written through the MCP tool (Task 7 recomputes on write). This is acceptable because dedup (Task 6) runs AFTER and any stragglers surface in the HITL merge queue.

- [ ] **Step 3: Apply locally**

Run: `pnpm run migrate:local`
Expected: applies cleanly.

- [ ] **Step 4: Verify with the smoke script**

Extend `scripts/tests/test_global_products.mjs` to query local D1 and assert counts. Append:

```js
// --- Task 5: backfill sanity (local D1) ---
import { execFileSync } from "node:child_process";
function d1(q) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", `--command=${q}`],
    { encoding: "utf8" }
  );
  return JSON.parse(out)[0].results;
}
const withPrice = d1(
  "SELECT count(*) c FROM showroom_store_products WHERE price IS NOT NULL AND trim(price) <> ''"
)[0].c;
const obs = d1(
  "SELECT count(*) c FROM product_price_observations WHERE source_type='showroom'"
)[0].c;
assert.ok(obs >= withPrice, `expected >= ${withPrice} observations, got ${obs}`);
const unmapped = d1(
  "SELECT count(*) c FROM showroom_store_products p WHERE p.store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM showroom_product_mappings m WHERE m.showroom_id=p.store_id AND m.product_id=p.id)"
)[0].c;
assert.equal(unmapped, 0, "every product's store_id must be mapped");
console.log("OK: backfill (observations + mappings)");
```

Run: `NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs`
Expected: `OK: backfill (observations + mappings)`

- [ ] **Step 5: Commit**

```bash
git add drizzle/ scripts/tests/test_global_products.mjs
git commit -m "feat(0020): backfill model keys, showroom mappings, price observations"
```

---

## Task 6: Dedup migration — merge duplicate (brandId, modelKey) products

**Files:**
- Create (via `--custom`): `drizzle/00XX_dedup_products.sql`

**Interfaces:**
- Consumes: `modelKey` from Task 5. Produces: for each `(brand_id, model_key)` group with >1 row (model_key NOT NULL), a single survivor (lowest id); all child rows re-pointed to the survivor; loser rows deleted. Null-model# rows are NOT merged.

- [ ] **Step 1: Create the custom migration**

Run: `npx drizzle-kit generate --custom --name dedup_products`

- [ ] **Step 2: Write the dedup SQL**

Survivor = `MIN(id)` per `(brand_id, model_key)` group. Re-point every child FK, then delete losers. Enumerate ALL tables that reference `showroom_store_products.id`:
`showroom_product_mappings`, `product_material_mappings`, `product_images`, `product_specs`, `store_product_docs`, `store_product_intel`, `store_product_research`, `store_product_rating`, `store_product_notes`, `store_product_pa_mapping`, `store_product_tag_mapping`, `product_price_observations`, `product_showroom_photos`, and `material_schedule_items.purchased_showroom_product_id` (plain column). Write to the generated file:

```sql
-- Build a survivor map: loser_id -> keeper_id for duplicate (brand_id, model_key).
CREATE TEMP TABLE _dup_map AS
SELECT p.id AS loser_id, k.keeper_id
FROM showroom_store_products p
JOIN (
  SELECT brand_id, model_key, MIN(id) AS keeper_id
  FROM showroom_store_products
  WHERE model_key IS NOT NULL
  GROUP BY brand_id, model_key
  HAVING COUNT(*) > 1
) k ON k.brand_id IS p.brand_id AND k.model_key = p.model_key
WHERE p.id <> k.keeper_id;
--> statement-breakpoint
UPDATE showroom_product_mappings SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_material_mappings SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_images SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_specs SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_docs SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_research SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_rating SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_notes SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_pa_mapping SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_tag_mapping SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_price_observations SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_showroom_photos SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE material_schedule_items SET purchased_showroom_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = purchased_showroom_product_id) WHERE purchased_showroom_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
-- store_product_intel is 1:1 on product: delete a loser's intel BEFORE deleting the
-- loser, keeping the survivor's row (avoids a duplicate-key clash on re-point).
DELETE FROM store_product_intel WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
-- Collapse now-duplicate (showroom, product) mapping pairs created by re-pointing.
DELETE FROM showroom_product_mappings
WHERE id NOT IN (SELECT MIN(id) FROM showroom_product_mappings GROUP BY showroom_id, product_id);
--> statement-breakpoint
-- Finally delete the loser product rows.
DELETE FROM showroom_store_products WHERE id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
DROP TABLE _dup_map;
```

> Verify the exact child table + column names against the schema before running (grep each in `src/backend/db/schema/showroom/`). If any table listed above does not exist in this build, drop that statement; if a product-referencing table exists that is NOT listed, add it. This enumeration is the highest-risk part of the plan — the Step 4 orphan check is the guard.

- [ ] **Step 3: Apply locally**

Run: `pnpm run migrate:local`
Expected: applies cleanly.

- [ ] **Step 4: Verify zero orphans + no duplicate keys**

Append to `scripts/tests/test_global_products.mjs`:

```js
// --- Task 6: dedup integrity ---
const dupKeys = d1(
  "SELECT count(*) c FROM (SELECT brand_id, model_key FROM showroom_store_products WHERE model_key IS NOT NULL GROUP BY brand_id, model_key HAVING count(*) > 1)"
)[0].c;
assert.equal(dupKeys, 0, "no duplicate (brand_id, model_key) may remain");
const orphanObs = d1(
  "SELECT count(*) c FROM product_price_observations o WHERE NOT EXISTS (SELECT 1 FROM showroom_store_products p WHERE p.id=o.product_id)"
)[0].c;
assert.equal(orphanObs, 0, "no orphaned observations");
console.log("OK: dedup integrity");
```

Run: `NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs`
Expected: `OK: dedup integrity`

- [ ] **Step 5: Commit**

```bash
git add drizzle/ scripts/tests/test_global_products.mjs
git commit -m "feat(0020): dedup products by (brandId, modelKey), re-point child rows"
```

---

## Task 7: Add the `(brandId, modelKey)` unique index

**Files:**
- Modify: `src/backend/db/schema/showroom/store_products.ts`

**Interfaces:**
- Produces: `uniqueIndex("showroom_store_products_brand_model_uniq")` on `(brandId, modelKey)`. Runs AFTER dedup (Task 6) so it cannot fail on existing duplicates.

- [ ] **Step 1: Add the index + import**

In `store_products.ts`, change the import line to include `uniqueIndex`:

```ts
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
```

Add the table's second (config) argument:

```ts
export const showroomStoreProducts = sqliteTable(
  "showroom_store_products",
  {
    /* ...existing columns... */
  },
  (table) => ({
    /** One product per (brand, normalized model#). NULL model_key rows are
     * distinct (SQLite treats NULLs as unequal), so no-model# products never collide. */
    brandModelUniq: uniqueIndex("showroom_store_products_brand_model_uniq").on(
      table.brandId,
      table.modelKey
    ),
  })
);
```

- [ ] **Step 2: Generate + apply**

Run: `pnpm run db:generate` then `pnpm run migrate:local`
Expected: `CREATE UNIQUE INDEX ...`. If it fails with a uniqueness error, dedup (Task 6) missed a group — re-run Task 6's verify query, fix, retry.

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit 2>&1 | grep store_products` — Expected: no new errors.

```bash
git add src/backend/db/schema/showroom/store_products.ts drizzle/
git commit -m "feat(0020): unique index on (brandId, modelKey)"
```

---

## Task 8: Drop `storeId` from the product + update all readers

**Files:**
- Modify: `src/backend/db/schema/showroom/store_products.ts`
- Modify: every file that reads `showroomStoreProducts.storeId` (enumerate via grep)

**Interfaces:**
- Produces: `showroom_store_products` with NO `storeId` column. Product↔showroom is expressed ONLY through `showroom_product_mappings` and `product_price_observations`.

- [ ] **Step 1: Find every reader**

Run: `grep -rn "\.storeId\|store_id\|storeId" src/backend/mcp/tools/products.ts src/backend/api/routes src/frontend/components/showroom 2>/dev/null`
List each usage; each must be removed or re-sourced from a mapping/observation. Known: `productDto` (Task 9), `create_product`/`ensure_product` (Task 9), `FieldScanApp.tsx` (stores a `storeId` per scan card — that becomes the `showroomId` on the observation/photo, not on the product).

- [ ] **Step 2: Remove the column from the schema**

In `store_products.ts`, delete the `storeId` column block and its `showroomStores` import if now unused. (Keep the `brands`/`materialScheduleItems` imports.)

- [ ] **Step 3: Generate + inspect the migration carefully**

Run: `pnpm run db:generate`
Expected: `ALTER TABLE showroom_store_products DROP COLUMN store_id;` (D1/SQLite supports DROP COLUMN). Open the SQL and confirm it drops ONLY `store_id` and nothing else. If drizzle-kit proposes a table-rebuild, review that the rebuild preserves all other columns + the new unique index.

- [ ] **Step 4: Apply locally**

Run: `pnpm run migrate:local`
Expected: applies cleanly; `store_id` gone.

- [ ] **Step 5: Fix all readers to compile**

Update each usage found in Step 1 (the concrete MCP-tool edits are Task 9). For any route/component that displayed a product's single store, switch it to read from `showroom_product_mappings` / `product_price_observations`. 

- [ ] **Step 6: Type-check the whole product surface**

Run: `npx tsc --noEmit 2>&1 | grep -E "store_products|products.ts|showroom-products|showroom-catalog|FieldScan"` — Expected: no new errors.

- [ ] **Step 7: Build**

Run: `pnpm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(0020): drop storeId from products — product is fully global"
```

---

## Task 9: MCP tools — decouple `create_product`/`ensure_product`, enrich `get_product`

**Files:**
- Modify: `src/backend/mcp/tools/products.ts`

**Interfaces:**
- Consumes: `normalizeModelKey` (Task 1), the new columns/tables. Produces: `create_product` and `ensure_product` no longer require `storeId` and accept `modelNumber`/`msrp`; `ensure_product` dedups on `(brandId, modelKey)` first; `productDto` drops `storeId`, adds `modelNumber`/`modelKey`/`msrp`; `get_product` returns `priceObservations[]` and `photos[]`.

- [ ] **Step 1: Update imports + `productDto`**

Add imports: `import { normalizeModelKey } from "@backend/lib/normalize-model";` and `import { parsePriceCents } from "@backend/lib/money";`. Add `productPriceObservations, productShowroomPhotos` to the `@backend/db` import. In `productDto`, remove the `storeId: p.storeId,` line and add:

```ts
    modelNumber: p.modelNumber,
    modelKey: p.modelKey,
    msrp: p.msrp,
    msrpCents: p.msrpCents,
```

- [ ] **Step 2: `create_product` — drop the storeId requirement, add fields**

In the `create_product` `inputShape`, remove `storeId` from required, delete the `assertStore` call, and add:

```ts
      modelNumber: z.string().optional().describe("Manufacturer model number/name"),
      msrp: z.string().optional().describe("Manufacturer core/list price (MSRP), free text"),
      msrpCents: z.number().int().optional().describe("MSRP in integer cents (else derived from msrp text)"),
```

In the handler, before insert, compute:

```ts
const modelKey = normalizeModelKey(input.modelNumber);
const msrpCents = input.msrpCents ?? parsePriceCents(input.msrp);
```

and include `modelNumber: input.modelNumber, modelKey, msrp: input.msrp, msrpCents` in the insert. Remove `storeId` from the insert object.

- [ ] **Step 3: `ensure_product` — dedup on (brandId, modelKey) first**

Replace the reuse lookup precedence so it checks `(brandId, modelKey)` before the `(brandId, itemName)` fallback:

```ts
const modelKey = normalizeModelKey(input.modelNumber);
let existing;
if (input.brandId != null && modelKey != null) {
  [existing] = await db
    .select()
    .from(showroomStoreProducts)
    .where(
      and(
        eq(showroomStoreProducts.brandId, input.brandId),
        eq(showroomStoreProducts.modelKey, modelKey)
      )
    )
    .limit(1);
}
// fall back to existing (brandId, itemName) lookup when no modelKey match…
```

Remove `storeId` from `ensure_product`'s required inputs and its insert.

- [ ] **Step 4: `get_product` — attach observations + photos**

In the `get_product` handler, after loading the product, load and attach:

The `get_product` handler is `async ({ db }, input) => {…}` and uses `input.id`. After loading the product, add:

```ts
const observations = await db
  .select()
  .from(productPriceObservations)
  .where(eq(productPriceObservations.productId, input.id))
  .all();
const photos = await db
  .select()
  .from(productShowroomPhotos)
  .where(eq(productShowroomPhotos.productId, input.id))
  .all();
// include `priceObservations: observations, photos` in the returned object
```

Also update the `get_product` `description` string — it currently says the product is carried at an "owning `storeId` plus every showroom_product_mappings location"; drop the `storeId` clause since that column no longer exists.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "mcp/tools/products"` — Expected: no new errors.

- [ ] **Step 6: Smoke via MCP dev or a node script**

Append to `scripts/tests/test_global_products.mjs` a check that a product can be inserted with no `store_id` column present (schema-level guarantee already covered) — assert the column is gone:

```js
// --- Task 9: storeId column removed ---
const cols = d1("PRAGMA table_info(showroom_store_products)").map((r) => r.name);
assert.ok(!cols.includes("store_id"), "store_id column must be dropped");
assert.ok(
  ["model_key", "msrp", "msrp_cents"].every((c) => cols.includes(c)),
  "new columns present"
);
const obsCols = d1("PRAGMA table_info(product_price_observations)").map((r) => r.name);
assert.ok(
  ["price_cents", "sale_price_cents", "discount_pct"].every((c) => obsCols.includes(c)),
  "observation numeric columns present"
);
console.log("OK: product schema shape");
```

Run: `NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs` — Expected: `OK: product schema shape`

- [ ] **Step 7: Commit**

```bash
git add src/backend/mcp/tools/products.ts scripts/tests/test_global_products.mjs
git commit -m "feat(0020): products MCP tools decoupled from storeId; get_product returns observations+photos"
```

---

## Task 10: MCP tools — `record_price_observation` + `list_price_observations`

**Files:**
- Create: `src/backend/mcp/tools/price_observations.ts`
- Modify: the tool registry that aggregates `productTools` (find via `grep -rn "productTools" src/backend/mcp`)

**Interfaces:**
- Consumes: `productPriceObservations`, assert helpers. Produces: `priceObservationTools: RemodelTool[]` exporting `record_price_observation` (WRITE) and `list_price_observations` (READ_ONLY), registered alongside `productTools`.

- [ ] **Step 1: Write the tools**

```ts
// src/backend/mcp/tools/price_observations.ts
import {
  productPriceObservations,
  showroomStoreProducts,
  showroomStores,
} from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { parsePriceCents, parseDiscountPct } from "@backend/lib/money";
import { toolError } from "../format";
import { defineTool, READ_ONLY, WRITE, type RemodelTool } from "../types";

export const priceObservationTools: RemodelTool[] = [
  defineTool({
    name: "record_price_observation",
    category: "products",
    title: "Record a price observation",
    description:
      "Record ONE price seen for a product from a single source: a showroom (pass showroomId), an online retailer (pass retailerName/retailerUrl), or the manufacturer (MSRP). Prices are free text ('$1,299'). Optionally link the price-card photo it came from via sourcePhotoId.",
    annotations: WRITE,
    inputShape: {
      productId: z.number().int().positive(),
      sourceType: z.enum(["showroom", "online_retailer", "manufacturer"]),
      showroomId: z.number().int().positive().optional(),
      retailerName: z.string().optional(),
      retailerUrl: z.string().optional(),
      price: z.string().optional(),
      salePrice: z.string().optional(),
      discountInfo: z.string().optional(),
      // Explicit numeric overrides; when omitted they are derived from the text.
      priceCents: z.number().int().optional(),
      salePriceCents: z.number().int().optional(),
      discountPct: z.number().optional(),
      condition: z.enum(["new", "floor_model", "clearance", "as_is"]).optional(),
      leadTime: z.string().optional(),
      notes: z.string().optional(),
      sourcePhotoId: z.number().int().positive().optional(),
      reviewStatus: z.enum(["pending", "approved", "rejected"]).optional(),
    },
    handler: async ({ db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.productId))
        .limit(1);
      if (!product) toolError(`Product ${input.productId} not found.`);
      if (input.sourceType === "showroom" && input.showroomId == null) {
        toolError("showroomId is required when sourceType='showroom'.");
      }
      // Derive numeric comparison fields from the text when not given explicitly.
      const priceCents = input.priceCents ?? parsePriceCents(input.price);
      const salePriceCents =
        input.salePriceCents ?? parsePriceCents(input.salePrice);
      const discountPct = input.discountPct ?? parseDiscountPct(input.discountInfo);
      const [row] = await db
        .insert(productPriceObservations)
        .values({
          productId: input.productId,
          sourceType: input.sourceType,
          showroomId: input.showroomId,
          retailerName: input.retailerName,
          retailerUrl: input.retailerUrl,
          price: input.price,
          salePrice: input.salePrice,
          discountInfo: input.discountInfo,
          priceCents,
          salePriceCents,
          discountPct,
          condition: input.condition,
          leadTime: input.leadTime,
          notes: input.notes,
          sourcePhotoId: input.sourcePhotoId,
          reviewStatus: input.reviewStatus ?? "approved",
        })
        .returning();
      return { observation: row };
    },
  }),
  defineTool({
    name: "list_price_observations",
    category: "products",
    title: "List price observations",
    description:
      "List all price observations for a product (the different prices found across showrooms, online retailers, and the manufacturer).",
    annotations: READ_ONLY,
    inputShape: { productId: z.number().int().positive() },
    handler: async ({ db }, input) => {
      const rows = await db
        .select()
        .from(productPriceObservations)
        .where(eq(productPriceObservations.productId, input.productId))
        .all();
      return { observations: rows };
    },
  }),
];
```

> Signature confirmed against `products.ts`: `defineTool` takes `annotations: READ_ONLY | WRITE | WRITE_IDEMPOTENT` (NOT `access`), and handlers are `async ({ db }, input) => …` (first arg is a destructured context object). `record_price_observation` uses a WRITE annotation because each call creates a new dated row (not idempotent). Confirm `.returning()` is supported by the D1 driver in this repo (drizzle-orm D1 supports it); if not, re-select the inserted row by `last_insert_rowid()`.

- [ ] **Step 2: Register the tools**

In the registry that lists `productTools`, add `...priceObservationTools` (import from the new file).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "price_observations|registry"` — Expected: no new errors.

- [ ] **Step 4: Build**

Run: `pnpm run build` — Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/backend/mcp/tools/price_observations.ts src/backend/mcp/*.ts
git commit -m "feat(0020): record_price_observation + list_price_observations MCP tools"
```

---

## Task 11: API — expose price observations in product context

**Files:**
- Modify: `src/backend/api/routes/showroom-stores.ts` (the `/products/:id/research/context` handler that `ProductViewportApp` consumes) and/or `src/backend/api/routes/showroom-products.ts`

**Interfaces:**
- Consumes: `productPriceObservations`, `productShowroomPhotos`. Produces: the product-detail JSON gains `priceObservations` (grouped by `sourceType`, with `showroomId`→name resolved for showroom rows) and `photos`. This is the read surface subsystem B's PDP renders.

- [ ] **Step 1: Locate the product-context handler**

Run: `grep -rn "research/context\|priceObservations\|PricingIntelBlock" src/backend/api/routes src/frontend/components/products`
Identify the exact route returning the product detail payload.

- [ ] **Step 2: Add observations + photos to the payload**

In that handler, after loading the product, load observations joined to showroom names and the product photos, and include them in the response:

```ts
const observations = await db
  .select({
    obs: productPriceObservations,
    showroomName: showroomStores.name,
  })
  .from(productPriceObservations)
  .leftJoin(showroomStores, eq(showroomStores.id, productPriceObservations.showroomId))
  .where(eq(productPriceObservations.productId, id));

const photos = await db
  .select()
  .from(productShowroomPhotos)
  .where(eq(productShowroomPhotos.productId, id));

// add to the JSON response object:
//   priceObservations: observations.map(r => ({ ...r.obs, showroomName: r.showroomName })),
//   photos,
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "showroom-stores|showroom-products"` then `pnpm run build` — Expected: no new errors; build succeeds.

- [ ] **Step 4: Smoke the endpoint**

Run `wrangler dev` (or the repo's dev command) and `curl` the product-context route for a known product id; confirm `priceObservations` and `photos` arrays are present.

- [ ] **Step 5: Commit**

```bash
git add src/backend/api/routes/
git commit -m "feat(0020): product-detail API returns price observations + photos"
```

---

## Task 12: End-to-end verification + doc note

**Files:**
- Modify: `scripts/tests/test_global_products.mjs`
- Create: `docs/0020_global_products_showroom_pricing/README.md`

- [ ] **Step 1: Full smoke run**

Run: `NODE_NO_WARNINGS=1 npx tsx scripts/tests/test_global_products.mjs`
Expected: all `OK:` lines print, process exits 0.

- [ ] **Step 2: Full type-check gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "showroom/(store_products|price_observations|product_photos|index)|mcp/tools/(products|price_observations)|routes/(showroom-products|showroom-stores)|lib/normalize-model"`
Expected: no output (no errors in any file this plan touched).

- [ ] **Step 3: Build gate**

Run: `pnpm run build` — Expected: succeeds.

- [ ] **Step 4: Write the README**

Create `docs/0020_global_products_showroom_pricing/README.md` summarizing: what shipped (global product, bare mapping, observations, ragUuid photos), the migration order, and pointers to the spec + this plan. Note that subsystems B and C are separate plans.

- [ ] **Step 5: Commit**

```bash
git add scripts/tests/test_global_products.mjs docs/0020_global_products_showroom_pricing/README.md
git commit -m "feat(0020): e2e verification script + subsystem A README"
```

---

## Migration order (must run in this sequence)

1. Task 2 — create `product_price_observations`
2. Task 3 — create `product_showroom_photos` + FK
3. Task 4 — add `modelNumber`/`modelKey`/`msrp` (additive)
4. Task 5 — backfill (keys, mappings, observations)
5. Task 6 — dedup by `(brandId, modelKey)`
6. Task 7 — add unique index (after dedup)
7. Task 8 — drop `storeId`

On prod: run `pnpm run migrate:remote` once, after the whole sequence is verified locally. The tolerant applier (`d1-migrate.mjs`) makes re-runs safe.

## Self-review notes

- **Spec coverage:** A1 (Tasks 4,7,8) · A2 unchanged (no task, correct) · A3 (Task 3) · A4 (Task 2) · A5 (Tasks 5,6) · A6 (Tasks 9,10,11) · A7 risks (dedup enumeration guarded by Task 6 Step 4 orphan check; null-model# not merged) · A8 testing (node smoke script threaded through tasks). All covered.
- **Highest risk:** Task 6's child-table enumeration. Guarded by the orphan/duplicate-key asserts and the instruction to grep-verify table/column names before running.
- **Non-goals:** subsystems B and C are separate plans (browse-by/filters/PDP; photo AI+HITL+Vectorize). This plan produces a working, testable global-product model on its own.
