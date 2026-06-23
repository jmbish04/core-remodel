/**
 * @fileoverview Plain-fetch API helpers for the Sourcing Research console.
 *
 * Mirrors the codebase convention: no apiClient / no react-query, just `fetch`
 * with `credentials: "include"` (the /api/showroom-stores surface is gated by
 * requireAccessAuth) and the `{ success, error, ...payload }` envelope checked
 * as `!res.ok || !payload.success`. Returns a discriminated `ApiResult<T>` so
 * callers branch without try/catch sprawl.
 */

import type {
  ProductResearchContext,
  ResearchMode,
  ReviewStatus,
  StoreResearchContext,
  SweepResult,
} from "./types";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

async function request<T>(
  url: string,
  init?: RequestInit,
  pick?: (payload: any) => T,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { credentials: "include", ...init });
    const payload = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || payload?.success === false) {
      return {
        ok: false,
        error: payload?.error ?? `Request failed (${res.status})`,
      };
    }
    return { ok: true, data: pick ? pick(payload) : (payload as T) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ─── Discovery / listing ──────────────────────────────────────────────────────

export interface StoreListRow {
  id: number;
  name: string;
  description?: string | null;
  pricePoint?: "$" | "$$" | "$$$" | "$$$$" | null;
  inventoryFocus?: string | null;
  websiteUrl?: string | null;
  cityName?: string | null;
  hubName?: string | null;
  createdAt?: string | number | null;
}

export function listStores(search?: string): Promise<ApiResult<StoreListRow[]>> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return request(`/api/showroom-stores${qs}`, undefined, (p) => p.stores ?? []);
}

export function listProducts(storeId: number) {
  return request(
    `/api/showroom-stores/${storeId}/products`,
    undefined,
    (p) => p.products ?? [],
  );
}

// ─── Research context reads ───────────────────────────────────────────────────

export function getStoreContext(
  storeId: number,
): Promise<ApiResult<StoreResearchContext>> {
  return request(
    `/api/showroom-stores/${storeId}/research/context`,
    undefined,
    (p) => ({
      store: p.store,
      findings: p.findings ?? [],
      images: p.images ?? [],
      externalRatings: p.externalRatings ?? [],
      rating: p.rating ?? null,
    }),
  );
}

export function getProductContext(
  productId: number,
): Promise<ApiResult<ProductResearchContext>> {
  return request(
    `/api/showroom-stores/products/${productId}/research/context`,
    undefined,
    (p) => ({
      product: p.product,
      findings: p.findings ?? [],
      images: p.images ?? [],
      specs: p.specs ?? [],
      rating: p.rating ?? null,
    }),
  );
}

// ─── Prompt staging + sweeps ──────────────────────────────────────────────────

export function draftProductPrompt(
  productId: number,
  negativeConstraints: string[] = [],
): Promise<ApiResult<string>> {
  return request(
    `/api/showroom-stores/products/${productId}/research/draft-prompt`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ negativeConstraints }),
    },
    (p) => p.prompt ?? "",
  );
}

export interface SweepOptions {
  prompt?: string;
  maxSources?: number;
  researchMode: ResearchMode;
  deepResearchWaitMs?: number;
  enableMcpBridge: boolean;
  negativeConstraints?: string[];
}

function sweepBody(opts: SweepOptions) {
  return JSON.stringify({
    prompt: opts.prompt?.trim() || undefined,
    maxSources: opts.maxSources,
    researchMode: opts.researchMode,
    deepResearchWaitMs: opts.deepResearchWaitMs,
    enableMcpBridge: opts.enableMcpBridge,
    negativeConstraints: opts.negativeConstraints ?? [],
    triggerSource: "manual",
  });
}

export function sweepProduct(
  productId: number,
  opts: SweepOptions,
): Promise<ApiResult<SweepResult>> {
  return request(
    `/api/showroom-stores/products/${productId}/research/deep-sweep`,
    { method: "POST", headers: JSON_HEADERS, body: sweepBody(opts) },
  );
}

export function sweepStore(
  storeId: number,
  opts: SweepOptions,
): Promise<ApiResult<SweepResult>> {
  return request(
    `/api/showroom-stores/${storeId}/research/deep-sweep`,
    { method: "POST", headers: JSON_HEADERS, body: sweepBody(opts) },
  );
}

// ─── Approve / rule-out (writes store rating; feeds the cron loop) ─────────────

/**
 * Rate a showroom. Approve = a strong positive rating; rule-out = rating 1 with
 * the homeowner's reason in `ratingNotes`, which the cron monitor reads as a
 * negative constraint (`storeRating <= 1`) when re-sweeping a category.
 */
export function rateStore(
  storeId: number,
  rating: number,
  ratingNotes?: string,
): Promise<ApiResult<{ id: number }>> {
  return request(
    `/api/showroom-stores/${storeId}/rate`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ rating, ratingNotes }),
    },
    (p) => p.rating ?? { id: 0 },
  );
}

// ─── Per-fact / per-image HITL review ─────────────────────────────────────────

/** Which table a finding/image lives in (product- vs store-scoped). */
export type ReviewScope = "product" | "store";

/**
 * Set a finding's review state. Approving keeps a correct fact; rejecting marks
 * a mis-attributed/low-quality one — the reason is replayed as a negative
 * constraint on the next sweep.
 */
export function reviewFinding(
  scope: ReviewScope,
  findingId: number,
  reviewStatus: ReviewStatus,
  reviewReason?: string,
): Promise<ApiResult<{ id: number }>> {
  return request(
    `/api/showroom-stores/research/findings/${findingId}`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ scope, reviewStatus, reviewReason }),
    },
    (p) => p.finding ?? { id: findingId },
  );
}

/**
 * Set a scraped image's review state. Rejecting marks junk/spam imagery so it is
 * not surfaced as the entity's media.
 */
export function reviewImage(
  scope: ReviewScope,
  imageId: number,
  reviewStatus: ReviewStatus,
  reviewReason?: string,
): Promise<ApiResult<{ id: number }>> {
  return request(
    `/api/showroom-stores/research/images/${imageId}`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ scope, reviewStatus, reviewReason }),
    },
    (p) => p.image ?? { id: imageId },
  );
}
