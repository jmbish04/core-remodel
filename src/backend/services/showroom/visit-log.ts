/**
 * @fileoverview Visit-log service (0032 V2) — the ONE path both the REST routes
 * (`/api/showroom-visit-logs`) and the MCP tools (`visits` domain) go through, so
 * the human surface and the voice loop can never drift.
 *
 * The store name is always JOINed on read — never denormalized onto the log row.
 * Rating is validated to 1–5 here (the API-layer guard that replaces the DB CHECK
 * SQLite can't add to an existing table).
 */
import { showroomStores, showroomVisitLog } from "@backend/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

export const VISIT_TYPES = [
  "SOFT_ARRIVAL",
  "BROWSED_NO_CONTACT",
  "BRIEF_NO_HELP",
  "FULL_SESSION",
  "APPOINTMENT",
] as const;
export const VISIT_STATUSES = [
  "AI_STAGED",
  "TESLA_SOFT_ARRIVAL",
  "TESLA_STAGED",
  "DRAFT",
  "SUBMITTED",
] as const;
export const PENDING_STATUSES = ["AI_STAGED", "TESLA_SOFT_ARRIVAL", "TESLA_STAGED", "DRAFT"] as const;
export const GPS_SOURCES = [
  "tesla-telemetry",
  "tesla-poll",
  "tesla-webhook",
  "device",
  "phone",
  "ai",
  "manual",
] as const;

export type VisitType = (typeof VISIT_TYPES)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export type GpsSource = (typeof GPS_SOURCES)[number];

type Db = ReturnType<typeof drizzle>;

const selectCols = {
  id: showroomVisitLog.id,
  storeId: showroomVisitLog.storeId,
  storeName: showroomStores.name,
  driveListId: showroomVisitLog.driveListId,
  stopId: showroomVisitLog.stopId,
  status: showroomVisitLog.status,
  visitType: showroomVisitLog.visitType,
  rating: showroomVisitLog.rating,
  notesMarkdown: showroomVisitLog.notesMarkdown,
  notesHtml: showroomVisitLog.notesHtml,
  arrivalAt: showroomVisitLog.arrivalAt,
  departureAt: showroomVisitLog.departureAt,
  dwellSeconds: showroomVisitLog.dwellSeconds,
  gpsSource: showroomVisitLog.gpsSource,
  latitude: showroomVisitLog.latitude,
  longitude: showroomVisitLog.longitude,
  matchDistanceM: showroomVisitLog.matchDistanceM,
  softArrivalId: showroomVisitLog.softArrivalId,
  createdAt: showroomVisitLog.createdAt,
  updatedAt: showroomVisitLog.updatedAt,
} as const;

export interface ListVisitLogsArgs {
  status?: "pending" | "completed";
  storeId?: number | null;
  limit?: number;
}

export async function listVisitLogs(db: Db, args: ListVisitLogsArgs = {}) {
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
  const conds = [];
  if (args.status === "pending") conds.push(inArray(showroomVisitLog.status, [...PENDING_STATUSES]));
  else if (args.status === "completed") conds.push(eq(showroomVisitLog.status, "SUBMITTED"));
  if (args.storeId && Number.isFinite(args.storeId)) conds.push(eq(showroomVisitLog.storeId, args.storeId));

  return db
    .select(selectCols)
    .from(showroomVisitLog)
    .leftJoin(showroomStores, eq(showroomVisitLog.storeId, showroomStores.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(showroomVisitLog.createdAt))
    .limit(limit);
}

export async function getVisitLog(db: Db, id: number) {
  const [row] = await db
    .select(selectCols)
    .from(showroomVisitLog)
    .leftJoin(showroomStores, eq(showroomVisitLog.storeId, showroomStores.id))
    .where(eq(showroomVisitLog.id, id))
    .limit(1);
  return row ?? null;
}

export interface VisitLogWrite {
  storeId?: number | null;
  driveListId?: number | null;
  stopId?: number | null;
  status?: VisitStatus;
  visitType?: VisitType;
  rating?: number | null;
  notesMarkdown?: string | null;
  notesHtml?: string | null;
  gpsSource?: GpsSource | null;
  latitude?: number | null;
  longitude?: number | null;
  arrivalAt?: Date;
  departureAt?: Date | null;
}

/** Reject an out-of-range rating (the API-layer guard replacing the DB CHECK). */
function assertRating(rating: number | null | undefined): void {
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new Error("rating must be an integer 1–5 (or null)");
  }
}

function dwell(arrival: Date | null | undefined, departure: Date | null | undefined): number | null {
  if (!arrival || !departure) return null;
  return Math.max(0, Math.round((departure.getTime() - arrival.getTime()) / 1000));
}

export async function createVisitLog(db: Db, w: VisitLogWrite): Promise<number | undefined> {
  assertRating(w.rating);
  const arrival = w.arrivalAt ?? new Date();
  const departure = w.departureAt ?? null;
  const [row] = await db
    .insert(showroomVisitLog)
    .values({
      storeId: w.storeId ?? null,
      driveListId: w.driveListId ?? null,
      stopId: w.stopId ?? null,
      status: w.status ?? "DRAFT",
      visitType: w.visitType ?? "SOFT_ARRIVAL",
      rating: w.rating ?? null,
      notesMarkdown: w.notesMarkdown ?? null,
      notesHtml: w.notesHtml ?? null,
      gpsSource: w.gpsSource ?? "manual",
      latitude: w.latitude ?? null,
      longitude: w.longitude ?? null,
      arrivalAt: arrival,
      departureAt: departure,
      dwellSeconds: dwell(arrival, departure),
    })
    .returning({ id: showroomVisitLog.id });
  return row?.id;
}

/** Returns false when the id doesn't exist. */
export async function updateVisitLog(db: Db, id: number, w: VisitLogWrite): Promise<boolean> {
  assertRating(w.rating);
  const [existing] = await db
    .select({ id: showroomVisitLog.id, arrivalAt: showroomVisitLog.arrivalAt })
    .from(showroomVisitLog)
    .where(eq(showroomVisitLog.id, id))
    .limit(1);
  if (!existing) return false;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const keys = [
    "storeId",
    "driveListId",
    "stopId",
    "status",
    "visitType",
    "rating",
    "notesMarkdown",
    "notesHtml",
    "gpsSource",
    "latitude",
    "longitude",
  ] as const;
  for (const k of keys) if (k in w) patch[k] = w[k];
  if (w.arrivalAt) patch.arrivalAt = w.arrivalAt;
  if (w.departureAt !== undefined) patch.departureAt = w.departureAt;
  const arrForDwell = w.arrivalAt ?? existing.arrivalAt ?? null;
  if (w.departureAt && arrForDwell) patch.dwellSeconds = dwell(arrForDwell, w.departureAt);

  await db.update(showroomVisitLog).set(patch).where(eq(showroomVisitLog.id, id)).run();
  return true;
}

export async function deleteVisitLog(db: Db, id: number): Promise<void> {
  await db.delete(showroomVisitLog).where(eq(showroomVisitLog.id, id)).run();
}
