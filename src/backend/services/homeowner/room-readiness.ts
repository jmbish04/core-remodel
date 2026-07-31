import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { roomSpecFields, specDefinitions } from "../../db/schema";

/**
 * roomReadiness — the single translation-ready resolver (0041 Phase 0).
 *
 * THERE IS EXACTLY ONE OF THESE. The translation-ready badge, the threshold rule
 * drawn across the diagram, and any future contractor gate all call it. Two
 * implementations would drift, and a drifting readiness guarantee is worse than
 * none — it would tell a homeowner they are ready to face the trade when they
 * are not, which is the precise failure this product exists to prevent.
 *
 * A room is ready when every ACTIVE spec definition flagged
 * `isRequiredForThreshold` is satisfied on that room. Satisfied means either:
 *
 *   1. a value is present AND its confidence is "known" — verified, not assumed;
 *      or
 *   2. the field carries an explicit `waivedReason` — a deliberate unknown the
 *      homeowner chose to proceed past, having said why.
 *
 * The waiver exists so the threshold is a gate and not a wall. "We are picking
 * the cabinet pull later, on purpose" is a legitimate way to be ready; silence
 * is not.
 *
 * `assumed` and `range` deliberately do NOT satisfy. They are honest, useful
 * states for planning, and they are exactly what must not be quoted to a
 * contractor as though it were measured.
 */

export type ReadinessGapReason =
  | "no_value"
  | "unverified" // a value exists but confidence is assumed | range | unknown
  | "missing_field"; // no row at all for this required definition

export interface ReadinessGap {
  specDefinitionId: number;
  key: string;
  name: string;
  reason: ReadinessGapReason;
  /** The confidence actually recorded, when a row exists. */
  confidence: string | null;
}

export interface RoomReadiness {
  ready: boolean;
  requiredCount: number;
  satisfiedCount: number;
  /** Every unmet requirement, named. A blocked room must say exactly what is missing. */
  gaps: ReadinessGap[];
  /** Requirements satisfied by an explicit waiver rather than a known value. */
  waivedCount: number;
}

export interface RequiredDefinitionRow {
  id: number;
  key: string;
  name: string;
}

export interface SpecFieldRow {
  specDefinitionId: number;
  productId: number | null;
  materialId: number | null;
  valueText: string | null;
  valueCents: number | null;
  confidence: string | null;
  waivedReason: string | null;
}

/** True when the row carries any actual answer, in any of its shapes. */
function hasValue(field: SpecFieldRow): boolean {
  return (
    field.productId !== null ||
    field.materialId !== null ||
    field.valueCents !== null ||
    (field.valueText !== null && field.valueText.trim() !== "")
  );
}

/**
 * The pure decision. Kept free of the database so the invariant can be tested
 * directly and so the same logic can run against proposed (uncommitted) values
 * in the cost-of-change preview.
 */
export function evaluateRoomReadiness(
  required: RequiredDefinitionRow[],
  fields: SpecFieldRow[],
): RoomReadiness {
  const byDefinition = new Map<number, SpecFieldRow>();
  for (const f of fields) byDefinition.set(f.specDefinitionId, f);

  const gaps: ReadinessGap[] = [];
  let satisfied = 0;
  let waived = 0;

  for (const def of required) {
    const field = byDefinition.get(def.id);

    if (!field) {
      gaps.push({
        specDefinitionId: def.id,
        key: def.key,
        name: def.name,
        reason: "missing_field",
        confidence: null,
      });
      continue;
    }

    // A waiver satisfies regardless of value or confidence — it is the
    // homeowner deliberately proceeding, on the record, with a reason.
    if (field.waivedReason !== null && field.waivedReason.trim() !== "") {
      satisfied += 1;
      waived += 1;
      continue;
    }

    if (!hasValue(field)) {
      gaps.push({
        specDefinitionId: def.id,
        key: def.key,
        name: def.name,
        reason: "no_value",
        confidence: field.confidence,
      });
      continue;
    }

    if (field.confidence !== "known") {
      gaps.push({
        specDefinitionId: def.id,
        key: def.key,
        name: def.name,
        reason: "unverified",
        confidence: field.confidence,
      });
      continue;
    }

    satisfied += 1;
  }

  return {
    ready: gaps.length === 0,
    requiredCount: required.length,
    satisfiedCount: satisfied,
    waivedCount: waived,
    gaps,
  };
}

/**
 * The database-backed entry point. Every caller in the app goes through here.
 */
export async function roomReadiness(db: D1Database, roomId: number): Promise<RoomReadiness> {
  const orm = drizzle(db);

  const required = await orm
    .select({
      id: specDefinitions.id,
      key: specDefinitions.key,
      name: specDefinitions.name,
    })
    .from(specDefinitions)
    .where(
      and(eq(specDefinitions.isRequiredForThreshold, true), eq(specDefinitions.isActive, true)),
    )
    .all();

  const fields = await orm
    .select({
      specDefinitionId: roomSpecFields.specDefinitionId,
      productId: roomSpecFields.productId,
      materialId: roomSpecFields.materialId,
      valueText: roomSpecFields.valueText,
      valueCents: roomSpecFields.valueCents,
      confidence: roomSpecFields.confidence,
      waivedReason: roomSpecFields.waivedReason,
    })
    .from(roomSpecFields)
    .where(eq(roomSpecFields.roomId, roomId))
    .all();

  return evaluateRoomReadiness(required, fields);
}
