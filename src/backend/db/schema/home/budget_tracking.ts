import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const budgetRows = sqliteTable("budget_rows", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  itemName: text("item_name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
});

export const syncSessions = sqliteTable("sync_sessions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // 'PULL_SYNC', 'PUSH_UPDATE'
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  payload: text("payload", { mode: "json" }),
});

export const budgetRowRevisions = sqliteTable("budget_row_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  budgetRowId: text("budget_row_id")
    .references(() => budgetRows.id)
    .notNull(),
  costExpression: text("cost_expression").notNull(),
  sessionId: text("session_id")
    .references(() => syncSessions.id)
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
