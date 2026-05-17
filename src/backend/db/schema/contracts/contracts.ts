import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { remodelScenarios } from "../home/remodel_scenarios";
import { estimateCompanies, estimates } from "../estimates/estimates";

export const contractStatuses = sqliteTable("contract_statuses", {
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

export const contracts = sqliteTable("contracts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),
  estimateCompanyId: integer("estimate_company_id").references(() => estimateCompanies.id, {
    onDelete: "set null",
  }),
  linkedEstimateId: integer("linked_estimate_id").references(() => estimates.id, {
    onDelete: "set null",
  }),
  currentRevisionId: integer("current_revision_id"),
  contractRequired: integer("contract_required", { mode: "boolean" }).notNull().default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractRevisions = sqliteTable("contract_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull().default(1),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  isLatest: integer("is_latest", { mode: "boolean" }).notNull().default(true),
  contractStatusId: integer("contract_status_id").references(() => contractStatuses.id, {
    onDelete: "set null",
  }),
  aiRationale: text("ai_rationale"),
  statusNotes: text("status_notes"),
  changeSource: text("change_source").notNull().default("manual"),
  createdBy: text("created_by"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractDocuments = sqliteTable("contract_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRevisionId: integer("contract_revision_id")
    .notNull()
    .references(() => contractRevisions.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull().default("contract"), // contract | addendum | change_order | email_artifact
  r2ObjectKey: text("r2_object_key"),
  r2Url: text("r2_url"),
  rawText: text("raw_text"),
  aiExtractionJson: text("ai_extraction_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractClauseFindings = sqliteTable("contract_clause_findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRevisionId: integer("contract_revision_id")
    .notNull()
    .references(() => contractRevisions.id, { onDelete: "cascade" }),
  clauseType: text("clause_type").notNull(), // warranty | indemnity | delay | lien_waiver | dispute | cancellation | insurance | scope_exclusion
  riskLevel: text("risk_level").notNull().default("info"), // info | low | medium | high
  findingText: text("finding_text").notNull(),
  recommendation: text("recommendation"),
  sourceSnippet: text("source_snippet"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractPaymentMilestones = sqliteTable("contract_payment_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRevisionId: integer("contract_revision_id")
    .notNull()
    .references(() => contractRevisions.id, { onDelete: "cascade" }),
  milestoneName: text("milestone_name").notNull(),
  dueCriteria: text("due_criteria"),
  amountCents: integer("amount_cents"),
  dueStartAt: integer("due_start_at", { mode: "timestamp" }),
  dueEndAt: integer("due_end_at", { mode: "timestamp" }),
  completionEvidenceRequired: text("completion_evidence_required"),
  approvalStatus: text("approval_status").notNull().default("pending"), // pending | approved | rejected
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractTimelineMilestones = sqliteTable("contract_timeline_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRevisionId: integer("contract_revision_id")
    .notNull()
    .references(() => contractRevisions.id, { onDelete: "cascade" }),
  milestoneName: text("milestone_name").notNull(),
  plannedAt: integer("planned_at", { mode: "timestamp" }),
  actualAt: integer("actual_at", { mode: "timestamp" }),
  delayReason: text("delay_reason"),
  noticeWindow: text("notice_window"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractWarrantyTerms = sqliteTable("contract_warranty_terms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRevisionId: integer("contract_revision_id")
    .notNull()
    .references(() => contractRevisions.id, { onDelete: "cascade" }),
  durationText: text("duration_text"),
  scopeText: text("scope_text"),
  exclusionsText: text("exclusions_text"),
  startTrigger: text("start_trigger"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractNegotiationItems = sqliteTable("contract_negotiation_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractRevisionId: integer("contract_revision_id")
    .notNull()
    .references(() => contractRevisions.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  aiRecommendation: text("ai_recommendation"),
  userDecision: text("user_decision"), // accepted | rejected | deferred
  dispositionNotes: text("disposition_notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const contractMonitoringEvents = sqliteTable("contract_monitoring_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contractId: integer("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  contractRevisionId: integer("contract_revision_id").references(() => contractRevisions.id, {
    onDelete: "set null",
  }),
  relatedEstimateId: integer("related_estimate_id").references(() => estimates.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(), // email_detected | milestone_warning | risk_update | payment_claim
  source: text("source").notNull().default("system"),
  summary: text("summary").notNull(),
  payloadJson: text("payload_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

