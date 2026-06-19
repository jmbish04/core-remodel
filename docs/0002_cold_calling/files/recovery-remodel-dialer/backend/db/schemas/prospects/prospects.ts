import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/**
 * Prospects = the independent drafters / designers / permit expediters
 * surfaced from the SF DBI permit + contacts datasets (i98e-djp9 + 3pee-9qhc).
 * These columns are STATIC, permit-derived facts. Mutable call-tracking state
 * lives in prospect_state (1:1).
 */
export const prospects = sqliteTable("prospects", {
  id: text("id").primaryKey(), // slug, e.g. "aaron-lim"
  rank: integer("rank").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name").notNull(),
  firm: text("firm"),
  roles: text("roles").notNull(), // "architect/designer/expediter"
  permitCount: integer("permit_count").notNull(),
  avgCost: integer("avg_cost"),
  medianCost: integer("median_cost"),
  scopeKeywords: text("scope_keywords"),
  isUnbundledCandidate: integer("is_unbundled_candidate", { mode: "boolean" }).notNull().default(false),
  collisionRisk: integer("collision_risk", { mode: "boolean" }).notNull().default(false),

  // Contact info — populated ONLY where verified. Never fabricated.
  phone: text("phone"),
  phoneSource: text("phone_source"),
  email: text("email"),
  emailSource: text("email_source"),
  website: text("website"),
  contactStatus: text("contact_status").notNull().default("needs_research"), // verified | partial | needs_research
  licenseNote: text("license_note"),

  callScript: text("call_script").notNull(),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const prospectInsertSchema = createInsertSchema(prospects);
export const prospectSelectSchema = createSelectSchema(prospects);
