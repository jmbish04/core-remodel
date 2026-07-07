import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { supportingDocuments } from "./supporting_documents";

/**
 * Generic polymorphic associations between a supporting document and any other
 * entity in the system (company, brand, product, showroom, permit, floor, ...).
 *
 * This complements — and does not replace — the existing purpose-built mapping
 * tables in `supporting_documents.ts` (`supportingDocumentRoomMappings`,
 * `supportingDocumentScenarioMappings`, `supportingDocumentVisionNodeMappings`),
 * which stay as-is for room/scenario/vision-node relationships. Use this table
 * for everything else (Phase 3 CRM entities, showroom items, permits, floors, etc.)
 * without needing a new mapping table per entity type.
 *
 * `entityId` is the stringified primary key of the target entity. There is no
 * foreign key on `entityId` since the target table varies by `entityType`.
 */
export const documentEntityAssociations = sqliteTable(
  "document_entity_associations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    documentId: text("document_id")
      .notNull()
      .references(() => supportingDocuments.id, { onDelete: "cascade" }),

    /** 'company' | 'brand' | 'product' | 'showroom' | 'permit' | 'floor' */
    entityType: text("entity_type").notNull(),

    /** Stringified primary key of the target entity (polymorphic, no FK). */
    entityId: text("entity_id").notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    documentEntityUnique: uniqueIndex("document_entity_associations_unique").on(
      table.documentId,
      table.entityType,
      table.entityId,
    ),
    entityLookupIdx: index("document_entity_associations_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  }),
);

export type DocumentEntityAssociation = typeof documentEntityAssociations.$inferSelect;
export type DocumentEntityAssociationInsert = typeof documentEntityAssociations.$inferInsert;
