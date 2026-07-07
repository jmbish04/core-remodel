import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { workstationBoards } from "./workstation_boards";

/**
 * photo_collections — "piles", the docked, hover-to-expand stacks of photos on
 * the side rail of a room's Workshop board
 * (see docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md
 * §"Brainstorming primitives — stackable photo collections").
 *
 * Piles are a frictionless sorting tool distinct from `mood_boards` (curated,
 * user-authored deliverables) and the Sample Library (`sample_clippings`,
 * surgically extracted regions, not whole photos). A pile can later graduate
 * into a mood board.
 *
 * Naming is optional at creation — the whole point of a pile is instant capture.
 */
export const photoCollections = sqliteTable(
  "photo_collections",
  {
    id: text("id").primaryKey(), // UUID
    boardId: text("board_id")
      .notNull()
      .references(() => workstationBoards.id, { onDelete: "cascade" }),
    // Optional — piles start unnamed; can be named later or never.
    name: text("name"),
    // Position of this pile's dock in the side rail (lower = higher/first).
    dockSlot: integer("dock_slot").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    boardIdIdx: index("photo_collections_board_id_idx").on(table.boardId),
  }),
);

/**
 * photo_collection_items — membership rows for a pile. A photo's `cfImageUrl`
 * may appear in many piles, but only once within the same pile (see
 * `collectionImageUnique`) — re-adding the same photo to a pile is a no-op, not
 * a duplicate.
 */
export const photoCollectionItems = sqliteTable(
  "photo_collection_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => photoCollections.id, { onDelete: "cascade" }),
    // Denormalized delivery URL, matching board_nodes.cfImageUrl's rationale —
    // renders the pile's spring-out view without a join per item.
    cfImageUrl: text("cf_image_url").notNull(),
    // Same enum as board_nodes.sourceType — what kind of record this photo came from.
    sourceType: text("source_type", {
      enum: ["listing_photo", "blank_canvas", "inspiration", "clipping", "render"],
    }).notNull(),
    // Stringified PK of the source record. Nullable for ad-hoc items.
    sourceId: text("source_id"),
    // User-controlled ordering within the expanded pile view (DnD reorder).
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    collectionIdIdx: index("photo_collection_items_collection_id_idx").on(table.collectionId),
    // A photo appears at most once per pile.
    collectionImageUnique: uniqueIndex("photo_collection_items_collection_image_unique").on(
      table.collectionId,
      table.cfImageUrl,
    ),
  }),
);
