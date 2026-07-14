/**
 * @fileoverview Wire types for the Phase-3 bucket review form.
 * Mirrors GET /api/intake/review-queue and the /api/config vocab endpoints.
 */

export interface QueuePhoto {
  id: number;
  imageUrl: string | null;
  fileName: string | null;
}

export interface QueueColor {
  name: string;
  hexCode?: string | null;
}

/** AI extraction seeded into the form (all best-effort). */
export interface QueueAttributes {
  itemName?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  category?: string | null;
  style?: string | null;
  colors?: QueueColor[] | null;
  price?: string | number | null;
  salePrice?: string | number | null;
  discountInfo?: string | null;
  /** Already 0-100 — do NOT ×100. */
  confidence?: number | null;
}

export interface ReviewBucket {
  id: number;
  kind: string;
  label: string | null;
  status: string;
  productId: number | null;
  photos: QueuePhoto[];
  attributes: QueueAttributes | null;
}

export interface CategoryRow {
  id: number;
  name: string;
}

export interface ColorRow {
  id: number;
  name: string;
  hexCode: string | null;
}
