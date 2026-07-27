import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { driveLists } from "../drives/drive_lists";
import { driveListStops } from "../drives/drive_list_stops";
import { showroomStores } from "./stores";

/**
 * Showroom Visit Log (0023 P1) — the two-row soft-arrival → finalize model.
 *
 * A "visit" is a session at a showroom. The Tesla telemetry pipeline writes it in
 * two steps so a drive is captured as it happens:
 *
 *   1. **Soft arrival** — when the car PARKS at (or near) a showroom during an
 *      active drive, a `TESLA_SOFT_ARRIVAL` row is staged with `arrivalAt` set and
 *      `departureAt` null. It's a draft: the store may still be ambiguous.
 *   2. **Finalize** — when the car later DRIVES AWAY, a `TESLA_STAGED` row is
 *      written that copies the arrival, adds `departureAt` + `dwellSeconds`, and
 *      links back to the soft row via `softArrivalId` (UNIQUE, so finalize is
 *      idempotent — one staged row per soft arrival).
 *
 * Other origins reuse the same table: `AI_STAGED` (staged by a chat/MCP tool) and
 * `SUBMITTED` (a human-confirmed visit, e.g. from the Visit Logs workspace).
 *
 * FK rule: relate to the showroom by `storeId` and JOIN for its name — never a
 * denormalized `store_name`. `storeId` is nullable ONLY for a soft arrival staged
 * before the store is disambiguated; a `SUBMITTED` visit must carry it (enforced
 * in the service/API, not the column, so a draft can exist).
 */
export const showroomVisitLog = sqliteTable(
  "showroom_visit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The showroom visited. Nullable only while a soft arrival is unresolved. */
    storeId: integer("store_id").references(() => showroomStores.id, { onDelete: "cascade" }),

    /** Drive context, when the visit came from a drive (nullable for a cold/manual visit). */
    driveListId: integer("drive_list_id").references(() => driveLists.id, { onDelete: "set null" }),
    stopId: integer("stop_id").references(() => driveListStops.id, { onDelete: "set null" }),

    /** When the car parked / the visit began. */
    arrivalAt: integer("arrival_at", { mode: "timestamp" }),
    /** When the car drove away / the visit ended (null until finalized). */
    departureAt: integer("departure_at", { mode: "timestamp" }),
    /** departure − arrival, seconds — stored on finalize for cheap sort/report. */
    dwellSeconds: integer("dwell_seconds"),

    /** Lifecycle: staged by AI, staged/finalized by Tesla telemetry, or human-submitted. */
    status: text("status", {
      enum: ["AI_STAGED", "TESLA_SOFT_ARRIVAL", "TESLA_STAGED", "SUBMITTED"],
    })
      .notNull()
      .default("TESLA_SOFT_ARRIVAL"),

    /**
     * @deprecated Contact axis, mislabeled here. The contact channel (phone/email/
     * in-person) belongs on `showroom_store_contact_log.type` — see 0032 D-1. Kept
     * for back-compat with rows written before the split; new code sets `visitType`.
     */
    type: text("type", { enum: ["PHONE", "EMAIL", "SHOWROOM_IN_PERSON"] })
      .notNull()
      .default("SHOWROOM_IN_PERSON"),

    /**
     * ENGAGEMENT DEPTH of the visit (0032 D-1) — the quality signal for the visit
     * history / future GPS-attested reviews. Auto-arrivals stage as SOFT_ARRIVAL;
     * the human classifies the real depth when finalizing in the Visit Logs workspace.
     */
    visitType: text("visit_type", {
      enum: [
        "SOFT_ARRIVAL",
        "BROWSED_NO_CONTACT",
        "BRIEF_NO_HELP",
        "FULL_SESSION",
        "APPOINTMENT",
      ],
    })
      .notNull()
      .default("SOFT_ARRIVAL"),

    /** 1–5 star rating; range enforced by the CHECK below AND the API. Null until reviewed. */
    rating: integer("rating"),

    /** Rich-text visit notes — markdown is source of truth, html is the render cache. */
    notesMarkdown: text("notes_markdown"),
    notesHtml: text("notes_html"),

    /** Provenance of the arrival fix — which location source staged it (0032 §3). */
    gpsSource: text("gps_source", {
      enum: ["tesla-telemetry", "tesla-poll", "tesla-webhook", "device", "phone", "ai", "manual"],
    }),
    latitude: real("latitude"),
    longitude: real("longitude"),
    /** How far the park fix was from the matched store, metres — attestation strength (0022 §5.1). */
    matchDistanceM: real("match_distance_m"),
    /** Raw fix + active-drive id + match reasoning, JSON — the provenance packet (0022 §5.1). */
    provenanceJson: text("provenance_json"),

    /** The soft-arrival row this staged row finalized (self-reference; UNIQUE below). */
    softArrivalId: integer("soft_arrival_id").references(
      (): AnySQLiteColumn => showroomVisitLog.id,
      { onDelete: "set null" },
    ),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    storeIdx: index("showroom_visit_log_store_idx").on(t.storeId),
    statusIdx: index("showroom_visit_log_status_idx").on(t.status),
    driveIdx: index("showroom_visit_log_drive_idx").on(t.driveListId),
    // At most one finalized row per soft arrival — makes drive-away finalize idempotent.
    softArrivalUniq: uniqueIndex("showroom_visit_log_soft_arrival_uniq")
      .on(t.softArrivalId)
      .where(sql`${t.softArrivalId} IS NOT NULL`),
    // NOTE: rating is a 1–5 scale, enforced in the API/service layer (0032 V2), NOT a DB
    // CHECK. SQLite can't ALTER-ADD a CHECK to an existing table without a full rebuild,
    // which drizzle-kit won't auto-generate — so a DB check() here would drift from the
    // migration. Kept out on purpose; validate on write.
  }),
);

export type ShowroomVisitLog = typeof showroomVisitLog.$inferSelect;
export type ShowroomVisitLogInsert = typeof showroomVisitLog.$inferInsert;
