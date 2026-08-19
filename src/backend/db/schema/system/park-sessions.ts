import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { driveLists } from "../drives/drive_lists";
import { driveListStops } from "../drives/drive_list_stops";
import { showroomStoreHitlQueue } from "../showroom/store_hitl_queue";
import { showroomStores } from "../showroom/stores";
import { showroomVisitLog } from "../showroom/visit_log";

/**
 * Park sessions (0032 L1) — the durable anchor for the source-agnostic park/dwell
 * detector.
 *
 * Generalizes #178's `tesla_park_sessions` past Tesla: keyed on `subjectId`
 * (a vin, or "phone" / "ai"), so any location source's dwell is tracked the same
 * way. The detector (`services/location/park-detector.ts`) keeps its hot state in
 * KV (`loc:detector:<subjectId>`), but writes a row here on a confirmed PARK so an
 * in-flight visit survives an app close / phone sleep / worker eviction — the KV
 * state can be rebuilt from the open row.
 *
 * Lifecycle: `parked` (open) → `settled` (drove away; departure + dwell recorded)
 * or `discarded` (moved before DWELL_MIN — never a real visit). A partial-unique
 * index enforces at most ONE open (`parked`) session per subject.
 *
 * `hitlQueueId` links a park that resolved to a park-find discovery candidate
 * (decision 1.d), added in D1 alongside `showroom_store_hitl_queue`.
 */
export const parkSessions = sqliteTable(
  "park_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The tracked subject: a vin, or "phone" / "ai". One open park per subject. */
    subjectId: text("subject_id").notNull(),

    /** Drive context captured at park time (nullable — a park can happen off-drive). */
    driveListId: integer("drive_list_id").references(() => driveLists.id, { onDelete: "set null" }),
    stopId: integer("stop_id").references(() => driveListStops.id, { onDelete: "set null" }),
    /** The matched showroom, when the park resolved to one. */
    storeId: integer("store_id").references(() => showroomStores.id, { onDelete: "set null" }),
    /** The park-find HITL candidate, when the park resolved to a discovery (decision 1.d). */
    hitlQueueId: integer("hitl_queue_id").references(() => showroomStoreHitlQueue.id, {
      onDelete: "set null",
    }),

    latitude: real("latitude"),
    longitude: real("longitude"),

    /** Which location source detected the park (LocationSource). */
    source: text("source").notNull(),

    /** When the confirmed park began. */
    parkedAt: integer("parked_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    /** When the subject drove away (null while open). */
    departedAt: integer("departed_at", { mode: "timestamp" }),
    /** departed − parked, seconds — recorded on settle. */
    dwellSeconds: integer("dwell_seconds"),

    /** Open → closed (drove away) → or discarded (moved before DWELL_MIN). */
    status: text("status", { enum: ["parked", "settled", "discarded"] })
      .notNull()
      .default("parked"),

    /** The soft-arrival visit this park staged, when it staged one. */
    visitLogId: integer("visit_log_id").references(() => showroomVisitLog.id, { onDelete: "set null" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    subjectIdx: index("park_sessions_subject_idx").on(t.subjectId),
    statusIdx: index("park_sessions_status_idx").on(t.status),
    hitlQueueIdx: index("park_sessions_hitl_queue_idx").on(t.hitlQueueId),
    // At most one OPEN park per subject — the detector's "am I already parked?"
    // invariant, enforced in the DB (drizzle-kit emits the WHERE clause).
    oneOpenPerSubject: uniqueIndex("park_sessions_one_open_uniq")
      .on(t.subjectId)
      .where(sql`${t.status} = 'parked'`),
  }),
);

export type ParkSession = typeof parkSessions.$inferSelect;
export type ParkSessionInsert = typeof parkSessions.$inferInsert;
