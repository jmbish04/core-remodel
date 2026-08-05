import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Direct leaf import — avoids a circular reference through the showroom barrel.
import { showroomStores } from "./stores";

/**
 * Showroom MERGE EXCLUSIONS (0047) — persisted "these two stores are NOT the same
 * business" decisions, so a human's judgement survives across dedup scans.
 *
 * Without this, excluding a member from a merge candidate (or rejecting a candidate
 * outright) would be forgotten the moment the next `scan_showroom_merge_candidates`
 * run regrouped the same signal edge — the "no new candidate after apply" guarantee
 * would be impossible. The scan skips any edge whose two endpoints are a row here.
 *
 * Stored as an ORDERED pair `(store_id_lo, store_id_hi)` with `lo < hi`, so the lookup
 * is direction-free and the unique index dedupes. Which pairs get written:
 *   - EXCLUDE member X from an approved group → `(X, keeper)` only (every other branch
 *     merges into the keeper, so that is the sole identity X could re-link to).
 *   - REJECT the whole candidate → every pairwise combination of its members.
 */
export const showroomMergeExclusions = sqliteTable(
  "showroom_merge_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The smaller of the two store ids. */
    storeIdLo: integer("store_id_lo")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),
    /** The larger of the two store ids. */
    storeIdHi: integer("store_id_hi")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /** Why the pair was excluded (human note or "rejected candidate N"). */
    reason: text("reason"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pairUniq: uniqueIndex("showroom_merge_exclusions_pair_uniq").on(t.storeIdLo, t.storeIdHi),
  }),
);

export type ShowroomMergeExclusion = typeof showroomMergeExclusions.$inferSelect;
export type ShowroomMergeExclusionInsert = typeof showroomMergeExclusions.$inferInsert;
