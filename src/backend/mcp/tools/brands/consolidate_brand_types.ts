import { z } from "zod";

import { consolidateBrandTypes } from "@backend/services/brands/type-consolidation";

import { looseObject } from "../../schemas";
import { defineTool, DESTRUCTIVE } from "../../types";

/**
 * MCP trigger for the brand-type taxonomy consolidation (0025 P4 pt.1).
 *
 * Wraps the same `consolidateBrandTypes` service the HTTP route
 * (`POST /api/brands/types/consolidate`) calls, so an agent can run the cleanup
 * from chat. The operation:
 *   1. merges the indisputable synonym/plural type pairs (Cabinets→Cabinetry,
 *      Textiles→Fabrics, …), repointing mappings before deleting the loser;
 *   2. flags the unambiguous primary type on single-type brands;
 *   3. backfills each type's description + AI rationale.
 *
 * Destructive (it deletes the duplicate type rows) but safe to retry — absent
 * losers are skipped and only still-undescribed types are sent to the model.
 */
export const consolidateBrandTypesTool = defineTool({
  name: "consolidate_brand_types",
  category: "brands",
  title: "Consolidate the brand-type taxonomy",
  description:
    "Run the one-time brand-type taxonomy cleanup: merge duplicate/synonym type rows (e.g. Cabinets→Cabinetry, " +
    "Textiles→Fabrics, Wallpaper→Wallcoverings), flag the primary type on single-type brands, and backfill each " +
    "type's description + AI rationale. Idempotent — safe to re-run (absent losers are skipped, only undescribed " +
    "types are re-summarised). Returns a report: the merges performed (with remapped/collision counts), the type " +
    "count before/after, how many primaries were set, and how many descriptions were written. Destructive: it " +
    "deletes the duplicate type definitions after repointing their brand mappings, so take a table backup first.",
  inputShape: {},
  annotations: { ...DESTRUCTIVE, idempotentHint: true },
  outputShape: {
    merges: z.array(
      looseObject({
        survivor: z.string(),
        absorbed: z.string(),
        remapped: z.number().int(),
        collisionsDropped: z.number().int(),
      }),
    ),
    typesBefore: z.number().int(),
    typesAfter: z.number().int(),
    primariesSet: z.number().int(),
    described: z.number().int(),
  },
  examples: [{ title: "Run the consolidation", args: {} }],
  handler: async ({ env }) => {
    return consolidateBrandTypes(env);
  },
});
