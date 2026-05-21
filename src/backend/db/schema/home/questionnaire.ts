import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { remodelScenarios } from "./remodel_scenarios";
import { rooms } from "./rooms";

/**
 * Construction-questionnaire section definitions.
 *
 * Drives the dynamic `/questionnaire/[section_slug]` routes — new rows automatically
 * hydrate the UI without any frontend route registration changes.
 */
export const checklistSections = sqliteTable("checklist_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  helperText: text("helper_text"),
  iconIdentifier: text("icon_identifier").notNull().default("HelpCircle"),
  sortOrder: integer("sort_order").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Individual questions belonging to a section. `defaultBudgetImpactJson` carries
 * the auto-trigger rule that emits a `budget_tracker_items` shadow row when an
 * answer is committed (not draft).
 *
 * Shape of defaultBudgetImpactJson:
 *   { title: string, lowCents: number, highCents: number, executionClass?: string }
 */
export const checklistQuestions = sqliteTable("checklist_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id")
    .notNull()
    .references(() => checklistSections.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  questionText: text("question_text").notNull(),
  considerations: text("considerations"),
  defaultBudgetImpactJson: text("default_budget_impact_json"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Versioned answer rows. `trackId` is the stable identity across revisions.
 * When an answer changes, the previous row is marked `isActive=false` and a new
 * row inserted with `version + 1`. Drafts (`isDraft=true`) do not trigger
 * downstream budget side-effects.
 */
export const checklistAnswers = sqliteTable("checklist_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => checklistQuestions.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),
  isChecked: integer("is_checked", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  selectionValue: text("selection_value"),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  changeSource: text("change_source").notNull().default("manual"), // manual | portal_submission | copilot_rpc
  changedBy: text("changed_by").notNull().default("homeowner"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Question-to-room associations with strict three-state HITL retention.
 *
 * `associationStatus` values:
 *   - "ai_suggested"      — written by the rationale workflow; safe to overwrite.
 *   - "user_confirmed"    — homeowner explicitly accepted; NEVER overwrite.
 *   - "user_disassociated"— homeowner removed it; NEVER re-add automatically.
 *
 * The AI rationale workflow must filter out `user_*` rows before upserting.
 */
export const checklistRoomMappings = sqliteTable(
  "checklist_room_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => checklistQuestions.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    aiRationale: text("ai_rationale"),
    associationStatus: text("association_status").notNull().default("ai_suggested"),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    questionRoomUnique: uniqueIndex("checklist_room_mappings_unique").on(
      table.questionId,
      table.roomId,
    ),
  }),
);

/**
 * Material selection ledger per room. Money is stored as integer cents to avoid
 * floating-point rounding. Contractors fill `contractorDiscountOfferCents` and
 * `contractorNotes` after homeowner posts the initial quote.
 */
export const roomMaterialQuotes = sqliteTable("room_material_quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  materialName: text("material_name").notNull(),
  supplierName: text("supplier_name"),
  homeownerQuoteCents: integer("homeowner_quote_cents").notNull().default(0),
  contractorDiscountOfferCents: integer("contractor_discount_offer_cents"),
  contractorNotes: text("contractor_notes"),
  status: text("status").notNull().default("pending_review"), // pending_review | approved | counter_offered
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Audit log emitted by the AI rationale workflow. One row per run.
 */
export const checklistServiceLogs = sqliteTable("checklist_service_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(), // success | bypassed | execution_failure
  processedRecordsCount: integer("processed_records_count").notNull().default(0),
  chainOfThoughtDump: text("chain_of_thought_dump"),
  datetimeExecuted: integer("datetime_executed", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
