import { getMeasurementCoverage } from "@backend/services/measurements";

import type { ToolDef } from "../types";

export const getMeasurementCoverageTool: ToolDef = {
  name: "get_measurement_coverage",
  description:
    "Summarize measurement coverage across all active rooms — per-room counts and which element types are recorded — plus the active rooms that still have ZERO measurements. Answers 'what still needs measuring?'.",
  inputSchema: { type: "object", properties: {} },
  handler: async ({ db }) => {
    const coverage = await getMeasurementCoverage(db);
    return JSON.stringify(coverage);
  },
};
