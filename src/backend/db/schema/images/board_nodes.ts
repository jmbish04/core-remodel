import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { renderCanvases } from "./render_canvases";
import { workstationBoards } from "./workstation_boards";

/**
 * board_nodes — a single draggable item on a `workstation_boards` canvas
 * (see docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md §"Front door").
 *
 * The `devl.dev` canvas-tools shell owns pan/zoom/selection chrome in the client;
 * this table is the domain layer underneath it — server persistence for node
 * position/size/z-order plus provenance/lineage so the board survives reloads
 * and multi-session use ("come and go").
 *
 * Lineage: `parentNodeId` is the on-board edge back to the node this one was
 * derived from (e.g. "extract" or "restyle" produced a child node next to its
 * source). This is independent from `renderCanvases.parentCanvasId`, which
 * tracks lineage inside the staged render state tree — a board node can point
 * into that tree via `renderCanvasId` while ALSO having its own on-board parent
 * edge for where it was dropped/spawned on the canvas.
 */
export const boardNodes = sqliteTable(
  "board_nodes",
  {
    id: text("id").primaryKey(), // UUID
    boardId: text("board_id")
      .notNull()
      .references(() => workstationBoards.id, { onDelete: "cascade" }),
    // Node type on the canvas. 'image' is the original Slice-1 kind;
    // rectangle/ellipse/text/pen are devl.dev vector-shape template-parity
    // kinds (visual props live in `metadata` JSON); 'note'/'group' remain
    // reserved for future free-text annotations and node-grouping. This is a
    // TypeScript-level constraint only — SQLite has no native enum
    // enforcement on a text column, so widening it requires no migration.
    kind: text("kind", {
      enum: ["image", "note", "group", "rectangle", "ellipse", "text", "pen"],
    }).notNull(),
    // Cloudflare Images delivery URL rendered for this node (denormalized for the
    // canvas renderer — avoids a join per node on every board load).
    cfImageUrl: text("cf_image_url").notNull(),
    // What kind of record this node's image came from. Determines how sourceId is
    // interpreted (or ignored, for render — see renderCanvasId instead).
    sourceType: text("source_type", {
      enum: ["listing_photo", "blank_canvas", "inspiration", "clipping", "render"],
    }).notNull(),
    // Stringified PK of the source record (listing_photos.id, images.id,
    // sample_clippings.id, …). Nullable for ad-hoc nodes with no backing record.
    sourceId: text("source_id"),
    // Lineage into the staged render state tree, when this node's image is a
    // render output. Nullable — most nodes (listing photos, inspiration, clippings)
    // never touch render_canvases.
    renderCanvasId: text("render_canvas_id").references(() => renderCanvases.id, {
      onDelete: "set null",
    }),
    // On-board revision lineage: the parent node this one was spawned from by a
    // recipe/tool run. Null for a canvas root (e.g. the original listing photo drop).
    parentNodeId: text("parent_node_id"),
    // Canvas transform — free-floating position/size/rotation/stacking.
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    width: real("width").notNull().default(320),
    height: real("height").notNull().default(240),
    rotation: real("rotation").notNull().default(0),
    zIndex: integer("z_index").notNull().default(0),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull().default(true),
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
    // JSON bag for node-kind-specific extras (e.g. note text, group child ids,
    // recipe run metadata) that doesn't warrant its own column yet.
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    boardIdIdx: index("board_nodes_board_id_idx").on(table.boardId),
    // Board load order: fetch all nodes for a board pre-sorted by stacking order.
    boardIdZIndexIdx: index("board_nodes_board_id_z_index_idx").on(table.boardId, table.zIndex),
  }),
);
