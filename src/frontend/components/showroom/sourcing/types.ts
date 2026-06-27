/**
 * @fileoverview Shared types and pure helpers for the Sourcing Research console.
 *
 * These mirror the showroom D1 schema rows returned by the research-context
 * endpoints (`GET /api/showroom-stores/:id/research/context` and
 * `GET /api/showroom-stores/products/:pid/research/context`) plus the deep-sweep
 * result envelope. Kept framework-free so the orchestrator, ledger, gallery,
 * and dialogs can all import from one place without circular deps.
 */

/** A showroom/store row from `GET /api/showroom-stores`. */
export interface ShowroomStore {
  id: number;
  name: string;
  description?: string | null;
  pricePoint?: "$" | "$$" | "$$$" | "$$$$" | null;
  websiteUrl?: string | null;
  inventoryFocus?: string | null;
  cityName?: string | null;
  hubName?: string | null;
  createdAt?: string | number | null;
}

/** A product row from `GET /api/showroom-stores/:id/products`. */
export interface ShowroomProduct {
  id: number;
  storeId: number;
  itemName: string;
  description?: string | null;
  colors?: string | null;
  sku?: string | null;
  price?: string | null;
  createdAt?: string | number | null;
}

export type Sentiment = "good" | "bad" | "neutral";

/** HITL review state of a parsed fact or scraped image. */
export type ReviewStatus = "pending" | "approved" | "rejected";

/** A research finding (`store_research` / `store_product_research`). */
export interface ResearchFinding {
  id: number;
  finding: string;
  findingUrl?: string | null;
  sentiment?: Sentiment | null;
  timestamp?: string | number | null;
  reviewStatus?: ReviewStatus | null;
  reviewReason?: string | null;
}

/** A scraped image (`product_images` / `showroom_images`). */
export interface SourcedImage {
  id: number;
  deliveryUrl: string;
  cfImageId?: string | null;
  sourceUrl: string;
  sourcePageUrl?: string | null;
  altText?: string | null;
  imageKind?: string | null;
  ogTitle?: string | null;
  createdAt?: string | number | null;
  reviewStatus?: ReviewStatus | null;
  reviewReason?: string | null;
}

/** An extracted product spec (`product_specs`). */
export interface ProductSpec {
  id: number;
  specKey: string;
  specValue: string;
  unit?: string | null;
  sourceUrl?: string | null;
  confidence: number;
}

/** An external platform rating (`showroom_store_ratings`) — a "source". */
export interface ExternalRating {
  id: number;
  source: string;
  comment?: string | null;
  rating: number;
  ratingCreated?: string | null;
}

/** Active homeowner rating (`store_rating` / `store_product_rating`). */
export interface ActiveRating {
  id: number;
  rating: number;
  ratingNotes?: string | null;
}

/** Counts returned by every deep-sweep route (`sweepResultSchema`). */
export interface SweepResult {
  success: boolean;
  targetType: "product" | "store" | "category";
  targetId: number;
  citationsFound: number;
  sourcesProcessed: number;
  findingsWritten: number;
  imagesWritten: number;
  specsWritten: number;
  vectorsWritten: number;
  warnings: string[];
}

/** Product-scoped sourcing context payload. */
export interface ProductResearchContext {
  product: ShowroomProduct;
  findings: ResearchFinding[];
  images: SourcedImage[];
  specs: ProductSpec[];
  rating: ActiveRating | null;
}

/** Store-scoped sourcing context payload. */
export interface StoreResearchContext {
  store: ShowroomStore;
  findings: ResearchFinding[];
  images: SourcedImage[];
  externalRatings: ExternalRating[];
  rating: ActiveRating | null;
}

export type ResearchMode = "quick" | "deep";

/** Onboard-agent annotation on a drafted plan (mirrors the backend service). */
export interface PlanAnnotation {
  kind: "scope" | "gap" | "redundancy" | "constraint" | "risk";
  note: string;
}

/** A plan-gated sweep session (`sourcing_sweep_sessions`). */
export interface SweepSession {
  id: number;
  targetType: "product" | "store" | "category";
  targetId: number;
  researchMode: ResearchMode;
  planMarkdown?: string | null;
  planAnnotations?: string | null;
  planStatus?: string | null;
  planRevision?: number | null;
  /** planning | awaiting_plan_approval | sweeping | complete | failed */
  status: string;
  resultJson?: string | null;
  errorMessage?: string | null;
}

/** Which entity a sweep / ledger row targets. */
export type SweepTarget =
  | { kind: "store"; storeId: number }
  | { kind: "product"; productId: number };

// ─── Pure UI helpers ──────────────────────────────────────────────────────────

/**
 * Map a sentiment to Monolith chip classes (emerald=good, rose=bad,
 * zinc=neutral) using the codebase's `bg-<c>/10 text-<c> ring-<c>/20` idiom.
 */
export function sentimentChip(sentiment: Sentiment | null | undefined): string {
  switch (sentiment) {
    case "good":
      return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25";
    case "bad":
      return "bg-rose-500/10 text-rose-400 ring-rose-500/25";
    default:
      return "bg-zinc-500/10 text-zinc-400 ring-zinc-500/25";
  }
}

export function sentimentLabel(sentiment: Sentiment | null | undefined): string {
  if (sentiment === "good") return "Positive";
  if (sentiment === "bad") return "Negative";
  return "Neutral";
}

/** Normalize a 1–5 platform rating into a coarse sentiment for source chips. */
export function ratingToSentiment(rating: number): Sentiment {
  if (rating >= 4) return "good";
  if (rating <= 2) return "bad";
  return "neutral";
}

/**
 * Roll a list of findings up into a single dominant sentiment for the ledger
 * summary chip: bad wins over good wins over neutral (negatives surface first).
 */
export function rollupSentiment(findings: ResearchFinding[]): Sentiment {
  let good = 0;
  let bad = 0;
  for (const f of findings) {
    if (f.sentiment === "good") good += 1;
    else if (f.sentiment === "bad") bad += 1;
  }
  if (bad > 0 && bad >= good) return "bad";
  if (good > 0) return "good";
  return "neutral";
}

export type ScrapeStatus = "scraping" | "syncing" | "verified";

/**
 * Derive a scrape lifecycle state for a sourced image. While a sweep is in
 * flight we optimistically show "scraping"; a row that has a Cloudflare Images
 * id is a "verified" asset, otherwise it is still "syncing" to the CDN.
 */
export function scrapeStatus(
  image: SourcedImage,
  sweeping: boolean,
): ScrapeStatus {
  if (image.cfImageId) return "verified";
  if (sweeping) return "scraping";
  return "syncing";
}

/** Monolith tone for a scrape status badge. */
export function scrapeStatusChip(status: ScrapeStatus): string {
  switch (status) {
    case "verified":
      return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25";
    case "scraping":
      return "bg-violet-500/10 text-violet-300 ring-violet-500/25";
    default:
      return "bg-amber-500/10 text-amber-400 ring-amber-500/25";
  }
}

export function scrapeStatusLabel(status: ScrapeStatus): string {
  if (status === "verified") return "Verified asset";
  if (status === "scraping") return "Scraping…";
  return "Syncing…";
}

/** "new" = created within the recent-sweep window (default 7 days). */
export function isNewlySourced(
  createdAt: string | number | null | undefined,
  windowDays = 7,
): boolean {
  if (createdAt == null) return false;
  const ts = typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  if (Number.isNaN(ts)) return false;
  // Drizzle timestamp(mode:"timestamp") serializes to seconds when numeric.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return Date.now() - ms <= windowDays * 24 * 60 * 60 * 1000;
}
