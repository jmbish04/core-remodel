/**
 * @fileoverview Wire types for the price-card review UI (0020-C).
 *
 * Mirrors `GET /api/product-photos/pending` (see
 * src/backend/api/routes/product-photos.ts): each pending row is a
 * `product_showroom_photos` record spread flat with its matched `product` and
 * optional price `observation` joined on. `attributes` is the AI structured
 * extraction — every field is best-effort and may be missing.
 */

/** AI-extracted attributes stored on the photo row (all optional). */
export interface ExtractedAttributes {
  brand?: string | null;
  modelNumber?: string | null;
  itemName?: string | null;
  colors?: string[] | null;
  style?: string | null;
  category?: string | null;
  price?: string | number | null;
  salePrice?: string | number | null;
  discountInfo?: string | null;
  dominantColors?: string[] | null;
  /** 0..1 model confidence for the extraction. */
  confidence?: number | null;
  [key: string]: unknown;
}

/** The matched/created product (raw `showroom_store_products` row subset). */
export interface PendingProduct {
  id: number;
  itemName: string | null;
  brandName?: string | null;
  [key: string]: unknown;
}

/** Optional price observation written alongside the photo. */
export interface PendingObservation {
  id: number;
  price: string | null;
  priceCents: number | null;
  reviewStatus: string | null;
  [key: string]: unknown;
}

/** One pending-review row: photo fields + joined product/observation. */
export interface PendingPhoto {
  id: number;
  productId: number;
  imageUrl: string | null;
  category: string | null;
  photoKind: "product" | "price_card" | "spec_sheet" | "unknown";
  attributes: ExtractedAttributes | null;
  status: "pending_review" | "approved" | "rejected";
  product: PendingProduct | null;
  observation: PendingObservation | null;
}

/** Showroom picker option from `GET /api/showroom-stores`. */
export interface ShowroomOption {
  id: number;
  name: string;
}
