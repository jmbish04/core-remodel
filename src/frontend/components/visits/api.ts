/**
 * @fileoverview Visit Logs data access (0032 V2c).
 *
 * Thin wrappers over the admin-gated REST surface `/api/showroom-visit-logs`
 * (shared service `services/showroom/visit-log.ts`) and the store directory
 * `/api/showroom-stores`. Same cookie-auth convention as the other islands
 * (`credentials: "include"`, relative paths, JSON errors surfaced as Error).
 * There is no global client in this app — this module is the visits-domain one.
 */
import type { VisitLog } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** List visit logs, optionally filtered by pending/completed and/or a store. */
export async function listVisitLogs(opts: {
  status?: "pending" | "completed";
  storeId?: number;
  limit?: number;
} = {}): Promise<VisitLog[]> {
  const q = new URLSearchParams();
  if (opts.status) q.set("status", opts.status);
  if (opts.storeId != null) q.set("storeId", String(opts.storeId));
  if (opts.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString();
  const data = await json<{ visits: VisitLog[] }>(
    await fetch(`/api/showroom-visit-logs${qs ? `?${qs}` : ""}`, { credentials: "include" }),
  );
  return data.visits ?? [];
}

export async function getVisitLog(id: number): Promise<VisitLog> {
  const data = await json<{ visit: VisitLog }>(
    await fetch(`/api/showroom-visit-logs/${id}`, { credentials: "include" }),
  );
  return data.visit;
}

/** Fields writable on create/update — mirrors the REST `writeBody`. */
export interface VisitLogInput {
  storeId?: number | null;
  driveListId?: number | null;
  stopId?: number | null;
  status?: VisitLog["status"];
  visitType?: VisitLog["visitType"];
  rating?: number | null;
  notesMarkdown?: string | null;
  notesHtml?: string | null;
  gpsSource?: VisitLog["gpsSource"];
  latitude?: number | null;
  longitude?: number | null;
  arrivalAt?: string | number;
  departureAt?: string | number;
}

export async function createVisitLog(input: VisitLogInput): Promise<number> {
  const data = await json<{ id: number }>(
    await fetch("/api/showroom-visit-logs", jsonInit("POST", input)),
  );
  return data.id;
}

export async function updateVisitLog(id: number, input: VisitLogInput): Promise<void> {
  await json<{ ok: true }>(await fetch(`/api/showroom-visit-logs/${id}`, jsonInit("PATCH", input)));
}

export async function deleteVisitLog(id: number): Promise<void> {
  await json<{ ok: true }>(
    await fetch(`/api/showroom-visit-logs/${id}`, { method: "DELETE", credentials: "include" }),
  );
}

// ── Store directory (for the autocomplete) ──────────────────────────────────

export interface StoreOption {
  id: number;
  name: string;
}

export async function listStores(): Promise<StoreOption[]> {
  const data = await json<{ stores: Array<{ id: number; name: string }> }>(
    await fetch("/api/showroom-stores", { credentials: "include" }),
  );
  return (data.stores ?? []).map((s) => ({ id: s.id, name: s.name }));
}

/** Create a bare showroom (name only) — the OTHER path of the autocomplete. */
export async function createStore(name: string): Promise<StoreOption> {
  const data = await json<{ store: { id: number; name: string } }>(
    await fetch("/api/showroom-stores", jsonInit("POST", { name })),
  );
  return { id: data.store.id, name: data.store.name };
}
