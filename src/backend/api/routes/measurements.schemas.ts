/**
 * @fileoverview Zod request/response schemas, DTO mapping, and JSON helpers for the
 * measurements API (0006 Phase 1).  Extracted from `measurements.ts` so the router
 * file stays focused on handlers.  Enum value lists come from the schema layer
 * (MEASUREMENT_ELEMENT_TYPES / MEASUREMENT_SOURCES) so the DB and the request
 * validation never drift.
 */

import { MEASUREMENT_ELEMENT_TYPES, MEASUREMENT_SOURCES, measurements } from "@backend/db";
import { z } from "@hono/zod-openapi";

/** A measurement DB row. */
export type MeasurementRow = typeof measurements.$inferSelect;

/** Coerce a drizzle timestamp (Date | number | null) to unix seconds. */
export function toUnixSeconds(value: Date | number | null | undefined): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return Number(value ?? 0);
}

/** Parse a stored JSON-object string; returns null on null/empty/invalid. */
export function safeParseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const JsonObjectSchema = z.record(z.string(), z.unknown());

/** Full measurement as returned to clients. */
export const MeasurementSchema = z
  .object({
    id: z.number().int(),
    roomId: z.number().int().nullable(),
    floorId: z.number().int().nullable(),
    elementType: z.enum(MEASUREMENT_ELEMENT_TYPES),
    label: z.string().nullable(),
    lengthFeet: z.number().nullable(),
    lengthInches: z.number().nullable(),
    widthFeet: z.number().nullable(),
    widthInches: z.number().nullable(),
    heightFeet: z.number().nullable(),
    heightInches: z.number().nullable(),
    span: JsonObjectSchema.nullable(),
    areaSqFt: z.number().nullable(),
    quantity: z.number().int(),
    source: z.enum(MEASUREMENT_SOURCES),
    isApproximate: z.boolean(),
    accuracyNote: z.string().nullable(),
    notes: z.string().nullable(),
    metadata: JsonObjectSchema.nullable(),
    datetimeCreated: z.number(),
    datetimeUpdated: z.number(),
  })
  .openapi("Measurement");

/**
 * Create body.  `elementType` is required; everything else is optional/nullable.
 * Defaults for quantity/source/isApproximate are applied in the handler (NOT as Zod
 * defaults) so the PATCH partial doesn't accidentally re-default omitted fields.
 */
export const MeasurementCreateSchema = z
  .object({
    roomId: z.number().int().positive().nullable().optional(),
    floorId: z.number().int().positive().nullable().optional(),
    elementType: z.enum(MEASUREMENT_ELEMENT_TYPES),
    label: z.string().min(1).max(200).nullable().optional(),
    lengthFeet: z.number().int().min(0).nullable().optional(),
    lengthInches: z.number().min(0).nullable().optional(),
    widthFeet: z.number().int().min(0).nullable().optional(),
    widthInches: z.number().min(0).nullable().optional(),
    heightFeet: z.number().int().min(0).nullable().optional(),
    heightInches: z.number().min(0).nullable().optional(),
    span: JsonObjectSchema.nullable().optional(),
    areaSqFt: z.number().min(0).nullable().optional(),
    quantity: z.number().int().min(1).optional(),
    source: z.enum(MEASUREMENT_SOURCES).optional(),
    isApproximate: z.boolean().optional(),
    accuracyNote: z.string().max(500).nullable().optional(),
    notes: z.string().nullable().optional(),
    metadata: JsonObjectSchema.nullable().optional(),
  })
  .openapi("MeasurementCreate");

/** Update body — partial create. Omitted = keep; explicit null = clear. */
export const MeasurementUpdateSchema = MeasurementCreateSchema.partial().openapi("MeasurementUpdate");

export const ListQuerySchema = z.object({
  roomId: z.coerce.number().int().positive().optional(),
  floorId: z.coerce.number().int().positive().optional(),
  /** Single value or comma-separated list of element types. */
  elementType: z.string().optional(),
  /** Single value or comma-separated list of sources. */
  source: z.string().optional(),
  /** Free-text search across label, notes, accuracy note, and element type. */
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z
    .enum(["element_type", "label", "room_id", "datetime_created", "datetime_updated"])
    .default("element_type"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export const ErrorSchema = z.object({ error: z.string(), details: z.string().optional() });

/** Map a DB row to the wire DTO (parse JSON columns, normalize timestamps). */
export function rowToDto(row: MeasurementRow): z.infer<typeof MeasurementSchema> {
  return {
    id: row.id,
    roomId: row.roomId ?? null,
    floorId: row.floorId ?? null,
    elementType: row.elementType,
    label: row.label ?? null,
    lengthFeet: row.lengthFeet ?? null,
    lengthInches: row.lengthInches ?? null,
    widthFeet: row.widthFeet ?? null,
    widthInches: row.widthInches ?? null,
    heightFeet: row.heightFeet ?? null,
    heightInches: row.heightInches ?? null,
    span: safeParseJsonObject(row.spanJson),
    areaSqFt: row.areaSqFt ?? null,
    quantity: row.quantity,
    source: row.source,
    isApproximate: row.isApproximate,
    accuracyNote: row.accuracyNote ?? null,
    notes: row.notes ?? null,
    metadata: safeParseJsonObject(row.metadata),
    datetimeCreated: toUnixSeconds(row.datetimeCreated),
    datetimeUpdated: toUnixSeconds(row.datetimeUpdated),
  };
}
