import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";

/**
 * Bulk showroom-intake queue (0032 bulk-import).
 *
 * The `bulk_import_showrooms_from_places` MCP tool accepts an ARRAY of Google
 * place_ids, writes one `queued` row here per id, kicks
 * {@link ShowroomBulkIntakeWorkflow}, and returns immediately — so the calling AI
 * model spends tokens on ONE round-trip, not one per store. The worker then loops
 * the batch durably, running the exact single-store intake (Places Details →
 * dedupe/adopt → insert → kick onboarding) per id and stamping the outcome here.
 * `check_bulk_intake_status` reads these rows back so a model can look in on a
 * set-and-forget batch (and spot one that got stuck).
 *
 * FK rule: the created/adopted store is related by `storeId` and JOINed for its
 * name — never a denormalized name column. `placeId` is the point-in-time intake
 * key, legitimately stored (it is what was submitted, not a copy of another row).
 */
export const showroomBulkIntakeItems = sqliteTable(
  "showroom_bulk_intake_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Groups every id submitted in one `bulk_import_showrooms_from_places` call. */
    batchId: text("batch_id").notNull(),

    /** The submitted Google Place ID for this item. */
    placeId: text("place_id").notNull(),

    /**
     * Queue lifecycle: `queued` (awaiting the workflow) → `processing` (this item
     * is being intaken) → `done` (created/adopted/already-existed) | `skipped`
     * (nothing usable) | `failed` (error — see `error`). TEXT enum: adding a value
     * is a TS-only change.
     */
    status: text("status", {
      enum: ["queued", "processing", "done", "skipped", "failed"],
    })
      .notNull()
      .default("queued"),

    /** The store this item created or adopted onto (null until `done`). */
    storeId: integer("store_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /**
     * The single-intake outcome string (mirrors import_showroom_from_place's
     * `status`): e.g. "processing" (new row), "exists", "located (adopted …)".
     */
    resultStatus: text("result_status"),

    /** Failure message when `status = failed`. */
    error: text("error"),

    /** Retry count — the workflow bumps this each attempt for stuck-detection. */
    attempts: integer("attempts").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    batchIdx: index("showroom_bulk_intake_batch_idx").on(t.batchId),
    statusIdx: index("showroom_bulk_intake_status_idx").on(t.status),
    // One row per (batch, place) — re-submitting the same id in a batch is a no-op.
    batchPlaceUniq: unique("showroom_bulk_intake_batch_place_uniq").on(t.batchId, t.placeId),
  }),
);
