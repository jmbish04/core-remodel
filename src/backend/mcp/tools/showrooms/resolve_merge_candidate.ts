import {
  showroomMergeCandidateMembers,
  showroomMergeCandidates,
  showroomMergeExclusions,
} from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

/** Ordered `(lo, hi)` for the exclusions unique index. */
function orderedPair(a: number, b: number): { lo: number; hi: number } {
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}

export const resolveMergeCandidate = defineTool({
  name: "resolve_merge_candidate",
  category: "showrooms",
  title: "Decide a merge candidate",
  description:
    "Record a human decision on a merge candidate. Actions: `approve` (mark it ready for " +
    "apply_merge_candidate), `reject` (not a duplicate — records every member pair as a " +
    "permanent exclusion so the scan never re-proposes them), `set_keeper` (choose which member " +
    "store survives — pass `storeId`), or `exclude_member` (this store is a different company; " +
    "leave it out and record the (store, keeper) exclusion — pass `storeId`). Only TBD/APPROVED " +
    "candidates can be changed; an APPLIED/REJECTED one is settled.",
  inputShape: {
    id: z.number().int().positive().describe("Merge candidate id (from list_merge_candidates)"),
    action: z
      .enum(["approve", "reject", "set_keeper", "exclude_member"])
      .describe("The decision to record"),
    storeId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Required for set_keeper (the survivor) and exclude_member (the store to drop)"),
    note: z.string().optional().describe("Optional freeform note on the decision"),
  },
  annotations: WRITE,
  examples: [
    { title: "Approve", args: { id: 3, action: "approve" } },
    { title: "Exclude a co-located different company", args: { id: 3, action: "exclude_member", storeId: 241 } },
    { title: "Not a duplicate", args: { id: 9, action: "reject", note: "different businesses, shared building" } },
  ],
  outputShape: {
    id: z.number().int(),
    status: z.string(),
    action: z.string(),
    candidate: looseObject({ id: z.number().int(), status: z.string() }),
  },
  handler: async ({ db }, input) => {
    const [candidate] = await db
      .select()
      .from(showroomMergeCandidates)
      .where(eq(showroomMergeCandidates.id, input.id))
      .limit(1);
    if (!candidate) {
      toolError(`Merge candidate ${input.id} not found. Call list_merge_candidates for valid ids.`);
    }
    if (candidate.status !== "TBD" && candidate.status !== "APPROVED") {
      toolError(
        `Candidate ${input.id} is ${candidate.status} — settled. Only TBD/APPROVED candidates can be changed.`,
      );
    }

    const members = await db
      .select()
      .from(showroomMergeCandidateMembers)
      .where(eq(showroomMergeCandidateMembers.candidateId, input.id))
      .all();
    const keeper = members.find((m) => m.role === "KEEPER");

    const needsStore = input.action === "set_keeper" || input.action === "exclude_member";
    if (needsStore && !input.storeId) {
      toolError(`action '${input.action}' requires a storeId that is a member of the candidate.`);
    }
    if (needsStore && !members.some((m) => m.storeId === input.storeId)) {
      toolError(`Store ${input.storeId} is not a member of candidate ${input.id}.`);
    }

    const now = new Date();

    if (input.action === "approve") {
      await db
        .update(showroomMergeCandidates)
        .set({ status: "APPROVED", decidedAt: now, decidedByNote: input.note ?? null })
        .where(eq(showroomMergeCandidates.id, input.id))
        .run();
    } else if (input.action === "reject") {
      // Every pair becomes a permanent exclusion, so no sub-pair regroups next scan.
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const { lo, hi } = orderedPair(members[i].storeId, members[j].storeId);
          await db
            .insert(showroomMergeExclusions)
            .values({ storeIdLo: lo, storeIdHi: hi, reason: `rejected candidate ${input.id}` })
            .onConflictDoNothing()
            .run();
        }
      }
      await db
        .update(showroomMergeCandidates)
        .set({ status: "REJECTED", decidedAt: now, decidedByNote: input.note ?? null })
        .where(eq(showroomMergeCandidates.id, input.id))
        .run();
    } else if (input.action === "set_keeper") {
      // Old keeper → BRANCH; the chosen store → KEEPER.
      if (keeper && keeper.storeId !== input.storeId) {
        await db
          .update(showroomMergeCandidateMembers)
          .set({ role: "BRANCH", updatedAt: now })
          .where(eq(showroomMergeCandidateMembers.id, keeper.id))
          .run();
      }
      await db
        .update(showroomMergeCandidateMembers)
        .set({ role: "KEEPER", updatedAt: now })
        .where(
          and(
            eq(showroomMergeCandidateMembers.candidateId, input.id),
            eq(showroomMergeCandidateMembers.storeId, input.storeId as number),
          ),
        )
        .run();
      await db
        .update(showroomMergeCandidates)
        .set({ proposedKeeperStoreId: input.storeId as number })
        .where(eq(showroomMergeCandidates.id, input.id))
        .run();
    } else if (input.action === "exclude_member") {
      if (keeper && keeper.storeId === input.storeId) {
        toolError(
          `Store ${input.storeId} is the KEEPER — set a different keeper first, or reject the candidate.`,
        );
      }
      await db
        .update(showroomMergeCandidateMembers)
        .set({ role: "EXCLUDED", updatedAt: now })
        .where(
          and(
            eq(showroomMergeCandidateMembers.candidateId, input.id),
            eq(showroomMergeCandidateMembers.storeId, input.storeId as number),
          ),
        )
        .run();
      // Persist the exclusion now, so a re-scan skips it even before apply.
      if (keeper) {
        const { lo, hi } = orderedPair(input.storeId as number, keeper.storeId);
        await db
          .insert(showroomMergeExclusions)
          .values({ storeIdLo: lo, storeIdHi: hi, reason: `excluded from candidate ${input.id}` })
          .onConflictDoNothing()
          .run();
      }
    }

    const [updated] = await db
      .select()
      .from(showroomMergeCandidates)
      .where(eq(showroomMergeCandidates.id, input.id))
      .limit(1);

    return { id: input.id, status: updated.status, action: input.action, candidate: updated };
  },
});
