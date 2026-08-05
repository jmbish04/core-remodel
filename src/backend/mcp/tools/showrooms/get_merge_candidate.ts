import {
  showroomMergeCandidateMembers,
  showroomMergeCandidates,
  showroomStores,
} from "@backend/db";
import {
  formatShowroomAddress,
  loadStoreLocationCounts,
} from "@backend/services/showroom/locations";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const getMergeCandidate = defineTool({
  name: "get_merge_candidate",
  category: "showrooms",
  title: "Get a merge candidate with full evidence",
  description:
    "Full detail for one merge candidate by `id`: every member store (name, address, phone, " +
    "place_id, role), the signals + matched values that grouped them, and the current status. " +
    "This is the review surface — read it before resolve/apply to see WHY the detector thinks " +
    "these stores are one business, and to spot a co-located-but-different company that should be " +
    "EXCLUDED rather than merged.",
  inputShape: {
    id: z.number().int().positive().describe("Merge candidate id (from list_merge_candidates)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    candidate: looseObject({ id: z.number().int(), status: z.string() }),
    members: z.array(looseObject({ storeId: z.number().int(), role: z.string() })),
  },
  examples: [{ title: "By id", args: { id: 1 } }],
  handler: async ({ db }, input) => {
    const [candidate] = await db
      .select()
      .from(showroomMergeCandidates)
      .where(eq(showroomMergeCandidates.id, input.id))
      .limit(1);
    if (!candidate) {
      toolError(`Merge candidate ${input.id} not found. Call list_merge_candidates for valid ids.`);
    }

    const members = await db
      .select({
        storeId: showroomMergeCandidateMembers.storeId,
        role: showroomMergeCandidateMembers.role,
        collapseState: showroomMergeCandidateMembers.collapseState,
        resultingLocationId: showroomMergeCandidateMembers.resultingLocationId,
        name: showroomStores.name,
        phone: showroomStores.phoneNumber,
        placeId: showroomStores.placeId,
        streetNumber: showroomStores.locationStreetNumber,
        streetName: showroomStores.locationStreetName,
        city: showroomStores.locationCity,
        state: showroomStores.locationState,
        zipCode: showroomStores.locationZipCode,
        isActive: showroomStores.isActive,
      })
      .from(showroomMergeCandidateMembers)
      .leftJoin(showroomStores, eq(showroomMergeCandidateMembers.storeId, showroomStores.id))
      .where(eq(showroomMergeCandidateMembers.candidateId, input.id))
      .all();

    // A member's location count, so the reviewer sees which stores carry extra sites.
    // Reuses the chunked 0045 helper — never a full-table scan.
    const locCounts = await loadStoreLocationCounts(db, members.map((m) => m.storeId));

    return {
      candidate: {
        id: candidate.id,
        groupKey: candidate.groupKey,
        status: candidate.status,
        proposedKeeperStoreId: candidate.proposedKeeperStoreId,
        signals: candidate.signalsJson ? JSON.parse(candidate.signalsJson) : [],
        evidence: candidate.evidenceJson ? JSON.parse(candidate.evidenceJson) : [],
        decidedByNote: candidate.decidedByNote,
        detectedAt: candidate.detectedAt,
        decidedAt: candidate.decidedAt,
        appliedAt: candidate.appliedAt,
      },
      members: members.map((m) => ({
        storeId: m.storeId,
        name: m.name,
        role: m.role,
        collapseState: m.collapseState,
        resultingLocationId: m.resultingLocationId,
        isActive: m.isActive,
        phone: m.phone,
        placeId: m.placeId,
        address: formatShowroomAddress({
          streetNumber: m.streetNumber,
          streetName: m.streetName,
          city: m.city,
          state: m.state,
          zipCode: m.zipCode,
        }),
        locationCount: locCounts.get(m.storeId) ?? 0,
      })),
    };
  },
});
