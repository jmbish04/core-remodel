import {
  MEASUREMENT_ELEMENT_TYPES,
  MEASUREMENT_SOURCES,
  type MeasurementElementType,
  type MeasurementSource,
} from "@backend/db";
import { createMeasurement } from "@backend/services/measurements";
import { z } from "zod";

import { rowToDto } from "../../../api/routes/measurements.schemas";
import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

export const addMeasurement = defineTool({
    name: "add_measurement",
    category: "measurements",
    title: "Add measurement",
    description:
      "Record one measurement in the master measurements table. Dimensions are CANONICAL US units: feet (whole number) + inches (decimal) per side, plus optional areaSqFt — not every element has all sides (a window is width × height). `roomId` (optional) must be an ACTIVE room from list_rooms. Use source='measured' and isApproximate=false for a real tape/laser reading (measure twice, cut once); source defaults to 'estimated' and isApproximate to true.",
    inputShape: {
      roomId: z.number().optional().describe("Active room id (from list_rooms)."),
      elementType: z
        .enum([...MEASUREMENT_ELEMENT_TYPES])
        .describe("The kind of element being measured."),
      label: z.string().optional().describe("Optional human label for the element."),
      lengthFeet: z.number().optional(),
      lengthInches: z.number().optional(),
      widthFeet: z.number().optional(),
      widthInches: z.number().optional(),
      heightFeet: z.number().optional(),
      heightInches: z.number().optional(),
      areaSqFt: z.number().optional(),
      quantity: z.number().optional(),
      source: z
        .enum([...MEASUREMENT_SOURCES])
        .optional()
        .describe("How the measurement was obtained. Defaults to 'estimated'."),
      isApproximate: z.boolean().optional().describe("Defaults to true."),
      accuracyNote: z.string().optional(),
      notes: z.string().optional(),
    },
    annotations: WRITE,
    // Envelope the measurement DTO under `measurement` (passthrough) so this
    // tool carries an object outputSchema.
    outputShape: {
      measurement: looseObject({ id: z.number().int() }),
    },
    handler: async ({ db }, input) => {
      const args = input as Record<string, any>;
      const elementType = String(args.elementType ?? "");
      if (!(MEASUREMENT_ELEMENT_TYPES as readonly string[]).includes(elementType)) {
        toolError(
          `invalid elementType "${elementType}". Valid: ${MEASUREMENT_ELEMENT_TYPES.join(", ")}`,
        );
      }
      let source: MeasurementSource | undefined;
      if (args.source != null) {
        const candidate = String(args.source);
        if (!(MEASUREMENT_SOURCES as readonly string[]).includes(candidate)) {
          toolError(
            `invalid source "${candidate}". Valid: ${MEASUREMENT_SOURCES.join(", ")}`,
          );
        }
        source = candidate as MeasurementSource;
      }

      // Coerce optional numerics defensively (the MCP path has no Zod gate): a stray
      // non-numeric becomes null rather than poisoning the row with NaN.
      // Local coercion returns null (not undefined) so a cleared field is
      // written as NULL. Named parseNum to avoid shadowing the imported `num`.
      const parseNum = (v: unknown): number | null => {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const quantity =
        args.quantity != null && Number.isFinite(Number(args.quantity))
          ? Number(args.quantity)
          : undefined;
      const result = await createMeasurement(db, {
        roomId: parseNum(args.roomId),
        elementType: elementType as MeasurementElementType,
        label: args.label != null ? String(args.label) : null,
        lengthFeet: parseNum(args.lengthFeet),
        lengthInches: parseNum(args.lengthInches),
        widthFeet: parseNum(args.widthFeet),
        widthInches: parseNum(args.widthInches),
        heightFeet: parseNum(args.heightFeet),
        heightInches: parseNum(args.heightInches),
        areaSqFt: parseNum(args.areaSqFt),
        quantity,
        source,
        isApproximate: args.isApproximate != null ? Boolean(args.isApproximate) : undefined,
        accuracyNote: args.accuracyNote != null ? String(args.accuracyNote) : null,
        notes: args.notes != null ? String(args.notes) : null,
      });
      if (!result.ok) toolError(result.error);
      return { measurement: rowToDto(result.row) };
    },
  });
