import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoid a circular reference through the showroom barrel.
import { showroomStoreLocations } from "./store_location";
import { showroomStores } from "./stores";

/**
 * Showroom MERGE CANDIDATES (0047, Tier 2) — the review inbox for collapsing chain
 * branches into one business.
 *
 * 0046's `dedup_showroom_stores` finds groups where two or more REAL rows (each with
 * its own zip/place_id) are branches of one business — and deliberately REFUSES to
 * merge them, because collapsing a real branch is destructive to distinct data if the
 * grouping is wrong (the 37-store SF Design Center blob; Leandro Quintal riding a
 * suite-less address edge into Marblus). So each such group is STAGED here for a human
 * to confirm, per the AGENTS.md "resolving an ambiguous parent" rule.
 *
 * On apply → each BRANCH member's site becomes a `showroom_store_locations` row on the
 * KEEPER and the branch store is soft-deleted. Nothing here mutates `showroom_stores`
 * until a human approves.
 */
export const showroomMergeCandidates = sqliteTable(
  "showroom_merge_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Stable identity for the group — the sorted ACTIVE member store ids joined by
     * "-" (e.g. "6-7-23-26-31"). UNIQUE, so a re-scan upserts rather than duplicating.
     * A group whose active membership changes yields a different key: the old row is
     * marked STALE and a new candidate is created, so a pending decision is never
     * silently mutated underneath.
     */
    groupKey: text("group_key").notNull(),

    /** The row proposed to survive (most-enriched active member). Human can switch it. */
    proposedKeeperStoreId: integer("proposed_keeper_store_id").references(
      () => showroomStores.id,
      { onDelete: "set null" },
    ),

    /**
     * TBD = awaiting review; APPROVED = a human OK'd it (apply may run); REJECTED = not
     * a duplicate (pairs recorded in showroom_merge_exclusions); APPLIED = collapsed;
     * STALE = the group's membership changed since detection (superseded by a new row).
     * (TEXT enum — adding a value is a TS-only change.)
     */
    status: text("status", {
      enum: ["TBD", "APPROVED", "REJECTED", "APPLIED", "STALE"],
    })
      .notNull()
      .default("TBD"),

    /** Which signal kinds linked the group (JSON string[]) — the review context. */
    signalsJson: text("signals_json"),
    /** The matched values behind the group (JSON) — the receipts drawer. */
    evidenceJson: text("evidence_json"),
    /** Freeform note a human leaves on the decision. */
    decidedByNote: text("decided_by_note"),

    detectedAt: integer("detected_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    appliedAt: integer("applied_at", { mode: "timestamp" }),
  },
  (t) => ({
    groupKeyUniq: uniqueIndex("showroom_merge_candidates_group_key_uniq").on(t.groupKey),
    statusIdx: index("showroom_merge_candidates_status_idx").on(t.status),
  }),
);

/**
 * The stores in one merge candidate. Members relate by `store_id` FK — the display
 * name is JOINed from `showroom_stores`, never denormalized here.
 *
 * `role`: exactly one KEEPER (the survivor); BRANCH members collapse into it; an
 * EXCLUDED member is a human's "this row is a different company, leave it out" and is
 * never touched (its pair is written to `showroom_merge_exclusions`).
 *
 * `collapse_state` is a per-member state machine so a partial apply resumes cleanly:
 * a crash between steps leaves the member at its last committed state, and a retry
 * picks up from there. The location row is created FIRST and never deleted (it holds
 * the address); the branch store is soft-deleted only at RETIRED.
 */
export const showroomMergeCandidateMembers = sqliteTable(
  "showroom_merge_candidate_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    candidateId: integer("candidate_id")
      .notNull()
      .references(() => showroomMergeCandidates.id, { onDelete: "cascade" }),

    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    role: text("role", { enum: ["KEEPER", "BRANCH", "EXCLUDED"] })
      .notNull()
      .default("BRANCH"),

    /**
     * Per-member collapse progress (0047). PENDING → LOCATION_CREATED →
     * CHILDREN_REMAPPED → RETIRED, or terminal SKIPPED_NO_ADDRESS. A retry resumes
     * from here — NOT from `resulting_location_id`, which alone could not tell a
     * "location made, children not yet moved" crash apart from a completed member.
     */
    collapseState: text("collapse_state", {
      enum: [
        "PENDING",
        "LOCATION_CREATED",
        "CHILDREN_REMAPPED",
        "RETIRED",
        "SKIPPED_NO_ADDRESS",
      ],
    })
      .notNull()
      .default("PENDING"),

    /** The location row this branch became on the keeper. Set at LOCATION_CREATED. */
    resultingLocationId: integer("resulting_location_id").references(
      () => showroomStoreLocations.id,
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
    candidateIdx: index("showroom_merge_candidate_members_candidate_idx").on(t.candidateId),
    storeIdx: index("showroom_merge_candidate_members_store_idx").on(t.storeId),
    /** A store appears at most once per candidate. */
    candidateStoreUniq: uniqueIndex("showroom_merge_candidate_members_cand_store_uniq").on(
      t.candidateId,
      t.storeId,
    ),
  }),
);

export type ShowroomMergeCandidate = typeof showroomMergeCandidates.$inferSelect;
export type ShowroomMergeCandidateInsert = typeof showroomMergeCandidates.$inferInsert;
export type ShowroomMergeCandidateMember = typeof showroomMergeCandidateMembers.$inferSelect;
export type ShowroomMergeCandidateMemberInsert =
  typeof showroomMergeCandidateMembers.$inferInsert;
