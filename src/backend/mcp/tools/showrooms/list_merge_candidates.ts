import {
  showroomMergeCandidateMembers,
  showroomMergeCandidates,
  showroomStores,
} from "@backend/db";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listMergeCandidates = defineTool({
  name: "list_merge_candidates",
  category: "showrooms",
  title: "List chain-branch merge candidates",
  description:
    "List staged merge candidates (from scan_showroom_merge_candidates) — groups of stores that " +
    "look like branches of one business. Each row carries its `status` (TBD awaiting review, " +
    "APPROVED, REJECTED, APPLIED, STALE), the member store ids + names, and which signals linked " +
    "them. Default returns only TBD (the review queue); pass `status` to filter otherwise. Call " +
    "get_merge_candidate for the full evidence, resolve_merge_candidate to decide, and " +
    "apply_merge_candidate to collapse an approved one.",
  inputShape: {
    status: z
      .enum(["TBD", "APPROVED", "REJECTED", "APPLIED", "STALE"])
      .optional()
      .describe("Filter by status. Default TBD (the review queue)."),
    limit: z.number().int().positive().max(200).optional(),
  },
  annotations: READ_ONLY,
  outputShape: {
    candidates: z.array(
      looseObject({
        id: z.number().int(),
        groupKey: z.string(),
        status: z.string(),
        memberCount: z.number().int(),
      }),
    ),
  },
  examples: [
    { title: "Review queue", args: {} },
    { title: "Applied history", args: { status: "APPLIED" } },
  ],
  handler: async ({ db }, input) => {
    const status = input.status ?? "TBD";
    const rows = await db
      .select()
      .from(showroomMergeCandidates)
      .where(eq(showroomMergeCandidates.status, status))
      .orderBy(desc(showroomMergeCandidates.detectedAt))
      .limit(input.limit ?? 50)
      .all();

    if (rows.length === 0) return { candidates: [] };

    const members = await db
      .select({
        candidateId: showroomMergeCandidateMembers.candidateId,
        storeId: showroomMergeCandidateMembers.storeId,
        role: showroomMergeCandidateMembers.role,
        name: showroomStores.name,
      })
      .from(showroomMergeCandidateMembers)
      .leftJoin(showroomStores, eq(showroomMergeCandidateMembers.storeId, showroomStores.id))
      .where(
        inArray(
          showroomMergeCandidateMembers.candidateId,
          rows.map((r) => r.id),
        ),
      )
      .all();

    const byCandidate = new Map<number, typeof members>();
    for (const m of members) {
      const list = byCandidate.get(m.candidateId) ?? [];
      list.push(m);
      byCandidate.set(m.candidateId, list);
    }

    return {
      candidates: rows.map((r) => {
        const ms = byCandidate.get(r.id) ?? [];
        return {
          id: r.id,
          groupKey: r.groupKey,
          status: r.status,
          proposedKeeperStoreId: r.proposedKeeperStoreId,
          signals: r.signalsJson ? (JSON.parse(r.signalsJson) as string[]) : [],
          memberCount: ms.length,
          members: ms.map((m) => ({ storeId: m.storeId, name: m.name, role: m.role })),
          detectedAt: r.detectedAt,
        };
      }),
    };
  },
});
