import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Blank-canvas batch generation job — durable, cross-isolate tracker for the
 * "Generate Blank Canvases" admin batch action.
 *
 * Replaces the old in-memory `Map<jobId, job>` tracker that lived inside the
 * listing-photos route module: serverless Worker isolates don't share memory,
 * so a status poll could land on a different isolate than the one running the
 * batch (404) and a mid-flight redeploy wiped all in-flight jobs. Job + item
 * state now lives in D1 and the batch itself runs inside a Cloudflare
 * Workflow (see `blank-canvas-batch-workflow.ts`), so both survive isolate
 * churn and redeploys.
 */
export const blankCanvasGenerationJobs = sqliteTable("blank_canvas_generation_jobs", {
  id: text("id").primaryKey(), // UUID
  status: text("status", { enum: ["running", "complete", "failed"] })
    .notNull()
    .default("running"),
  leaveOutline: integer("leave_outline", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * One row per listing photo enrolled in a blank-canvas generation job.
 * Updated in place by the Workflow step as each photo is processed.
 */
export const blankCanvasGenerationJobItems = sqliteTable(
  "blank_canvas_generation_job_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => blankCanvasGenerationJobs.id, { onDelete: "cascade" }),
    listingPhotoId: integer("listing_photo_id").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    blankCanvasCfImageId: text("blank_canvas_cf_image_id"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    jobIdIdx: index("blank_canvas_generation_job_items_job_id_idx").on(table.jobId),
  }),
);
