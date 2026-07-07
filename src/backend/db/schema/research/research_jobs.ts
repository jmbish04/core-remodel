import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Research jobs — one row per deep-research run, regardless of what launched
 * it (brand/product enrichment workflows, the showroom deep-sweep, a custom
 * prompt, or a discovery sweep from the research console). The console at
 * /admin/shopping/research lists these; the per-job viewport renders the row
 * plus its `research_job_steps` timeline, polling while status is running.
 *
 * Progress is estimated as completedSteps / totalSteps (workflows declare
 * their step budget up front); `currentStep` carries the live narration line.
 */
export const researchJobs = sqliteTable(
  "research_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * What kind of research this is:
     *   showroom | brand | product              — targeted enrichment of one entity
     *   discovery_showrooms | discovery_brands | discovery_products
     *                                           — criteria search producing intake candidates
     *   custom                                  — free-form prompted research
     */
    kind: text("kind", {
      enum: [
        "showroom",
        "brand",
        "product",
        "discovery_showrooms",
        "discovery_brands",
        "discovery_products",
        "custom",
      ],
    }).notNull(),

    /** Display title for lists (e.g. "Brand research — Kohler"). */
    title: text("title").notNull(),

    /** The research topic handed to the deep-research engine. */
    topic: text("topic"),

    /** Discovery criteria / custom prompt as the user typed it. */
    criteria: text("criteria"),

    /** Linked entity when kind is showroom|brand|product. */
    entityType: text("entity_type", { enum: ["showroom", "brand", "product"] }),
    entityId: integer("entity_id"),

    /** Lifecycle. */
    status: text("status", {
      enum: ["pending", "running", "complete", "failed"],
    })
      .notNull()
      .default("pending"),

    /** 0–100 completion estimate (completedSteps / totalSteps). */
    progress: integer("progress").notNull().default(0),

    /** Live narration line for the console list ("Scraping brand site…"). */
    currentStep: text("current_step"),

    /** Step budget declared by the launcher; drives the progress estimate. */
    totalSteps: integer("total_steps").notNull().default(1),
    completedSteps: integer("completed_steps").notNull().default(0),

    /** Engine artifacts, persisted as they materialize. */
    plan: text("plan"),
    outline: text("outline"),
    report: text("report"),
    sources: text("sources", { mode: "json" }),

    /**
     * Kind-specific result payload. For discovery kinds:
     * `{ candidates: [{ name, websiteUrl?, address?, summary?, matchedEntityId?,
     *    matchedEntityName?, intakeStatus: "new"|"existing"|"registered"|"failed",
     *    intakeEntityId?: number }] }`.
     * For entity kinds: the structured-extraction object.
     */
    result: text("result", { mode: "json" }),

    /** Failure detail when status = failed. */
    error: text("error"),

    /** Cloudflare Workflow instance id, when launched via a Workflow. */
    workflowInstanceId: text("workflow_instance_id"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    statusIdx: index("research_jobs_status_idx").on(table.status),
    entityIdx: index("research_jobs_entity_idx").on(table.entityType, table.entityId),
  }),
);

/**
 * Research job steps — one row per step (workflow step OR engine phase) of a
 * research job. Upsert-keyed by (jobId, stepKey) so workflow retries stay
 * idempotent. `artifact` holds the step's output (plan text, critic feedback,
 * extraction JSON, image URL lists, candidate tables…) rendered live by the
 * research viewport as it appears.
 */
export const researchJobSteps = sqliteTable(
  "research_job_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    jobId: integer("job_id")
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),

    /** Stable key ("deep-plan", "scrape-site", "photos", …). */
    stepKey: text("step_key").notNull(),

    /** Human label ("Generating research plan"). */
    label: text("label").notNull(),

    status: text("status", {
      enum: ["pending", "running", "complete", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),

    /** Step output artifact (JSON — shape varies by stepKey). */
    artifact: text("artifact", { mode: "json" }),

    /** One-line human summary of what the step produced. */
    detail: text("detail"),

    /** Timeline ordering. */
    sortOrder: integer("sort_order").notNull().default(0),

    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    jobStepUnique: uniqueIndex("research_job_steps_job_step_uniq").on(
      table.jobId,
      table.stepKey,
    ),
    jobIdx: index("research_job_steps_job_idx").on(table.jobId),
  }),
);

export type ResearchJob = typeof researchJobs.$inferSelect;
export type ResearchJobInsert = typeof researchJobs.$inferInsert;
export type ResearchJobStep = typeof researchJobSteps.$inferSelect;
export type ResearchJobStepInsert = typeof researchJobSteps.$inferInsert;
