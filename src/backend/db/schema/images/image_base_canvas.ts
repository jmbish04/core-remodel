import { sql } from "drizzle-orm";
import {primaryKey, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { images } from "./images";

export const imageBaseCanvas = sqliteTable("image_base_canvas", {
  id: text("id").primaryKey(),
  roomId: integer("room_id").references(() => rooms.id, {
    onDelete: "set null",
  }),
  ai_title: text("ai_title").notNull(), // e.g., AI will title the image uniquely; It's likely that a room will usually have between 1-2 stage_0, 1-2 stage 1; 3-4 stage_2; 10-15 stage_3 base canvas images; so its important that we have a unique title and ai sumamry for each variation
  ai_summary: text("ai_summary").notNull(), // e.g., AI will summarize the image uniquely; It's likely that a room will usually have between 1-2 stage_0, 1-2 stage 1; 3-4 stage_2; 10-15 stage_3 base canvas images; so its important that we have a detailed summary of the image
  prompt: text("prompt").notNull(),

  /**
   * Base Canvas type:
   *   stage_0_LP_unfurnished                       — Listing Photo with all furnishings removed, no painting, no countertops or cabinets/vanities or appliances, no toilets, showers, tubs, closets; no recessed ceiling lights or chandeliers or hanging pendants -- just the existing hardwood floors/tile floors and blank drywall in all rooms.
   *   stage_1_LP_init_setup_floors_paint_color     — Edited version of stage_0_listing_photo_unfurnished with the precondition's setup in advance of the more complicated image editing (which will be done in future stages); 1) setup the new flooring and 2) wall paint color
   *   stage_2_LP_rough_ins                         — Edited version of stage_1_init_setup_floors_paint_color; where elements go (e.g., "white floating vanity on the left wall, freestanding bathtub on the right"). ControlNet forces the AI to keep the exact dimensions of your stripped-down listing photo while sketching block geometry for the new furniture.
   *   stage_3_LP_high_fidelity                     — Edited version of stage_2_LP_rough_ins; add realistic textures, lighting, and reflections for all elements. FLUX possesses superior understanding of real-world materials and physical prompt adherence. Its job is not to figure out where the vanity is, but rather to make the vanity look incredibly lifelike. Your prompt at this stage dictates precise material composition (e.g., "honed Calacatta Viola marble countertops, vertical grain walnut wood drawer fronts, soft ambient occlusion shadows").
   *   stage_0_IP_surgical_extraction               — Surgically extract an object from an inspiration photo like countertop material, etc.
   *   stage_1_IP_high_fidelity                     - Make changes to inspo photo or stage_0_IP_surgical_extraction image to perhaps change the style to match ${prompt | another image}; eg, extracting a cabinet layout from an inspirational photo and then replacing its granite countertop material to a different stone countertop
   
   
   *   OTHER                                         — Not one of the above stages. A user is free to upload their own image and we won't do anything to it other than add it to the database.
   */
  type: text("type", {
    enum: [
      "stage_0_LP_unfurnished",
      "stage_1_LP_init_setup_floors_paint_color",
      "stage_2_LP_rough_ins",
      "stage_3_LP_high_fidelity",
      "stage_0_IP_surgical_extraction",
      "stage_1_IP_high_fidelity",
      "OTHER",
    ],
  })
    .notNull()
    .default("stage_0_LP_unfurnished"),

  startingImageUrl: text("starting_image_url").notNull(),
  outputImageUrl: text("output_image_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),

  // Backward-compatible fields retained for existing photo edit session consumers.
  sourceImageId: text("source_image_id").references(() => images.id, {
    onDelete: "set null",
  }),
  sourceImageType: text("source_image_type", {
    enum: [
      "listing_photo",
      "stage_0_LP_unfurnished",
      "stage_1_LP_init_setup_floors_paint_color",
      "stage_2_LP_rough_ins",
      "stage_3_LP_high_fidelity",
      "stage_0_IP_surgical_extraction",
      "stage_1_IP_high_fidelity",
      "OTHER",
    ],
  }),
  outputImageId: text("output_image_id").references(() => images.id, {
    onDelete: "cascade",
  }),
  model: text("model"),
  revisionNumber: integer("revision_number"),
  metadata: text("metadata"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});


// 2. Junction Table: Links a high-fidelity render to its source inspiration canvas snapshots
export const canvasInspirationReferences = sqliteTable("canvas_inspiration_references", {
  canvasId: text("canvas_id")
    .notNull()
    .references(() => imageBaseCanvas.id, { onDelete: "cascade" }),
  inspirationCanvasId: text("inspiration_canvas_id")
    .notNull()
    .references(() => imageBaseCanvas.id, { onDelete: "restrict" }), // Retains source inspo blocks
  extractionNotes: text("extraction_notes"), // e.g., "Surgically extracted countertop stone texture"
  referencedRegionBoundingBox: text("referenced_region_bounding_box"), // JSON string or stringified SVG path
}, (table) => ({
  pk: primaryKey({ columns: [table.canvasId, table.inspirationCanvasId] }),
}));