/**
 * @fileoverview Shared helpers for the visits MCP domain (0032 V2b).
 *
 * The tools are thin wrappers over `services/showroom/visit-log.ts` — the SAME
 * service the REST routes call — so MCP and REST can never drift.
 */
import {
  GPS_SOURCES,
  VISIT_STATUSES,
  VISIT_TYPES,
  type VisitLogWrite,
} from "@backend/services/showroom/visit-log";
import { siteUrl } from "../../urls";
import { z } from "zod";

/** Workspace URL for a visit log (or the list when no id). */
export function visitLogUrl(env: Env, id?: number): string {
  return siteUrl(env, id != null ? `/admin/shopping/showrooms/visitlogs/${id}` : "/admin/shopping/showrooms/visitlogs");
}

/** ISO string or epoch-ms, either accepted for arrival/departure. */
const isoOrEpoch = z.union([z.string(), z.number()]);

/** The write fields shared by create + update (all optional; create fills defaults). */
export const writeShape = {
  storeId: z.number().int().positive().nullable().optional().describe("Registered showroom id (JOINed for the name)"),
  driveListId: z.number().int().positive().nullable().optional().describe("Drive context, when from a drive"),
  stopId: z.number().int().positive().nullable().optional().describe("Specific drive stop this visit checks off"),
  status: z.enum(VISIT_STATUSES).optional().describe("Lifecycle; DRAFT for a human draft, SUBMITTED when finalized"),
  visitType: z
    .enum(VISIT_TYPES)
    .optional()
    .describe("Engagement depth: SOFT_ARRIVAL | BROWSED_NO_CONTACT | BRIEF_NO_HELP | FULL_SESSION | APPOINTMENT"),
  rating: z.number().int().min(1).max(5).nullable().optional().describe("1–5 stars (or null)"),
  notesMarkdown: z
    .string()
    .nullable()
    .optional()
    .describe("Visit notes as Markdown — the source of truth. Send Markdown, not HTML."),
  notesHtml: z
    .string()
    .nullable()
    .optional()
    .describe("Render cache — DERIVED server-side from notesMarkdown; a value sent here is ignored when notesMarkdown is present."),
  gpsSource: z.enum(GPS_SOURCES).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  arrivalAt: isoOrEpoch.optional().describe("When the visit began (ISO or epoch-ms; defaults to now on create)"),
  departureAt: isoOrEpoch.optional().describe("When it ended — sets dwell"),
} as const;

const toDate = (v: string | number | undefined): Date | undefined => {
  if (v == null) return undefined;
  const ms = typeof v === "number" ? v : Date.parse(v);
  // Reject an unparseable date — new Date(NaN) is an Invalid Date that would slip
  // past a `?? null` guard and persist garbage.
  return Number.isFinite(ms) ? new Date(ms) : undefined;
};

/** Map validated MCP input to the service's VisitLogWrite (dates parsed). */
export function toWrite(input: Record<string, unknown>): VisitLogWrite {
  const w: VisitLogWrite = {};
  for (const k of [
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
  ] as const) {
    if (k in input) (w as Record<string, unknown>)[k] = input[k];
  }
  if ("arrivalAt" in input) w.arrivalAt = toDate(input.arrivalAt as string | number | undefined);
  if ("departureAt" in input) w.departureAt = toDate(input.departureAt as string | number | undefined) ?? null;
  return w;
}
