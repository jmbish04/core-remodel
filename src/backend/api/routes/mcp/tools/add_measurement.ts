import {
  MEASUREMENT_ELEMENT_TYPES,
  MEASUREMENT_SOURCES,
  type MeasurementElementType,
  type MeasurementSource,
} from "@backend/db";
import { createMeasurement } from "@backend/services/measurements";

import { rowToDto } from "../../measurements.schemas";
import type { ToolDef } from "../types";

export const addMeasurement: ToolDef = {
  name: "add_measurement",
  description:
    "Record one measurement in the master measurements table. Dimensions are CANONICAL US units: feet (whole number) + inches (decimal) per side, plus optional areaSqFt — not every element has all sides (a window is width × height). `roomId` (optional) must be an ACTIVE room from list_rooms. Use source='measured' and isApproximate=false for a real tape/laser reading (measure twice, cut once); source defaults to 'estimated' and isApproximate to true.",
  inputSchema: {
    type: "object",
    properties: {
      roomId: { type: "number" },
      elementType: { type: "string", enum: [...MEASUREMENT_ELEMENT_TYPES] },
      label: { type: "string" },
      lengthFeet: { type: "number" },
      lengthInches: { type: "number" },
      widthFeet: { type: "number" },
      widthInches: { type: "number" },
      heightFeet: { type: "number" },
      heightInches: { type: "number" },
      areaSqFt: { type: "number" },
      quantity: { type: "number" },
      source: { type: "string", enum: [...MEASUREMENT_SOURCES] },
      isApproximate: { type: "boolean" },
      accuracyNote: { type: "string" },
      notes: { type: "string" },
    },
    required: ["elementType"],
  },
  handler: async ({ db, args }) => {
    const elementType = String(args.elementType ?? "");
    if (!(MEASUREMENT_ELEMENT_TYPES as readonly string[]).includes(elementType)) {
      throw new Error(
        `invalid elementType "${elementType}". Valid: ${MEASUREMENT_ELEMENT_TYPES.join(", ")}`,
      );
    }
    let source: MeasurementSource | undefined;
    if (args.source != null) {
      const candidate = String(args.source);
      if (!(MEASUREMENT_SOURCES as readonly string[]).includes(candidate)) {
        throw new Error(`invalid source "${candidate}". Valid: ${MEASUREMENT_SOURCES.join(", ")}`);
      }
      source = candidate as MeasurementSource;
    }

    // Coerce optional numerics defensively (the MCP path has no Zod gate): a stray
    // non-numeric becomes null rather than poisoning the row with NaN.
    const num = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const quantity =
      args.quantity != null && Number.isFinite(Number(args.quantity))
        ? Number(args.quantity)
        : undefined;
    const result = await createMeasurement(db, {
      roomId: num(args.roomId),
      elementType: elementType as MeasurementElementType,
      label: args.label != null ? String(args.label) : null,
      lengthFeet: num(args.lengthFeet),
      lengthInches: num(args.lengthInches),
      widthFeet: num(args.widthFeet),
      widthInches: num(args.widthInches),
      heightFeet: num(args.heightFeet),
      heightInches: num(args.heightInches),
      areaSqFt: num(args.areaSqFt),
      quantity,
      source,
      isApproximate: args.isApproximate != null ? Boolean(args.isApproximate) : undefined,
      accuracyNote: args.accuracyNote != null ? String(args.accuracyNote) : null,
      notes: args.notes != null ? String(args.notes) : null,
    });
    if (!result.ok) throw new Error(result.error);
    return JSON.stringify(rowToDto(result.row));
  },
};
