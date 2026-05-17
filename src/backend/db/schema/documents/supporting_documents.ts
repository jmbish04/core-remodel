import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { images } from "../images/images";
import { remodelScenarios } from "../home/remodel_scenarios";
import { rooms } from "../home/rooms";

/**
 * Canonical supporting-document records used across remodel planning.
 * Includes PDFs, screenshots, videos, image snippets, notes, and external URLs.
 */
export const supportingDocuments = sqliteTable("supporting_documents", {
  id: text("id").primaryKey(), // UUID
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(), // pdf | image | video | screenshot | url | text | other
  mimeType: text("mime_type"),
  r2ObjectKey: text("r2_object_key"),
  r2Url: text("r2_url"),
  externalUrl: text("external_url"),
  description: text("description"),
  tagsJson: text("tags_json"), // JSON string[]
  metadata: text("metadata"), // JSON

  // Immutable/revision semantics for facts and updated artifacts.
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isFactRecord: integer("is_fact_record", { mode: "boolean" }).notNull().default(false),
  revisionNumber: integer("revision_number").notNull().default(1),
  revisionOfId: text("revision_of_id").references(() => supportingDocuments.id, {
    onDelete: "set null",
  }),
  replacedById: text("replaced_by_id").references(() => supportingDocuments.id, {
    onDelete: "set null",
  }),
  aiRationale: text("ai_rationale"),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Supporting documents can be tied to multiple rooms.
 */
export const supportingDocumentRoomMappings = sqliteTable(
  "supporting_document_room_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    supportingDocumentId: text("supporting_document_id")
      .notNull()
      .references(() => supportingDocuments.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    docRoomUnique: uniqueIndex("supporting_document_room_unique").on(
      table.supportingDocumentId,
      table.roomId,
    ),
  }),
);

/**
 * Supporting documents can be tied to one or more top-level scenarios.
 */
export const supportingDocumentScenarioMappings = sqliteTable(
  "supporting_document_scenario_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    supportingDocumentId: text("supporting_document_id")
      .notNull()
      .references(() => supportingDocuments.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id")
      .notNull()
      .references(() => remodelScenarios.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    docScenarioUnique: uniqueIndex("supporting_document_scenario_unique").on(
      table.supportingDocumentId,
      table.scenarioId,
    ),
  }),
);

/**
 * Forkable vision nodes that model branching remodel options.
 */
export const visionPlanNodes = sqliteTable("vision_plan_nodes", {
  id: text("id").primaryKey(), // UUID
  parentId: text("parent_id").references(() => visionPlanNodes.id, {
    onDelete: "set null",
  }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  summary: text("summary"),
  nodeType: text("node_type").notNull().default("option"), // root | branch | option | risk | milestone
  status: text("status").notNull().default("considering"), // considering | preferred | deferred | blocked | decided
  estimatedCostCents: integer("estimated_cost_cents"),
  sortOrder: integer("sort_order").notNull().default(0),
  thumbnailImageId: text("thumbnail_image_id").references(() => images.id, {
    onDelete: "set null",
  }),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Bridge between supporting docs and vision nodes.
 */
export const supportingDocumentVisionNodeMappings = sqliteTable(
  "supporting_document_vision_node_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    supportingDocumentId: text("supporting_document_id")
      .notNull()
      .references(() => supportingDocuments.id, { onDelete: "cascade" }),
    visionNodeId: text("vision_node_id")
      .notNull()
      .references(() => visionPlanNodes.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    docVisionUnique: uniqueIndex("supporting_document_vision_node_unique").on(
      table.supportingDocumentId,
      table.visionNodeId,
    ),
  }),
);

/**
 * Optional room bindings per vision node.
 */
export const visionNodeRoomMappings = sqliteTable(
  "vision_node_room_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    visionNodeId: text("vision_node_id")
      .notNull()
      .references(() => visionPlanNodes.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    nodeRoomUnique: uniqueIndex("vision_node_room_unique").on(table.visionNodeId, table.roomId),
  }),
);

/**
 * Optional image bindings per vision node (listing/inspiration/render references).
 */
export const visionNodeImageMappings = sqliteTable(
  "vision_node_image_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    visionNodeId: text("vision_node_id")
      .notNull()
      .references(() => visionPlanNodes.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("reference"), // reference | before | inspiration | target_render
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    nodeImageUnique: uniqueIndex("vision_node_image_unique").on(
      table.visionNodeId,
      table.imageId,
      table.relationType,
    ),
  }),
);
