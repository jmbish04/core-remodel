/**
 * @fileoverview Finder API client (0032 D2d) — fetch helpers over the D2c-1 REST
 * (/api/showroom-searches* + /api/showroom-exclusions*). Same-origin, cookie auth.
 */
import type { Exclusion, SearchDetail, SearchRevision, SearchSummary } from "./types";

async function json<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || payload == null) {
    throw new Error((payload as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  }
  return payload as T;
}

const opts = (init?: RequestInit): RequestInit => ({
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  ...init,
});

export async function listSearches(): Promise<{ count: number; searches: SearchSummary[] }> {
  return json(await fetch("/api/showroom-searches", opts()));
}

export interface RunSearchInput {
  near?: string | null;
  query?: string | null;
  radiusM?: number | null;
  broad?: boolean;
  usePlaces?: boolean;
  slug?: string | null;
  title?: string | null;
}

export async function runSearch(input: RunSearchInput): Promise<{ slug: string; url: string; revision: number; count: number; summary: string }> {
  return json(await fetch("/api/showroom-searches", opts({ method: "POST", body: JSON.stringify(input) })));
}

export async function getSearch(slug: string): Promise<SearchDetail> {
  return json(await fetch(`/api/showroom-searches/${encodeURIComponent(slug)}`, opts()));
}

export async function getRevisions(slug: string): Promise<{ count: number; revisions: SearchRevision[] }> {
  return json(await fetch(`/api/showroom-searches/${encodeURIComponent(slug)}/revisions`, opts()));
}

export async function finalizeSearch(slug: string): Promise<{ ok: boolean }> {
  return json(await fetch(`/api/showroom-searches/${encodeURIComponent(slug)}/finalize`, opts({ method: "POST" })));
}

export async function importResults(slug: string, resultIds: number[]): Promise<{ ok: boolean; imported: number[]; storeIds: number[] }> {
  return json(
    await fetch(`/api/showroom-searches/${encodeURIComponent(slug)}/import`, opts({ method: "POST", body: JSON.stringify({ resultIds }) })),
  );
}

export async function excludeResult(
  slug: string,
  resultId: number,
  reason?: { reasonMarkdown?: string | null; category?: string | null },
): Promise<{ ok: boolean; exclusionId?: number }> {
  return json(
    await fetch(
      `/api/showroom-searches/${encodeURIComponent(slug)}/exclude`,
      opts({ method: "POST", body: JSON.stringify({ resultId, ...reason }) }),
    ),
  );
}

export async function listExclusions(): Promise<{ count: number; exclusions: Exclusion[] }> {
  return json(await fetch("/api/showroom-exclusions", opts()));
}

export async function removeExclusion(id: number): Promise<{ ok: boolean }> {
  return json(await fetch(`/api/showroom-exclusions/${id}`, opts({ method: "DELETE" })));
}
