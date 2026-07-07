import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { companies } from "./companies";

/**
 * Action items / follow-ups attached to a company (CRM roadmap P3-04).
 */
export const companyTodos = sqliteTable(
  "company_todos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"), // JSON string of PlateJS Slate nodes, nullable
    // status: "open" | "in_progress" | "blocked" | "done"
    status: text("status").notNull().default("open"),
    dueDate: integer("due_date", { mode: "timestamp" }),
    owner: text("owner"),
    tagsJson: text("tags_json"), // JSON string of string[]
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byCompanyId: index("idx_company_todos_company_id").on(t.companyId),
    byCompanyIdStatus: index("idx_company_todos_company_id_status").on(
      t.companyId,
      t.status,
    ),
  }),
);

export type CompanyTodo = typeof companyTodos.$inferSelect;
export type CompanyTodoInsert = typeof companyTodos.$inferInsert;
