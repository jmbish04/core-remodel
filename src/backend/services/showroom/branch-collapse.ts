/**
 * @fileoverview Collapse a chain-branch merge candidate into one business (0047, Tier 2).
 *
 * Where `dedup_showroom_stores` DISCARDS a duplicate stub's address (right for a stub, fatal
 * for a real branch), this CARRIES each branch's site across as a location on the keeper, then
 * soft-deletes the branch store. It runs only on a human-APPROVED candidate.
 *
 * Safety is the whole point (a wrong collapse destroys distinct data):
 *   - APPROVED-only, and re-verified live at apply — every member still active, keeper present.
 *   - A per-member `collapse_state` machine (PENDING → LOCATION_CREATED → CHILDREN_REMAPPED →
 *     RETIRED, or terminal SKIPPED_NO_ADDRESS), each transition its own committed write, so a
 *     crash resumes from the last recorded state instead of double-applying.
 *   - A branch's location row is REPOINTED to the keeper (it already holds the address) — never
 *     recreated and never deleted — so a partial failure leaves a live store + its address.
 *   - The branch store is soft-deleted only at the final step.
 */
import {
  showroomMergeCandidateMembers,
  showroomMergeCandidates,
  showroomMergeExclusions,
  showroomStoreLocations,
  showroomStores,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";

import type { RemodelDb } from "../../mcp/types";
import { remapStoreChildren } from "./store-child-remap";

export interface CollapseMemberResult {
  storeId: number;
  role: string;
  from: string;
  to: string;
  movedLocationId: number | null;
  childRowsMoved: number;
}

export interface CollapseResult {
  candidateId: number;
  keeperStoreId: number;
  status: string;
  members: CollapseMemberResult[];
  excludedPairsWritten: number;
}

class CollapseError extends Error {}

/** Ordered `(lo, hi)` so the exclusions unique index dedupes regardless of argument order. */
function orderedPair(a: number, b: number): { lo: number; hi: number } {
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}

/**
 * Collapse one APPROVED merge candidate. Idempotent and resumable: calling it again after a
 * partial failure picks up each member from its committed `collapse_state`. Throws
 * `CollapseError` (surfaced as a tool error) when the candidate is not APPROVED or has gone
 * STALE (a member deactivated since approval).
 */
export async function collapseCandidate(
  db: RemodelDb,
  candidateId: number,
): Promise<CollapseResult> {
  const [candidate] = await db
    .select()
    .from(showroomMergeCandidates)
    .where(eq(showroomMergeCandidates.id, candidateId))
    .limit(1);
  if (!candidate) throw new CollapseError(`Merge candidate ${candidateId} not found.`);
  if (candidate.status !== "APPROVED") {
    throw new CollapseError(
      `Candidate ${candidateId} is ${candidate.status}, not APPROVED. Approve it with resolve_merge_candidate before applying.`,
    );
  }

  const members = await db
    .select()
    .from(showroomMergeCandidateMembers)
    .where(eq(showroomMergeCandidateMembers.candidateId, candidateId))
    .all();

  const keeper = members.find((m) => m.role === "KEEPER");
  if (!keeper) throw new CollapseError(`Candidate ${candidateId} has no KEEPER member.`);
  const branches = members.filter((m) => m.role === "BRANCH");
  const excluded = members.filter((m) => m.role === "EXCLUDED");

  // ── Live re-verify (codra): a member deactivated since approval means the group moved. ──
  const memberIds = members.map((m) => m.storeId);
  const liveActive = new Map(
    (
      await db
        .select({ id: showroomStores.id, isActive: showroomStores.isActive })
        .from(showroomStores)
        .where(inArray(showroomStores.id, memberIds))
        .all()
    ).map((r) => [r.id, r.isActive]),
  );
  if (liveActive.get(keeper.storeId) !== true) {
    await db
      .update(showroomMergeCandidates)
      .set({ status: "STALE" })
      .where(eq(showroomMergeCandidates.id, candidateId))
      .run();
    throw new CollapseError(`Keeper store ${keeper.storeId} is no longer active — candidate STALEd.`);
  }
  for (const b of branches) {
    // A branch already RETIRED is expected inactive; anything else inactive means drift.
    if (b.collapseState !== "RETIRED" && liveActive.get(b.storeId) !== true) {
      await db
        .update(showroomMergeCandidates)
        .set({ status: "STALE" })
        .where(eq(showroomMergeCandidates.id, candidateId))
        .run();
      throw new CollapseError(
        `Branch store ${b.storeId} is no longer active but not yet collapsed — candidate STALEd.`,
      );
    }
  }

  // ── Persist exclusions for EXCLUDED members: (excluded, keeper) only. ──
  let excludedPairsWritten = 0;
  for (const x of excluded) {
    const { lo, hi } = orderedPair(x.storeId, keeper.storeId);
    await db
      .insert(showroomMergeExclusions)
      .values({ storeIdLo: lo, storeIdHi: hi, reason: `excluded from merge candidate ${candidateId}` })
      .onConflictDoNothing()
      .run();
    excludedPairsWritten += 1;
  }

  // Keeper's existing location place_ids, so we never move a duplicate site onto it (which
  // would trip the locations place_id unique index).
  const keeperPlaceIds = new Set(
    (
      await db
        .select({ placeId: showroomStoreLocations.placeId })
        .from(showroomStoreLocations)
        .where(eq(showroomStoreLocations.storeId, keeper.storeId))
        .all()
    )
      .map((r) => r.placeId)
      .filter((p): p is string => Boolean(p)),
  );

  const setMemberState = (
    memberId: number,
    state: (typeof showroomMergeCandidateMembers.collapseState)["_"]["data"],
    resultingLocationId?: number | null,
  ) =>
    db
      .update(showroomMergeCandidateMembers)
      .set({
        collapseState: state,
        ...(resultingLocationId !== undefined ? { resultingLocationId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(showroomMergeCandidateMembers.id, memberId))
      .run();

  const results: CollapseMemberResult[] = [];

  for (const b of branches) {
    const from = b.collapseState;
    let movedLocationId: number | null = b.resultingLocationId;
    let childRowsMoved = 0;
    let state = b.collapseState;

    // PENDING → repoint the branch's location rows onto the keeper (they hold the address).
    if (state === "PENDING") {
      const branchLocs = await db
        .select()
        .from(showroomStoreLocations)
        .where(eq(showroomStoreLocations.storeId, b.storeId))
        .all();

      if (branchLocs.length === 0) {
        await setMemberState(b.id, "SKIPPED_NO_ADDRESS");
        state = "SKIPPED_NO_ADDRESS";
        results.push({ storeId: b.storeId, role: b.role, from, to: state, movedLocationId: null, childRowsMoved });
        continue;
      }

      for (const loc of branchLocs) {
        // Skip a site the keeper already has (same place_id) — avoid the unique-index trip.
        if (loc.placeId && keeperPlaceIds.has(loc.placeId)) continue;
        await db
          .update(showroomStoreLocations)
          .set({ storeId: keeper.storeId, updatedAt: new Date() })
          .where(eq(showroomStoreLocations.id, loc.id))
          .run();
        if (loc.placeId) keeperPlaceIds.add(loc.placeId);
        movedLocationId ??= loc.id;
      }
      await setMemberState(b.id, "LOCATION_CREATED", movedLocationId);
      state = "LOCATION_CREATED";
    }

    // LOCATION_CREATED → move the remaining child/support rows onto the keeper.
    if (state === "LOCATION_CREATED") {
      childRowsMoved = await remapStoreChildren(db, keeper.storeId, [b.storeId]);
      await setMemberState(b.id, "CHILDREN_REMAPPED");
      state = "CHILDREN_REMAPPED";
    }

    // CHILDREN_REMAPPED → soft-delete the now-emptied branch store.
    if (state === "CHILDREN_REMAPPED") {
      await db
        .update(showroomStores)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(showroomStores.id, b.storeId))
        .run();
      await setMemberState(b.id, "RETIRED");
      state = "RETIRED";
    }

    results.push({ storeId: b.storeId, role: b.role, from, to: state, movedLocationId, childRowsMoved });
  }

  // Candidate is APPLIED only when every branch reached a terminal state.
  const allDone = branches.every((b) => {
    const r = results.find((x) => x.storeId === b.storeId);
    const finalState = r?.to ?? b.collapseState;
    return finalState === "RETIRED" || finalState === "SKIPPED_NO_ADDRESS";
  });

  let status: string = candidate.status;
  if (allDone) {
    await db
      .update(showroomMergeCandidates)
      .set({ status: "APPLIED", appliedAt: new Date() })
      .where(eq(showroomMergeCandidates.id, candidateId))
      .run();
    status = "APPLIED";
  }

  return {
    candidateId,
    keeperStoreId: keeper.storeId,
    status,
    members: results,
    excludedPairsWritten,
  };
}

export { CollapseError };
