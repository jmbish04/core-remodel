import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { driveLists } from "../drives/drive_lists";
import { showroomStores } from "./stores";

/**
 * Showroom-store HITL queue (0032 D1 / 0022 §5.2) — the "park-find" review inbox.
 *
 * Decision 1.d of the park pipeline: the car parked somewhere that is NOT home/work,
 * NOT a stop on the active drive, and NOT a registered showroom — but a proximity
 * scan (`services/tesla/proximity-scan.ts`) found a plausible remodel-relevant
 * business there. Rather than silently create a `showroom_stores` row from a guess
 * (which would poison the directory, budget takeoffs, and comparisons — see the
 * AGENTS.md "resolving an ambiguous parent" rule), we STAGE a candidate here and let
 * a human confirm it in the Park-Finds workspace or over MCP.
 *
 * On approve → a `showroom_stores` row is created/linked (`storeId` set, decision
 * `PROCESS`). On reject → decision `DO_NOT_PROCESS` (and optionally an
 * `showroom_exclusions` row so the same place is never re-surfaced). Until then the
 * row sits at `TBD`.
 *
 * FK rule: the approved store is related by `storeId` and JOINed for its name —
 * never a denormalized `store_name`. The candidate's own guessed name (`name`) is a
 * point-in-time scan artifact, not a duplicate of another table's data, so it lives
 * here legitimately.
 */
export const showroomStoreHitlQueue = sqliteTable(
  "showroom_store_hitl_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Guessed business name from the proximity scan (Places `displayName`). */
    name: text("name").notNull(),
    /** AI one-liner: why this looks remodel-relevant (the review hint). */
    description: text("description"),

    /** Where the car parked when this candidate was surfaced. */
    latitude: real("latitude"),
    longitude: real("longitude"),

    /** Google Places id — the stable match key for dedupe + exclusion checks. */
    placeId: text("place_id"),

    /** The registered showroom this became on approve (null until PROCESSed). */
    storeId: integer("store_id").references(() => showroomStores.id, { onDelete: "set null" }),

    /**
     * Human decision. `TBD` = awaiting review (surfaced in Park-Finds); `PROCESS` =
     * approved → added to the directory; `DO_NOT_PROCESS` = rejected. (TEXT column —
     * adding a value is a TS-only change.)
     */
    userDecision: text("user_decision", { enum: ["TBD", "PROCESS", "DO_NOT_PROCESS"] })
      .notNull()
      .default("TBD"),

    /** The drive this candidate was found on (nullable — a park can happen off-drive). */
    driveListId: integer("drive_list_id").references(() => driveLists.id, { onDelete: "set null" }),

    /** Raw proximity-scan packet (candidates considered + reasoning) — the receipts drawer. */
    proximityScanJson: text("proximity_scan_json"),
    /** Best-guess store category from the scan (free text; a human confirms on approve). */
    categoryGuess: text("category_guess"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    decisionIdx: index("showroom_store_hitl_queue_decision_idx").on(t.userDecision),
    placeIdx: index("showroom_store_hitl_queue_place_idx").on(t.placeId),
    driveIdx: index("showroom_store_hitl_queue_drive_idx").on(t.driveListId),
  }),
);

export type ShowroomStoreHitlQueue = typeof showroomStoreHitlQueue.$inferSelect;
export type ShowroomStoreHitlQueueInsert = typeof showroomStoreHitlQueue.$inferInsert;
