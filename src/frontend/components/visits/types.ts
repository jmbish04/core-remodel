/**
 * @fileoverview Frontend-local vocabulary for the Visit Logs workspace (0032 V2c).
 *
 * These mirror the enums owned by the backend service
 * (`services/showroom/visit-log.ts`) — status, visit_type, gps_source. They are
 * re-declared here (not imported) so the React islands never pull server code
 * (drizzle, D1) into the bundle. Keep the members in lockstep with the service;
 * a mismatch is a defect (the API is the source of truth).
 */

export const VISIT_STATUSES = [
  "AI_STAGED",
  "TESLA_SOFT_ARRIVAL",
  "TESLA_STAGED",
  "DRAFT",
  "SUBMITTED",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Anything that is not SUBMITTED is still pending finalization. */
export const PENDING_STATUSES: readonly VisitStatus[] = [
  "AI_STAGED",
  "TESLA_SOFT_ARRIVAL",
  "TESLA_STAGED",
  "DRAFT",
];

export const VISIT_TYPES = [
  "SOFT_ARRIVAL",
  "BROWSED_NO_CONTACT",
  "BRIEF_NO_HELP",
  "FULL_SESSION",
  "APPOINTMENT",
] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/**
 * gps_source values exactly as the service enumerates them. The design prose
 * says "tessie-poll / tessie-stream"; the real column values are the ones below,
 * so `SourceBadge` maps THESE (buckets tesla-* → "Tesla", device/phone → "Phone").
 */
export const GPS_SOURCES = [
  "tesla-telemetry",
  "tesla-poll",
  "tesla-webhook",
  "device",
  "phone",
  "ai",
  "manual",
] as const;
export type GpsSource = (typeof GPS_SOURCES)[number];

/** A visit-log row as returned by `GET /api/showroom-visit-logs` (selectCols). */
export interface VisitLog {
  id: number;
  storeId: number | null;
  storeName: string | null;
  driveListId: number | null;
  stopId: number | null;
  status: VisitStatus;
  visitType: VisitType;
  rating: number | null;
  notesMarkdown: string | null;
  notesHtml: string | null;
  arrivalAt: string | null;
  departureAt: string | null;
  dwellSeconds: number | null;
  gpsSource: GpsSource | null;
  latitude: number | null;
  longitude: number | null;
  matchDistanceM: number | null;
  softArrivalId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Present once D1 lands the HITL queue; absent today (forward-compatible). */
  hitlQueueId?: number | null;
}

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  AI_STAGED: "AI staged",
  TESLA_SOFT_ARRIVAL: "Soft arrival",
  TESLA_STAGED: "Staged",
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
};

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  SOFT_ARRIVAL: "Soft arrival",
  BROWSED_NO_CONTACT: "Browsed, no contact",
  BRIEF_NO_HELP: "Brief, no help",
  FULL_SESSION: "Full session",
  APPOINTMENT: "Appointment",
};

export function isPending(status: VisitStatus): boolean {
  return status !== "SUBMITTED";
}

/** dwellSeconds → a short human string ("42 min", "1 h 5 min", "—"). */
export function formatDwell(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** metres → "40 m away" / "1.2 km away" / "" when unknown. */
export function formatDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "";
  return m < 1000 ? `${Math.round(m)} m away` : `${(m / 1000).toFixed(1)} km away`;
}
