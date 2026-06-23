/**
 * @fileoverview Shared client-side types, enum option lists, and label maps for
 * the /measurements admin surface (0006 Phase 1).
 *
 * The element-type and source value lists MIRROR the backend enum source of truth
 * in `src/backend/db/schema/home/measurements.ts` (MEASUREMENT_ELEMENT_TYPES /
 * MEASUREMENT_SOURCES).  They are duplicated here (rather than imported from
 * `@backend/db`) so the React bundle doesn't pull in drizzle-orm.  Keep the two
 * lists in sync — the API rejects unknown values via Zod.
 */

import { formatLength, type UnitSystem } from "@/lib/units";

/** Badge variants offered by `@/components/ui/badge`. */
type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

/** Element types — mirrors MEASUREMENT_ELEMENT_TYPES. */
export const ELEMENT_TYPES = [
  "room",
  "closet",
  "built_in",
  "window",
  "door",
  "shower",
  "tub",
  "vanity",
  "sink",
  "toilet",
  "wall",
  "ceiling",
  "clearance",
  "stair",
  "stair_landing",
  "pony_wall",
  "handrail",
  "skylight",
  "roof",
  "post",
  "retaining_wall",
  "appliance",
  "duct",
  "mechanical_run",
  "site_area",
  "other",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

/** Sources — mirrors MEASUREMENT_SOURCES. */
export const SOURCES = ["insurance_matterport", "measured", "estimated", "plan"] as const;

export type MeasurementSource = (typeof SOURCES)[number];

/** Human label for an element type (Title Case from the snake_case value). */
export function elementTypeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Human labels for sources. */
export const SOURCE_LABELS: Record<MeasurementSource, string> = {
  insurance_matterport: "Insurance / Matterport",
  measured: "Measured",
  estimated: "Estimated",
  plan: "Plan",
};

/** `{ value, label }` option arrays for the Select pickers. */
export const ELEMENT_TYPE_OPTIONS = ELEMENT_TYPES.map((value) => ({
  value,
  label: elementTypeLabel(value),
}));

export const SOURCE_OPTIONS = SOURCES.map((value) => ({
  value,
  label: SOURCE_LABELS[value],
}));

/**
 * Badge variant for a source — `measured` is the authoritative/solid one, the
 * rest are progressively softer to telegraph trust at a glance.
 */
export function sourceBadgeVariant(source: string): BadgeVariant {
  switch (source) {
    case "measured":
      return "default";
    case "insurance_matterport":
      return "secondary";
    case "estimated":
      return "outline";
    case "plan":
      return "secondary";
    default:
      return "outline";
  }
}

/**
 * The measurement record as returned by GET /api/measurements.
 * Mirrors the API's `MeasurementSchema` DTO.
 */
export interface Measurement {
  id: number;
  roomId: number | null;
  floorId: number | null;
  elementType: ElementType;
  label: string | null;
  lengthFeet: number | null;
  lengthInches: number | null;
  widthFeet: number | null;
  widthInches: number | null;
  heightFeet: number | null;
  heightInches: number | null;
  span: Record<string, unknown> | null;
  areaSqFt: number | null;
  quantity: number;
  source: MeasurementSource;
  isApproximate: boolean;
  accuracyNote: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  datetimeCreated: number;
  datetimeUpdated: number;
}

/** Payload accepted by POST / PATCH /api/measurements. */
export interface MeasurementInput {
  roomId: number | null;
  elementType: ElementType;
  label: string | null;
  lengthFeet: number | null;
  lengthInches: number | null;
  widthFeet: number | null;
  widthInches: number | null;
  heightFeet: number | null;
  heightInches: number | null;
  areaSqFt: number | null;
  quantity: number;
  source: MeasurementSource;
  isApproximate: boolean;
  accuracyNote: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Dimension formatting helpers (shared by the table + dialog)
// ---------------------------------------------------------------------------

/** Parse a whole-number input → integer|null (empty/invalid = null). */
export function toIntOrNull(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse a decimal input → number|null (empty/invalid = null). */
export function toFloatOrNull(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a compact dimension string `L × W × H` in the active unit system
 * (omitting absent sides).  Returns "—" when no dimension is recorded.
 */
export function formatDimensions(m: Measurement, system: UnitSystem): string {
  const sides = [
    formatLength(m.lengthFeet, m.lengthInches, system),
    formatLength(m.widthFeet, m.widthInches, system),
    formatLength(m.heightFeet, m.heightInches, system),
  ].filter((side): side is string => side !== null);
  return sides.length > 0 ? sides.join(" × ") : "—";
}
