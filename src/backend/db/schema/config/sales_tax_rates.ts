import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Sales Tax Rates — the rate that applies to goods delivered to the property.
 *
 * Exactly ONE rate matters. California district tax on delivered goods is
 * sourced to the delivery location, so a showroom in San Mateo shipping to the
 * San Francisco job site should be collecting at the SF rate. That means there
 * is nothing to gain from tracking other jurisdictions' rates: a quote states
 * what it charged, and this table states what it should have charged. The
 * comparison needs no third number.
 *
 * Rows are resolved automatically from CDTFA's free, unauthenticated address
 * lookup using the property address already configured for the permit pipeline
 * (`permits_target_address` / `permits_target_city` / `permits_target_zip`).
 *
 * `ratePpm` is parts per million as an INTEGER: 8.625% => 86250. Never a float —
 * a float rate multiplied against integer cents drifts, and money is integer
 * cents throughout this codebase.
 *
 *     taxCents = Math.round(merchandiseCents * ratePpm / 1_000_000)
 *
 * Rows are INSERT-ONLY. A rate change closes the current row's `effectiveTo` and
 * inserts a new one — it never updates in place. That is what lets a quote
 * issued last quarter still reconcile against the rate that was live when it was
 * written; updating in place would silently re-check every historical quote
 * against a rate that did not exist at the time.
 */
export const salesTaxRates = sqliteTable(
  "sales_tax_rates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Parts per million. 8.625% => 86250. */
    ratePpm: integer("rate_ppm").notNull(),

    /** CDTFA's name for the taxing jurisdiction, e.g. "SAN FRANCISCO". */
    jurisdiction: text("jurisdiction"),
    county: text("county"),
    /** CDTFA Tax Area Code — the authoritative identifier for the jurisdiction. */
    tac: text("tac"),

    /** ISO date (YYYY-MM-DD). */
    effectiveFrom: text("effective_from").notNull(),
    /** Null = currently in effect. Set to supersede; never delete a rate. */
    effectiveTo: text("effective_to"),

    source: text("source", { enum: ["cdtfa_api", "manual"] })
      .notNull()
      .default("cdtfa_api"),

    /**
     * The address string this rate was resolved for. Provenance: if the property
     * address later changes, it is obvious that the stored rate predates it.
     */
    resolvedAddress: text("resolved_address"),

    /** Free-text, e.g. a manual override's justification. */
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    effectiveToIdx: index("sales_tax_rates_effective_to_idx").on(table.effectiveTo),
    // At most ONE open-ended rate may exist. Enforced in the DB, not just in
    // recordRate(), because two rows with effectiveTo NULL would make "the rate
    // right now" ambiguous — and every quote check reads that one row.
    // Indexes a constant so the uniqueness applies to the filtered set itself.
    oneActiveRate: uniqueIndex("sales_tax_rates_one_active_uniq")
      .on(sql`(1)`)
      .where(sql`${table.effectiveTo} IS NULL`),
  }),
);

export type SalesTaxRate = typeof salesTaxRates.$inferSelect;
export type SalesTaxRateInsert = typeof salesTaxRates.$inferInsert;
