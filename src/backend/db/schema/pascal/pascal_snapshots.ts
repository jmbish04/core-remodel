import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { pascalVariants } from "./pascal_variants";

/**
 * Pascal snapshot (0043) — a captured image of a variant's scene, uploaded to
 * Cloudflare Images. Produced by the `capture_scene_screenshot` MCP tool (worker-side
 * Browser Rendering) or, as a fallback, an editor canvas capture. The variant's
 * `thumbnail_url` points at the latest snapshot when `setAsThumbnail`.
 */
export const pascalSnapshots = sqliteTable("pascal_snapshots", {
  id: text("id").primaryKey(), // slug
  variantId: text("variant_id")
    .notNull()
    .references(() => pascalVariants.id, { onDelete: "cascade" }),
  cfImageId: text("cf_image_id").notNull(),
  imageUrl: text("image_url").notNull(),
  caption: text("caption"),
  // Camera/view metadata at capture time (JSON).
  cameraJson: text("camera_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
