import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { images } from "./images";
import { renderCanvases } from "./render_canvases";

/**
 * Junction: which inspiration images (and which clipped regions) fed a render canvas.
 *
 * `referenceIndex` is the position in the model's `image_urls` array for `@image{n}`
 * prompting (Stage 5 synthesis). The base/working canvas occupies index 0 (`@image1`);
 * inspiration refs are 1..N (`@image2`…). Order is user-controllable via the DnD UI.
 */
export const canvasInspirationReferences = sqliteTable(
  "canvas_inspiration_references",
  {
    canvasId: text("canvas_id")
      .notNull()
      .references(() => renderCanvases.id, { onDelete: "cascade" }),
    inspirationImageId: text("inspiration_image_id")
      .notNull()
      .references(() => images.id, { onDelete: "restrict" }),
    // Cloudflare Images id of the cropped snippet, if a region was extracted.
    extractedCfImageId: text("extracted_cf_image_id"),
    extractionNotes: text("extraction_notes"),
    // JSON {x, y, width, height} in SOURCE pixels of the inspiration image.
    referencedRegionBoundingBox: text("referenced_region_bounding_box"),
    referenceIndex: integer("reference_index").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.canvasId, table.inspirationImageId] }),
  }),
);
