/**
 * @fileoverview Park-Finds data access (0032 D1b).
 *
 * Thin wrappers over the admin-gated REST surface `/api/showroom-hitl-queue`
 * (shared service `services/showroom/hitl-queue.ts`, which the MCP `list_park_finds`
 * / `decide_park_find` tools also call — so this page and the voice loop decide
 * candidates identically). Same cookie-auth convention as the other islands.
 */
import type { HitlDecision, ParkFindCandidate } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface ParkFindsList {
  count: number;
  /** How many are still TBD (the inbox badge). */
  pending: number;
  candidates: ParkFindCandidate[];
}

/** List park-find candidates, optionally filtered by decision. */
export async function listParkFinds(decision?: HitlDecision): Promise<ParkFindsList> {
  const qs = decision ? `?decision=${decision}` : "";
  return json<ParkFindsList>(
    await fetch(`/api/showroom-hitl-queue${qs}`, { credentials: "include" }),
  );
}

export interface DecideInput {
  decision: "PROCESS" | "DO_NOT_PROCESS";
  addExclusion?: boolean;
  reasonMarkdown?: string | null;
}

export interface DecideResult {
  ok: boolean;
  decision?: string;
  storeId?: number;
  exclusionId?: number;
}

/** Approve (→ store) or reject (→ optional exclusion) a candidate. */
export async function decideParkFind(id: number, input: DecideInput): Promise<DecideResult> {
  return json<DecideResult>(
    await fetch(`/api/showroom-hitl-queue/${id}/decide`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
