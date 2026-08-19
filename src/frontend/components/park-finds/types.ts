/**
 * @fileoverview Park-Finds (0032 D1b) — shared types for the discovery HITL queue.
 *
 * A "park-find" is a candidate the proximity scan (decision 1.d) staged when the car
 * parked at an unregistered, remodel-relevant place. This mirrors the REST shape
 * returned by `GET /api/showroom-hitl-queue` (service `services/showroom/hitl-queue.ts`).
 */
export type HitlDecision = "TBD" | "PROCESS" | "DO_NOT_PROCESS";

export interface ParkFindCandidate {
  id: number;
  name: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  /** The registered store this became, once PROCESSed. */
  storeId: number | null;
  storeName: string | null;
  userDecision: HitlDecision;
  driveListId: number | null;
  /** The drive this was found on (JOINed for display — never denormalized). */
  driveListTitle: string | null;
  /** Raw proximity-scan packet (JSON string) — parsed for distance + candidates. */
  proximityScanJson: string | null;
  categoryGuess: string | null;
  createdAt: number | string | null;
  updatedAt: number | string | null;
}

/** The `chosen` slice of the proximity-scan packet, for the card's distance chip. */
export interface ScanPacket {
  chosen?: { placeId?: string; name?: string; distanceM?: number; primaryType?: string };
  radiusM?: number;
}

export const DECISION_LABEL: Record<HitlDecision, string> = {
  TBD: "Awaiting review",
  PROCESS: "Added to directory",
  DO_NOT_PROCESS: "Not relevant",
};
