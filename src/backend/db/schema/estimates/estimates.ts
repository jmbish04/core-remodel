import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { remodelScenarios } from "../home/remodel_scenarios";
import { rooms } from "../home/rooms";
import { services } from "../services/services";

export const estimateStatuses = sqliteTable("estimate_statuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isTerminal: integer("is_terminal", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateCompanies = sqliteTable("estimate_companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  businessType: text("business_type").notNull().default("unknown"),
  website: text("website"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  cslbLicenseNumber: text("cslb_license_number"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateCompanyContacts = sqliteTable("estimate_company_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateCompanyId: integer("estimate_company_id").references(() => estimateCompanies.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  source: text("source").notNull().default("manual"),
  mappingStatus: text("mapping_status").notNull().default("mapped"), // mapped | needs_mapping
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimates = sqliteTable("estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),
  estimateCompanyId: integer("estimate_company_id").references(() => estimateCompanies.id, {
    onDelete: "set null",
  }),
  currentRevisionId: integer("current_revision_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateRevisions = sqliteTable("estimate_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateId: integer("estimate_id")
    .notNull()
    .references(() => estimates.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull().default(1),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  isLatest: integer("is_latest", { mode: "boolean" }).notNull().default(true),
  estimateStatusId: integer("estimate_status_id").references(() => estimateStatuses.id, {
    onDelete: "set null",
  }),
  statusNotes: text("status_notes"),
  dateEstimate: integer("date_estimate", { mode: "timestamp" }),
  totalAmountCents: integer("total_amount_cents"),
  totalTaxCents: integer("total_tax_cents"),
  depositAmountCents: integer("deposit_amount_cents"),
  warrantyDetails: text("warranty_details"),
  cancellationDetails: text("cancellation_details"),
  aiRationale: text("ai_rationale"),
  changeSource: text("change_source").notNull().default("manual"),
  createdBy: text("created_by"),
  sourceSummary: text("source_summary"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateRevisionSnapshots = sqliteTable("estimate_revision_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateRevisionId: integer("estimate_revision_id")
    .notNull()
    .references(() => estimateRevisions.id, { onDelete: "cascade" }),
  snapshotType: text("snapshot_type").notNull().default("autosave"),
  snapshotJson: text("snapshot_json").notNull(), // wizard payload at autosave time
  createdBy: text("created_by"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateDocuments = sqliteTable("estimate_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateRevisionId: integer("estimate_revision_id")
    .notNull()
    .references(() => estimateRevisions.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // pdf | photo | url | free_text | audio_transcript
  r2ObjectKey: text("r2_object_key"),
  r2Url: text("r2_url"),
  sourceUrl: text("source_url"),
  rawText: text("raw_text"),
  rawMarkdown: text("raw_markdown"),
  aiStructuredExtractionJson: text("ai_structured_extraction_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateLineItems = sqliteTable(
  "estimate_line_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    estimateRevisionId: integer("estimate_revision_id")
      .notNull()
      .references(() => estimateRevisions.id, { onDelete: "cascade" }),
    itemCode: text("item_code"),
    description: text("description").notNull(),
    qty: real("qty"),
    uom: text("uom"),
    unitCostCents: integer("unit_cost_cents"),
    lineTotalCents: integer("line_total_cents"),
    taxCents: integer("tax_cents"),
    notes: text("notes"),
    // Billed service (labor/design/consulting) this line item bills against,
    // for business/architect/consulting estimates that bill services rather
    // than materials. Nullable — most line items are material-based.
    serviceId: integer("service_id").references(() => services.id, { onDelete: "set null" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byServiceId: index("idx_estimate_line_items_service_id").on(t.serviceId),
  }),
);

export const estimateRoomMappings = sqliteTable("estimate_room_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateRevisionId: integer("estimate_revision_id")
    .notNull()
    .references(() => estimateRevisions.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateSourceEvents = sqliteTable("estimate_source_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateRevisionId: integer("estimate_revision_id")
    .notNull()
    .references(() => estimateRevisions.id, { onDelete: "cascade" }),
  estimateDocumentId: integer("estimate_document_id").references(() => estimateDocuments.id, {
    onDelete: "set null",
  }),
  sourceType: text("source_type").notNull(),
  eventType: text("event_type").notNull(), // ingest | extract | confirm | autosave | submit
  payloadJson: text("payload_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimatePropKeyTypes = sqliteTable("estimate_prop_key_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  property: text("property").notNull().unique(),
  dataType: text("data_type").notNull(),
  schemaVersion: text("schema_version").notNull().default("v1"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimatePropValues = sqliteTable("estimate_prop_values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateRevisionId: integer("estimate_revision_id")
    .notNull()
    .references(() => estimateRevisions.id, { onDelete: "cascade" }),
  estimateDocumentId: integer("estimate_document_id").references(() => estimateDocuments.id, {
    onDelete: "set null",
  }),
  property: text("property").notNull(),
  estimatePropKeyTypeId: integer("estimate_prop_key_type_id")
    .notNull()
    .references(() => estimatePropKeyTypes.id, { onDelete: "cascade" }),
  workerAiExtractedValue: text("workerai_extracted_value"),
  intakeFormValue: text("intake_form_value"),
  isUserOverridden: integer("is_user_overridden", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const estimateSyncState = sqliteTable("estimate_sync_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  target: text("target").notNull().default("google_sheets"),
  lastPullAt: integer("last_pull_at", { mode: "timestamp" }),
  lastPushAt: integer("last_push_at", { mode: "timestamp" }),
  cursorValue: text("cursor_value"),
  syncHash: text("sync_hash"),
  notes: text("notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
