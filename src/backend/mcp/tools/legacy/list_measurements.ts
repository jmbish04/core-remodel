import { type MeasurementElementType } from "@backend/db";
import { listMeasurements } from "@backend/services/measurements";
import { z } from "zod";

import { rowToDto } from "../../../api/routes/measurements.schemas";
import { num } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listMeasurementsTool = defineTool({
    name: "list_measurements",
    category: "measurements",
    title: "List measurements",
    description:
      "List recorded measurements (newest first), optionally filtered by roomId, elementType (single value or comma-separated list), or free-text q. Use this to see what's already captured before adding more.",
    inputShape: {
      roomId: z.number().optional().describe("Filter to a single room id."),
      elementType: z
        .string()
        .optional()
        .describe("Single value or comma-separated list of element types."),
      q: z.string().optional().describe("Free-text filter."),
      limit: z.number().optional().describe("Max rows to return."),
    },
    annotations: READ_ONLY,
    examples: [
      { title: "Everything measured so far", args: { limit: 50 } },
      { title: "Windows and doors in one room", args: { roomId: 3, elementType: "window,door" } },
    ],
    outputShape: {
      items: z.array(looseObject({ id: z.number().int() })),
    },
    handler: async ({ db }, input) => {
      const args = input as { roomId?: unknown; elementType?: unknown; q?: unknown; limit?: unknown };
      const elementTypes = args.elementType
        ? String(args.elementType)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const rows = await listMeasurements(db, {
        roomId: num(args.roomId),
        elementTypes: elementTypes as MeasurementElementType[] | undefined,
        q: args.q != null ? String(args.q) : undefined,
        limit: num(args.limit),
      });
      return { items: rows.map(rowToDto) };
    },
  });
