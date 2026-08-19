import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { saleCycles } from "./sale_cycles";
import { brands } from "../brands/brands";
import { categories } from "../config/categories";

/**
 * Sale Research Clusters — a group of cheap sale items scored together (0038).
 *
 * The triage orchestrator groups low-value commodity items by brand/category so
 * ONE surface pass amortizes across the whole cluster instead of a run per $99
 * item. The shared summary fans out to each member item's insight; the cluster
 * row keeps the group-level summary + a rough cost estimate for budget
 * accounting. Higher-value items get their own `item_surface`/`deep` handling
 * and are not clustered.
 */
export type SaleClusterTier = "group_surface" | "item_surface" | "deep";

export const saleResearchClusters = sqliteTable(
  "sale_research_clusters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → sale_cycles.id; deletes cascade with the cycle. */
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => saleCycles.id, { onDelete: "cascade" }),

    /** Brand this cluster is grouped on, when the items share one. Nullable FK. */
    brandId: integer("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),

    /** Category this cluster is grouped on. Nullable FK. */
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    /** How this cluster was handled. */
    tier: text("tier").$type<SaleClusterTier>().notNull(),

    itemCount: integer("item_count").notNull().default(0),

    /** Rough spend for budget accounting (cents). */
    estCostCents: integer("est_cost_cents").notNull().default(0),

    /** Shared group-surface finding — rich text (markdown source + html cache). */
    summaryMarkdown: text("summary_markdown"),
    summaryHtml: text("summary_html"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    cycleIdx: index("sale_research_clusters_cycle_idx").on(t.cycleId),
  }),
);

export type SaleResearchCluster = typeof saleResearchClusters.$inferSelect;
export type SaleResearchClusterInsert =
  typeof saleResearchClusters.$inferInsert;
