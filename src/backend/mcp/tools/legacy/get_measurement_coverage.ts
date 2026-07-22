import { getMeasurementCoverage } from "@backend/services/measurements";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const getMeasurementCoverageTool = defineTool({
    name: "get_measurement_coverage",
    category: "measurements",
    title: "Get measurement coverage",
    description:
      "Summarize measurement coverage across all active rooms — per-room counts and which element types are recorded — plus the active rooms that still have ZERO measurements. Answers 'what still needs measuring?'.",
    inputShape: {},
    annotations: READ_ONLY,
    examples: [{ title: "What still needs measuring?", args: {} }],
    // Envelope the coverage summary under `coverage` (passthrough) so this tool
    // carries an object outputSchema.
    outputShape: {
      coverage: looseObject({}),
    },
    handler: async ({ db }) => {
      const coverage = await getMeasurementCoverage(db);
      return { coverage };
    },
  });
