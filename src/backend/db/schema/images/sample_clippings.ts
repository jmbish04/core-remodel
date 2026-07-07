import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { renderCanvases } from "./render_canvases";

/**
 * sample_clippings — the Sample Library "drawer": a first-class, persistent,
 * growing catalog of Gemini-extracted clippings ("surgically cut just the
 * vanity trough onto a blank background") harvested from inspiration photos and
 * reused across edits (digital scrapbooking)
 * (see docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md §"Front door",
 * point 3).
 *
 * A clipping is distinct from a whole-photo pile item (`photo_collection_items`)
 * — it is a saved, reusable, *extracted region*, not a reference to an entire
 * photo. Extraction reuses the `InspirationCanvas` bbox-crop UI plus the
 * `stage_0_IP_extraction` render-canvas stage.
 */
export const sampleClippings = sqliteTable(
  "sample_clippings",
  {
    id: text("id").primaryKey(), // UUID
    // Clippings are reusable across rooms, but we remember which room's Workshop
    // it was extracted in for provenance/filtering. Set null (not cascaded) on
    // room removal so the clipping — and any board/mood-board still referencing
    // it — survives the room going away.
    roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
    // The full inspiration photo this clipping was cut from (Cloudflare Images
    // delivery URL).
    sourceCfImageUrl: text("source_cf_image_url").notNull(),
    // The extracted clipping itself, stored as its own Cloudflare Images asset
    // (background-removed / isolated per the extraction recipe).
    clippingCfImageUrl: text("clipping_cf_image_url").notNull(),
    // Optional human label, e.g. "Brass sconce" or "Vanity trough".
    label: text("label"),
    // JSON {x, y, width, height} normalized bbox (0..1) used for the crop, in the
    // coordinate space of the source inspiration image.
    bboxJson: text("bbox_json"),
    // Lineage into the staged render state tree: the stage_0_IP_extraction node
    // that produced this clipping.
    renderCanvasId: text("render_canvas_id").references(() => renderCanvases.id, {
      onDelete: "set null",
    }),
    // Global drawer membership: a clipping the user promoted for use in EVERY
    // room's Workshop (e.g. a paint color chosen house-wide). roomId still
    // records where it was extracted (provenance); isGlobal widens visibility.
    isGlobal: integer("is_global", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdIdx: index("sample_clippings_room_id_idx").on(table.roomId),
  }),
);
