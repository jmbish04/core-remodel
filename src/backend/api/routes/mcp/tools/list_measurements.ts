import { type MeasurementElementType } from "@backend/db";
import { listMeasurements } from "@backend/services/measurements";

import { rowToDto } from "../../measurements.schemas";
import type { ToolDef } from "../types";

export const listMeasurementsTool: ToolDef = {
  name: "list_measurements",
  description:
    "List recorded measurements (newest first), optionally filtered by roomId, elementType (single value or comma-separated list), or free-text q. Use this to see what's already captured before adding more.",
  inputSchema: {
    type: "object",
    properties: {
      roomId: { type: "number" },
      elementType: { type: "string" },
      q: { type: "string" },
      limit: { type: "number" },
    },
  },
  handler: async ({ db, args }) => {
    const elementTypes = args.elementType
      ? String(args.elementType)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const num = (v: unknown): number | undefined => {
      if (v == null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const rows = await listMeasurements(db, {
      roomId: num(args.roomId),
      elementTypes: elementTypes as MeasurementElementType[] | undefined,
      q: args.q != null ? String(args.q) : undefined,
      limit: num(args.limit),
    });
    return JSON.stringify(rows.map(rowToDto));
  },
};
