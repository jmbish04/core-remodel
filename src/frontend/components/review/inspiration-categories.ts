/**
 * Shared contract for level/home-scoped inspiration categorization.
 *
 * This module is the single frontend mirror of the backend's authoritative
 * `INSPIRATION_CATEGORIES` list (see `src/backend/api/routes/images.ts`). The
 * backend is the source of truth and validates every PATCH against the same
 * twelve labels; we mirror them here so the picker can render instantly without
 * waiting on a network round-trip. The runtime `validCategories` array returned
 * by `POST /api/images/:id/suggest-category` and `PATCH .../inspiration-category`
 * (on the 400 path) should always equal this list — if it ever diverges, trust
 * the server payload, not this constant.
 *
 * Nothing in this file performs I/O; it is a pure types + helpers module shared
 * by `ScopedInspirationReview.tsx` (the grouped viewer) and
 * `ScopedInspirationCategorizer.tsx` (the /review categorization workflow).
 */

/**
 * The twelve canonical inspiration categories that naturally apply level- or
 * home-wide (interior doors, flooring, paint, etc.). Order matches the backend
 * declaration so the dropdown reads identically to the AI prompt's option list.
 */
export const INSPIRATION_CATEGORIES = [
  "Interior Doors",
  "Lighting",
  "Light Switches",
  "Drywall Finishes",
  "Flooring",
  "Paint Colors",
  "Trim/Baseboards",
  "Hardware",
  "Tile",
  "Countertops",
  "Cabinets",
  "Other",
] as const;

/** A single valid inspiration category label. */
export type InspirationCategory = (typeof INSPIRATION_CATEGORIES)[number];

/** The two broad scopes this surface deals with (room scope is handled elsewhere). */
export type BroadScope = "level" | "home";

/**
 * Narrows an arbitrary string to a known `InspirationCategory`. Used to defend
 * against stale/unknown values arriving from the API before we feed them into
 * the typed `<Select>` (an unknown value would otherwise render a blank trigger).
 */
export function isInspirationCategory(
  value: string | null | undefined,
): value is InspirationCategory {
  return (
    typeof value === "string" &&
    (INSPIRATION_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Minimal image shape consumed by both the viewer and the categorizer. This is a
 * deliberately small subset of the full `images` row returned by
 * `GET /api/images/inspiration/scoped`; we only read the fields needed to render
 * a thumbnail and drive the category control.
 */
export interface ScopedInspirationImage {
  id: string;
  displayName: string | null;
  description: string | null;
  cfImageIdOriginal: string | null;
  cfImageIdOptimized: string | null;
  /** Cloudflare Images delivery URL when the backend pre-resolved it. */
  deliveryUrl?: string | null;
  /** Persisted category, or null when not yet categorized. */
  inspirationCategory: string | null;
  inspirationScope?: string | null;
  scopeFloorId?: number | null;
}

/** One category bucket as returned by `?groupBy=category`. */
export interface ScopedInspirationGroup {
  /** Category label, or null for the trailing "uncategorized" bucket. */
  category: string | null;
  count: number;
  images: ScopedInspirationImage[];
}

/** Grouped response from `GET /api/images/inspiration/scoped?groupBy=category`. */
export interface ScopedInspirationGroupedResponse {
  success?: boolean;
  scope?: BroadScope;
  floorId?: number | null;
  groups?: ScopedInspirationGroup[];
  totalCount?: number;
  error?: string;
}

/** Flat (ungrouped) response from `GET /api/images/inspiration/scoped`. */
export interface ScopedInspirationFlatResponse {
  success?: boolean;
  scope?: BroadScope;
  floorId?: number | null;
  count?: number;
  images?: ScopedInspirationImage[];
  error?: string;
}

/** Response shape for `POST /api/images/:id/suggest-category`. */
export interface SuggestCategoryResponse {
  success?: boolean;
  imageId?: string;
  suggestedCategory?: string | null;
  validCategories?: string[];
  error?: string;
}

/** Response shape for `PATCH /api/images/:id/inspiration-category`. */
export interface SetCategoryResponse {
  success?: boolean;
  imageId?: string;
  inspirationCategory?: string | null;
  error?: string;
}

/**
 * Resolves a Cloudflare Images delivery URL for a scoped inspiration image,
 * mirroring the resolution order used elsewhere in the app:
 *   1. an explicit, already-absolute `deliveryUrl`
 *   2. the optimized token, else the original token
 *      - absolute http(s) tokens are used verbatim
 *      - `accountHash/imageId` tokens become an imagedelivery.net URL
 * Returns null when no usable token exists so callers can render a placeholder.
 */
export function resolveScopedImageUrl(
  image: ScopedInspirationImage,
): string | null {
  if (image.deliveryUrl && image.deliveryUrl.startsWith("http")) {
    return image.deliveryUrl;
  }
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return null;
}

/** Human label for the "no category yet" bucket / placeholder. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

/**
 * Per-card transient flags for the categorizer so spinners stay scoped to a
 * single image (AI suggestion in flight vs. a save in flight). Shared by
 * `ScopedInspirationCategorizer` (owner of the state map) and `CategorizerCard`
 * (which renders the spinners).
 */
export interface CardBusyState {
  suggesting: boolean;
  saving: boolean;
}

/** Default "idle" busy state for a card with no in-flight requests. */
export const EMPTY_BUSY: CardBusyState = { suggesting: false, saving: false };
