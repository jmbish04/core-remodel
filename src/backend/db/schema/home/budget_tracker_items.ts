import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { workerEmailInvoices } from "../emails/worker_email_invoices";
import { budgetPhases } from "./budget_phases";
import { remodelScenarios } from "./remodel_scenarios";
import { rooms } from "./rooms";

/**
 * Budget planning tracker with immutable revision chaining.
 *
 * Updates are handled as "insert new revision + mark previous inactive".
 * trackId is the stable identity across revisions.
 */
export const budgetTrackerItems = sqliteTable("budget_tracker_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id").notNull(),
  revisionNumber: integer("revision_number").notNull().default(1),

  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  replacedByItemId: integer("replaced_by_item_id"),
  replacedAt: integer("replaced_at", { mode: "timestamp" }),

  itemType: text("item_type").notNull().default("project"), // project | professional_service | estimate | contract
  executionClass: text("execution_class").notNull().default("must_now"), // must_now | future_tbd | option
  optionGroup: text("option_group"), // e.g. kitchen_path, upstairs_layout, window_strategy
  optionKey: text("option_key"),

  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // open | researching | blocked | approved | done

  riskLevel: text("risk_level").notNull().default("medium"), // low | medium | high
  isBottleneck: integer("is_bottleneck", { mode: "boolean" }).notNull().default(false),
  bottleneckReason: text("bottleneck_reason"),

  estimatedLowCents: integer("estimated_low_cents"),
  estimatedHighCents: integer("estimated_high_cents"),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),

  // 0035 grid: which build phase this line rolls up under (grid grouping).
  // Nullable — unphased items land in an "Unphased" group in the grid.
  phaseId: integer("phase_id").references(() => budgetPhases.id, {
    onDelete: "set null",
  }),

  // 0035 grid: optional authored note explaining a line's variance flag.
  // PlateJS markdown (source of truth) + sanitized html cache (rich-text rule).
  // WRITE CONTRACT (no writer exists yet — this binds the one that adds it): the
  // two columns must be updated together through a single helper that sanitizes
  // the html on write; never persist one without the other, and never store
  // unsanitized html (stored-XSS). The markdown is authoritative — a reader that
  // distrusts the cache should re-render from markdown rather than trust html.
  varianceNoteMarkdown: text("variance_note_markdown"),
  varianceNoteHtml: text("variance_note_html"),

  owner: text("owner"),
  aiRationale: text("ai_rationale"),
  changeSource: text("change_source").notNull().default("manual"),
  changedBy: text("changed_by"),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  // Budget Command Center grid (GET /api/budget/grid): WHERE isActive = true,
  // grouped by phaseId. Covers both in one index.
  activePhaseIdx: index("idx_bti_active_phase").on(t.isActive, t.phaseId),
}));

/**
 * Many-to-many mapping between tracker item revisions and rooms.
 */
export const budgetTrackerItemRooms = sqliteTable("budget_tracker_item_rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  budgetTrackerItemId: integer("budget_tracker_item_id")
    .notNull()
    .references(() => budgetTrackerItems.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  // Room finance rollup (GET /api/budget/rooms-finance) joins this mapping by
  // roomId; the PK leads with the item id so it cannot serve a roomId lookup.
  roomIdx: index("idx_btir_room").on(t.roomId),
}));

/**
 * Sync idempotency and audit events for Google Sheets push/pull.
 */
export const googleSheetSyncEvents = sqliteTable("google_sheet_sync_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  target: text("target").notNull().default("google_sheets"),
  direction: text("direction").notNull(), // pull | push
  idempotencyKey: text("idempotency_key").notNull().unique(),
  cursorValue: text("cursor_value"),
  syncHash: text("sync_hash"),
  requestJson: text("request_json"),
  resultJson: text("result_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Project profile values mirrored to the sheet's Project Information section.
 * Stored as key/value so the model stays flexible as the homeowner evolves fields.
 */
export const budgetProjectInfo = sqliteTable("budget_project_info", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  infoKey: text("info_key").notNull().unique(), // project_name, contractor, contact_name...
  infoLabel: text("info_label").notNull(),
  infoValue: text("info_value"),
  notes: text("notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Budget funding pools used for available-funds tracking.
 * Example keys: cash_amount, financed_amount.
 */
export const budgetFundingAccounts = sqliteTable("budget_funding_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountKey: text("account_key").notNull().unique(),
  accountLabel: text("account_label").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  notes: text("notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Actual itemized expenses with immutable revision chaining.
 */
export const budgetExpenseEntries = sqliteTable("budget_expense_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id").notNull(),
  revisionNumber: integer("revision_number").notNull().default(1),

  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  replacedByExpenseId: integer("replaced_by_expense_id"),
  replacedAt: integer("replaced_at", { mode: "timestamp" }),

  item: text("item").notNull(),
  category: text("category").notNull().default("general"),
  amountCents: integer("amount_cents").notNull().default(0),
  vendorName: text("vendor_name"),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),

  // 0035: attach an actual to the budget line it belongs to. TEXT + NO FK —
  // budget items revision in place, so we key on the stable trackId (same
  // pattern as budget_item_material_mappings), NOT the dangling row id. This is
  // what lets the grid roll actuals up per line and bucket them by month.
  budgetItemTrackId: text("budget_item_track_id"),

  // 0035: room + source-invoice attribution for the workbench room rollups.
  // Nullable FKs; floor is derived by JOIN rooms.floor_id (no denormalized copy).
  roomId: integer("room_id").references(() => rooms.id, {
    onDelete: "set null",
  }),
  invoiceId: integer("invoice_id").references(() => workerEmailInvoices.id, {
    onDelete: "set null",
  }),
  optionGroup: text("option_group"),
  optionKey: text("option_key"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceRef: text("source_ref"),
  dateIncurred: integer("date_incurred", { mode: "timestamp" }),
  notes: text("notes"),

  changeSource: text("change_source").notNull().default("manual"),
  changedBy: text("changed_by"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  // Budget Command Center grid actuals rollup (GET /api/budget/grid): WHERE
  // isActive = true AND dateIncurred in range, GROUP BY budgetItemTrackId +
  // strftime month.
  activeTrackDateIdx: index("idx_bee_active_track_date").on(
    t.isActive,
    t.budgetItemTrackId,
    t.dateIncurred,
  ),
  // Room finance rollup (GET /api/budget/rooms-finance): WHERE isActive = true
  // GROUP BY roomId. Without this the per-room spend subquery scans the table.
  activeRoomIdx: index("idx_bee_active_room").on(t.isActive, t.roomId),
  // Budget grid footer net-burn (GET /api/budget/grid): WHERE isActive = true
  // AND dateIncurred BETWEEN ..., summed across ALL expenses regardless of
  // budgetItemTrackId attribution — activeTrackDateIdx leads with
  // budgetItemTrackId so it can't serve this range scan alone.
  activeDateIdx: index("idx_bee_active_date").on(t.isActive, t.dateIncurred),
}));
