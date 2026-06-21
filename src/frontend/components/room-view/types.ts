/**
 * types.ts — the shared wire contract for the room viewport feature.
 *
 * Every section component under `room-view/` (and the `RoomViewApp`
 * orchestrator) imports its prop shapes from here so there is exactly one
 * definition of the `GET /api/rooms/code/:roomCode/detail` payload. The
 * backend handler lives at `src/backend/api/routes/rooms.ts`
 * (`roomsRouter.get("/code/:roomCode/detail")`) which spreads the
 * `loadRoomDetail()` result and appends a `roomStats` block.
 *
 * Keep this file types-only (no runtime exports beyond the small pure helpers
 * below that every section reuses) so it can be imported freely without
 * dragging in React or side effects.
 */

/** Media bucket a section is operating on. */
export type MediaKind = "listing" | "inspiration";

/** Layout modes the Room Media modal exposes (Bento intentionally removed). */
export type MediaViewMode = "gallery" | "masonry" | "list";

/** The structured AI summary object stored per room (parsed from JSON). */
export interface RoomSummaryObject {
  overview?: string;
  renovationStory?: string;
  budgetSnapshot?: string;
  taskFocus?: string[];
  decisionPoints?: string[];
  supportingSignals?: string[];
}

/** A single image row (listing or inspiration) as returned by the detail API. */
export interface RoomImage {
  id: string;
  displayName?: string | null;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  roomType?: string | null;
  metadata?: string | null;
  datetimeCreated?: string | number | Date | null;
  /** Surfaced so the media modal (Round 3b, T3.8) can badge duplicates. */
  isDuplicate?: boolean | null;
}

/** The persisted room AI-summary record. */
export interface RoomSummaryRecord {
  representativeImageId?: string | null;
  summaryMarkdown?: string | null;
  summaryObject?: RoomSummaryObject | null;
  lastUserPrompt?: string | null;
  lastVoiceTranscript?: string | null;
  datetimeGenerated?: string | number | Date | null;
}

/** A supporting document linked to the room. */
export interface SupportingDocumentRecord {
  id: string;
  title: string;
  sourceType: string;
  r2Url?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  roomLabels?: string[];
  visionNodeTitles?: string[];
  datetimeUpdated?: string | number | Date | null;
}

/** A lightweight per-room checklist row. */
export interface ActionItemRecord {
  id: string;
  category: string;
  title: string;
  details?: string | null;
  status: string;
  priority: number;
  estimatedCostCents?: number | null;
}

/** A scenario plan (a "what if we used this room differently" option). */
export interface ScenarioPlanRecord {
  id: string;
  scenarioName: string;
  proposedUse: string;
  stage: string;
  estimatedCostCents?: number | null;
  notes?: string | null;
}

/** A budget tracker row scoped to the room. */
export interface BudgetItemRecord {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  executionClass: string;
  estimatedLowCents?: number | null;
  estimatedHighCents?: number | null;
}

/** An estimate revision linked to the room. */
export interface EstimateRecord {
  id: number;
  estimateId: number;
  revisionNumber: number;
  companyName?: string | null;
  statusName?: string | null;
  totalAmountCents?: number | null;
  sourceSummary?: string | null;
  datetimeUpdated?: string | number | Date | null;
}

/** A vision-plan node (a branch of the renovation idea tree) linked here. */
export interface VisionNodeRecord {
  id: string;
  title: string;
  summary?: string | null;
  status: string;
  nodeType: string;
  estimatedCostCents?: number | null;
  childCount: number;
  supportingDocumentIds: string[];
}

/** Core room identity + free-text notes. */
export interface RoomCoreRecord {
  id: number;
  roomCode: string;
  roomName: string;
  displayName: string;
  floorKey: string;
  floorName: string;
  asIsUse?: string | null;
  generalNotes?: string | null;
  problemAreas?: string | null;
  dimensionLabel?: string | null;
}

/** The aggregate counts the detail endpoint appends. */
export interface RoomStatsRecord {
  listingPhotoCount: number;
  inspirationPhotoCount: number;
  supportingDocumentCount: number;
  actionItemCount: number;
  visionNodeCount: number;
  estimateCount: number;
}

/** The full payload returned by GET /api/rooms/code/:roomCode/detail. */
export interface RoomDetailPayload {
  room: RoomCoreRecord;
  summary: RoomSummaryRecord | null;
  representativeImage: RoomImage | null;
  listingImages: RoomImage[];
  inspirationalImages: RoomImage[];
  supportingDocuments: SupportingDocumentRecord[];
  actionItems: ActionItemRecord[];
  scenarioPlans: ScenarioPlanRecord[];
  budget: {
    items: BudgetItemRecord[];
    totalBudgetLowCents: number;
    totalBudgetHighCents: number;
  };
  estimates: EstimateRecord[];
  visionNodes: VisionNodeRecord[];
  roomStats: RoomStatsRecord;
}

/**
 * Shape of GET /api/planning/tasks/stats?roomId= → `{ success, stats }`.
 * "open" maps to status "pending"; "total" is all tasks for the room.
 * (Backend: src/backend/api/routes/planning-extended.ts.)
 */
export interface TaskStats {
  open: number;
  in_progress: number;
  blocked: number;
  delayed: number;
  done: number;
  total: number;
}

/**
 * Stable DOM ids used both for the scroll-spy TOC anchors and for the stat
 * cards' smooth-scroll targets. Centralized so the orchestrator, the stats
 * row, and the TOC can never drift apart.
 */
export const ROOM_SECTION_IDS = {
  hero: "room-hero",
  stats: "room-stats",
  overview: "room-overview",
  options: "room-options",
  budget: "budget-signals",
  estimates: "estimates",
  tasks: "tasks",
  supporting: "supporting-materials",
} as const;

export type RoomSectionId = (typeof ROOM_SECTION_IDS)[keyof typeof ROOM_SECTION_IDS];

/**
 * Resolves an image record to a deliverable Cloudflare Images URL. Optimized
 * id wins over the original; absolute URLs pass through untouched.
 */
export function resolveImageUrl(image: Pick<RoomImage, "cfImageIdOptimized" | "cfImageIdOriginal">): string {
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return "";
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  return `https://imagedelivery.net/${candidate}/public`;
}

/** Formats integer cents as a whole-dollar USD string, or a fallback. */
export function formatCurrency(valueCents: number | null | undefined, fallback = "n/a"): string {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) return fallback;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}

/** Formats a loosely-typed date value to a locale date string, or a fallback. */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString();
}
