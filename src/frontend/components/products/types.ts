/**
 * @fileoverview Shared types + tiny fetch helper for the product research
 * viewport. These mirror the CONTRACTED response of
 * `GET /api/showroom-stores/products/:id/research/context`.
 *
 * The contract (do not read backend routes for this — they may be mid-edit):
 *   { product, findings, specs, images, intel }
 * where `intel` is null until the research workflow has produced a summary.
 */

// ─── Research status shared by product + brand workflows ──────────────────────

export type ResearchStatus =
  | "idle"
  | "pending"
  | "running"
  | "complete"
  | "failed";

// ─── Row shapes from the research context endpoint ────────────────────────────

/** Product row + denormalized brand/store fields for the ecommerce header. */
export interface ProductContext {
  id: number;
  storeId: number | null;
  storeName: string | null;
  brandId: number | null;
  brandName: string | null;
  itemName: string;
  description: string | null;
  price: string | null;
  sku: string | null;
  leadTime: string | null;
  productType: string | null;
  colors: string | null;
  preferredColor: string | null;
  notes: string | null;
  possibleDiscounts: string | null;
  tradeDiscount: string | null;
}

export interface Finding {
  id: number;
  finding: string;
  findingUrl: string | null;
  sentiment: "good" | "bad" | "neutral" | null;
  reviewStatus?: string | null;
}

export interface Spec {
  id: number;
  specKey: string;
  specValue: string | null;
  unit: string | null;
}

export interface ProductImage {
  id: number;
  deliveryUrl: string;
  altText: string | null;
  imageKind: string | null;
  reviewStatus: string | null;
}

/** AI-derived pricing + regulatory intel; null before the workflow runs. */
export interface ProductIntel {
  reviewSummary: string | null;
  priceRangeLow: string | null;
  priceRangeHigh: string | null;
  aiWholesalePrice: string | null;
  aiWholesaleRationale: string | null;
  aiRetailPrice: string | null;
  aiRetailRationale: string | null;
  aiNegotiatedPrice: string | null;
  aiNegotiatedRationale: string | null;
  salesIntel: string | null;
  caRegulatoryFlag: boolean | null;
  caRegulatoryNotes: string | null;
  researchReport: string | null;
  researchSources: string | null;
  researchStatus: ResearchStatus;
}

export interface ProductResearchContext {
  product: ProductContext;
  findings: Finding[];
  specs: Spec[];
  images: ProductImage[];
  intel: ProductIntel | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Thin JSON fetch that forwards session cookies and surfaces server error
 * strings. Never swallows failures — the caller routes them into a toast.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** A research status counts as "in flight" while pending or running. */
export function isResearchInFlight(status: ResearchStatus | null | undefined): boolean {
  return status === "pending" || status === "running";
}

/** Present a price-ish string with a leading $ only when it looks numeric. */
export function formatPrice(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^[$€£]/.test(trimmed)) return trimmed;
  if (/^[\d.,]+$/.test(trimmed)) return `$${trimmed}`;
  return trimmed;
}
