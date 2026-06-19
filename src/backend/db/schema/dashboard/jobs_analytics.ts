import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Table for job analytics data, housing geographic, temporal, and category/keyword statistics
 * to back rich data visualizations (MapCN, LiveLineChart, SankeyChart).
 */
export const dashboardAnalyticsJobs = sqliteTable(
  "dashboard_analytics_jobs",
  {
    id: text("id").primaryKey(),
    jobTitle: text("job_title").notNull(),
    category: text("category").notNull(), // e.g. "kitchen", "shower", "drywall", "electrical"
    region: text("region").notNull(), // e.g. "San Francisco", "East Bay", "South Bay", "North Bay"
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    bidAmount: real("bid_amount").notNull(),
    keywords: text("keywords").notNull(), // comma-separated strings (e.g. "modern,tile,glass")
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRegion: index("idx_analytics_region").on(t.region),
    byCategory: index("idx_analytics_category").on(t.category),
  })
);

export type DashboardAnalyticsJob = typeof dashboardAnalyticsJobs.$inferSelect;
export type DashboardAnalyticsJobInsert = typeof dashboardAnalyticsJobs.$inferInsert;
