import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * dialer_prospect_state = the cold-caller's working memory for each prospect.
 * 1:1 with dialer_prospects. Upserted from the UI.
 */
export const dialerProspectState = sqliteTable("dialer_prospect_state", {
  prospectId: text("prospect_id").primaryKey(),
  // not_called | attempted | no_answer | voicemail | connected
  disposition: text("disposition").notNull().default("not_called"),
  rating: integer("rating"), // 1..5
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  leftVoicemail: integer("left_voicemail", { mode: "boolean" }).notNull().default(false),
  // null = unknown, true = available/good, false = not available / bad feeling
  availableToHire: integer("available_to_hire", { mode: "boolean" }),
  goodFeeling: integer("good_feeling", { mode: "boolean" }),
  notes: text("notes"),
  callCount: integer("call_count").notNull().default(0),
  emailedAt: text("emailed_at"),
  lastContactedAt: text("last_contacted_at"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
});

/**
 * dialer_call_attempts = append-only history of every dial, for an audit trail.
 */
export const dialerCallAttempts = sqliteTable("dialer_call_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prospectId: text("prospect_id").notNull(),
  outcome: text("outcome").notNull(), // no_answer | voicemail | connected | callback
  note: text("note"),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});
