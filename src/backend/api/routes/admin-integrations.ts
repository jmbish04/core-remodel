/**
 * @fileoverview Admin Integrations router — `/api/admin/integrations`
 *
 * Exposes operational metrics for third-party integrations.  Currently covers
 * the Google Maps Platform quota; future integrations (Cloudflare AI, Fal,
 * Replicate, etc.) can be added as additional endpoints here.
 *
 * Auth: all `/api/admin/*` routes are gated by `requireAccessAuth` middleware
 * registered in `src/backend/api/index.ts` — this router adds no extra auth.
 *
 * Endpoints:
 *   GET /api/admin/integrations/usage   Current-month Maps quota utilisation
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  GoogleMapsService,
  MAPS_MONTHLY_FREE_TIER_LIMIT,
} from "@/backend/services/google/maps";

export const adminIntegrationsRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Response schema ─────────────────────────────────────────────────────────

/**
 * Per-endpoint breakdown ensuring `autocomplete` and `details` always exist
 * (defaulted to 0) so the frontend can render two fixed rows without
 * conditional checks.
 */
const ByEndpointSchema = z
  .object({
    autocomplete: z
      .number()
      .int()
      .openapi({ description: "Autocomplete requests made this month." }),
    details: z
      .number()
      .int()
      .openapi({ description: "Places Details requests made this month." }),
  })
  .catchall(z.number().int())
  .openapi({ description: "Per-endpoint request counts for the current month." });

const IntegrationsUsageSchema = z.object({
  month: z
    .string()
    .openapi({ description: "Calendar month in 'YYYY-MM' format.", example: "2026-07" }),
  limit: z
    .number()
    .int()
    .openapi({
      description: "Total request quota for the current billing tier.",
      example: 10000,
    }),
  total_requests: z
    .number()
    .int()
    .openapi({ description: "Total Google Maps API requests made this month." }),
  percentage_used: z
    .number()
    .openapi({
      description: "Percentage of the monthly quota consumed, rounded to one decimal place.",
      example: 3.5,
    }),
  by_endpoint: ByEndpointSchema,
  plan: z
    .string()
    .openapi({ description: "Current Google Maps billing plan label.", example: "free_tier" }),
});

const ErrorSchema = z.object({
  error: z.string().openapi({ description: "Human-readable error message." }),
});

// ─── GET /usage ──────────────────────────────────────────────────────────────

adminIntegrationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage",
    operationId: "getAdminIntegrationsUsage",
    tags: ["Admin"],
    summary: "Google Maps quota utilisation for the current calendar month",
    description:
      "Returns the total request count, a per-endpoint breakdown (autocomplete and details " +
      "are always present, defaulted to 0), and the percentage of the Essentials free-tier " +
      "limit consumed. Powers the integrations health panel on the admin dashboard.",
    responses: {
      200: {
        description: "Current-month Google Maps usage summary.",
        content: {
          "application/json": { schema: IntegrationsUsageSchema },
        },
      },
      500: {
        description: "Failed to retrieve usage data.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    try {
      const service = new GoogleMapsService(c.env);
      const { total, byEndpoint, month } = await service.getMonthlyUsage();

      // Ensure the two fixed frontend rows are always present even when zero.
      const by_endpoint = {
        autocomplete: byEndpoint["autocomplete"] ?? 0,
        details: byEndpoint["details"] ?? 0,
        ...byEndpoint,
      };

      const percentage_used = Math.round((total / MAPS_MONTHLY_FREE_TIER_LIMIT) * 1000) / 10;

      return c.json(
        {
          month,
          limit: MAPS_MONTHLY_FREE_TIER_LIMIT,
          total_requests: total,
          percentage_used,
          by_endpoint,
          plan: "free_tier",
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/integrations/usage] error:", message);
      return c.json({ error: `Failed to retrieve usage data: ${message}` }, 500);
    }
  },
);
