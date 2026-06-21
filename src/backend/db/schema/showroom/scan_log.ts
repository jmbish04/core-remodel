import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Showroom Scan Log — durable audit trail for every barcode scan or product
 * image upload, regardless of extraction success.
 *
 * Pipeline:
 *   1. Try native barcode decode (zxing-wasm on edge)
 *   2. If no barcode → Cloudflare Workers AI VLM extraction
 *   3. Check D1 for existing product match
 *   4. Auto-create product if new
 *   5. ALWAYS log to this table
 */
export const showroomScanLog = sqliteTable("showroom_scan_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Was a traditional barcode (UPC, Code 128, QR) detected? */
  isBarcode: integer("is_barcode", { mode: "boolean" }).default(false),

  /** Cloudflare Images URL of the uploaded photo. */
  cfImageUrl: text("cf_image_url"),

  /** R2 key if stored as an artifact. */
  r2Key: text("r2_key"),

  /** Raw decoded barcode string (null if image-only scan). */
  barcodeDecodedValue: text("barcode_decoded_value"),

  /** Extracted price (if found in barcode lookup or VLM extraction). */
  price: text("price"),

  /**
   * Full structured extraction from the AI VLM as JSON.
   * Schema: { product_name, brand, price, dimensions, color_finish, description, ... }
   */
  jsonExtractedData: text("json_extracted_data"),

  /**
   * Model's explanation of what it found or couldn't find.
   * Critical for debugging failed extractions.
   */
  aiRationale: text("ai_rationale"),

  /** Which AI model processed this scan (e.g., "@cf/moonshotai/kimi-k2.6"). */
  aiModelUsed: text("ai_model_used"),

  /** Extraction outcome. */
  extractionStatus: text("extraction_status", {
    enum: ["success", "partial", "failed"],
  }),

  /**
   * If the scan matched an existing product in D1.
   * Null if the product was new or extraction failed.
   */
  matchedStoreProductId: integer("matched_store_product_id").references(
    () => showroomStoreProducts.id,
    { onDelete: "set null" }
  ),

  /**
   * If the scan triggered auto-creation of a new product.
   * Null if matched an existing product or extraction failed.
   */
  autoCreatedProductId: integer("auto_created_product_id").references(
    () => showroomStoreProducts.id,
    { onDelete: "set null" }
  ),

  /** Context: which store the scan was taken at (optional). */
  storeId: integer("store_id").references(() => showroomStores.id, {
    onDelete: "set null",
  }),

  scannedAt: integer("scanned_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShowroomScanLogType = typeof showroomScanLog.$inferSelect;
export type ShowroomScanLogInsert = typeof showroomScanLog.$inferInsert;
