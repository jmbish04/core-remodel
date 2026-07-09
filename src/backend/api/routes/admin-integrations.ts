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
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";

import {
  GoogleMapsService,
  MAPS_MONTHLY_FREE_TIER_LIMIT,
} from "@/backend/services/google/maps";
import { geminiUsage } from "@backend/db/schema";
import { getAiGatewayUsage } from "@backend/services/ai-gateway/analytics";

export const adminIntegrationsRouter = new OpenAPIHono<{ Bindings: Env }>();

/**
 * Start of the current UTC calendar month as a UNIX seconds boundary.
 *
 * `gemini_usage_log.timestamp` is stored in seconds (Drizzle `mode: "timestamp"`
 * + a `(unixepoch())` default), so month-window queries compare against raw
 * seconds via `sql` — the same pattern the google_maps_usage query uses.
 * Passing a JS `Date` here would be ambiguous, so we return the integer directly.
 */
function currentMonthStart(): { startSeconds: number; month: string } {
  const now = new Date();
  const startSeconds = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000,
  );
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { startSeconds, month };
}

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

// ─── GET /gemini ───────────────────────────────────────────────────────────
// Gemini token usage for the current month, from our own gemini_usage_log
// ledger (direct API calls — Gemini bypasses AI Gateway). This is the
// independent, first-party accounting used to reconcile provider billing.

const GeminiFeatureSchema = z.object({
  feature: z.string().openapi({ description: "Calling-surface label.", example: "email_classify" }),
  calls: z.number().int().openapi({ description: "Calls attributed to this feature this month." }),
  totalTokens: z.number().int().openapi({ description: "Total tokens for this feature this month." }),
});

const GeminiUsageSchema = z.object({
  month: z.string().openapi({ description: "Calendar month in 'YYYY-MM' (UTC).", example: "2026-07" }),
  totalCalls: z.number().int().openapi({ description: "Total Gemini calls this month." }),
  okCalls: z.number().int().openapi({ description: "Successful calls." }),
  errorCalls: z.number().int().openapi({ description: "Failed calls." }),
  promptTokens: z.number().int().openapi({ description: "Sum of input/prompt tokens." }),
  candidatesTokens: z.number().int().openapi({ description: "Sum of output tokens." }),
  thoughtsTokens: z.number().int().openapi({ description: "Sum of reasoning tokens." }),
  totalTokens: z.number().int().openapi({ description: "Sum of total tokens." }),
  byFeature: z.array(GeminiFeatureSchema).openapi({ description: "Per-feature breakdown, busiest first." }),
});

adminIntegrationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/gemini",
    operationId: "getAdminIntegrationsGeminiUsage",
    tags: ["Admin"],
    summary: "Gemini token usage for the current calendar month",
    description:
      "Aggregates gemini_usage_log (our first-party ledger of direct Gemini API calls) for the " +
      "current UTC month: call counts, success/error split, token sums, and a per-feature breakdown.",
    responses: {
      200: {
        description: "Current-month Gemini usage summary.",
        content: { "application/json": { schema: GeminiUsageSchema } },
      },
      500: {
        description: "Failed to retrieve Gemini usage.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    try {
      const db = drizzle(c.env.DB);
      const { startSeconds, month } = currentMonthStart();

      const [totals] = await db
        .select({
          totalCalls: sql<number>`count(*)`,
          okCalls: sql<number>`coalesce(sum(case when ${geminiUsage.status} = 'ok' then 1 else 0 end), 0)`,
          errorCalls: sql<number>`coalesce(sum(case when ${geminiUsage.status} = 'error' then 1 else 0 end), 0)`,
          promptTokens: sql<number>`coalesce(sum(${geminiUsage.promptTokens}), 0)`,
          candidatesTokens: sql<number>`coalesce(sum(${geminiUsage.candidatesTokens}), 0)`,
          thoughtsTokens: sql<number>`coalesce(sum(${geminiUsage.thoughtsTokens}), 0)`,
          totalTokens: sql<number>`coalesce(sum(${geminiUsage.totalTokens}), 0)`,
        })
        .from(geminiUsage)
        .where(sql`${geminiUsage.timestamp} >= ${startSeconds}`);

      const byFeature = await db
        .select({
          feature: geminiUsage.feature,
          calls: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(${geminiUsage.totalTokens}), 0)`,
        })
        .from(geminiUsage)
        .where(sql`${geminiUsage.timestamp} >= ${startSeconds}`)
        .groupBy(geminiUsage.feature)
        .orderBy(sql`count(*) desc`);

      return c.json(
        {
          month,
          totalCalls: Number(totals?.totalCalls ?? 0),
          okCalls: Number(totals?.okCalls ?? 0),
          errorCalls: Number(totals?.errorCalls ?? 0),
          promptTokens: Number(totals?.promptTokens ?? 0),
          candidatesTokens: Number(totals?.candidatesTokens ?? 0),
          thoughtsTokens: Number(totals?.thoughtsTokens ?? 0),
          totalTokens: Number(totals?.totalTokens ?? 0),
          byFeature: byFeature.map((r) => ({
            feature: r.feature,
            calls: Number(r.calls),
            totalTokens: Number(r.totalTokens),
          })),
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/integrations/gemini] error:", message);
      return c.json({ error: `Failed to retrieve Gemini usage: ${message}` }, 500);
    }
  },
);

// ─── GET /ai-gateway ─────────────────────────────────────────────────────────
// AI Gateway request analytics for everything routed THROUGH the gateway
// (Workers AI, Replicate, Fal, …). Best-effort: `available: false` + `reason`
// when the Analytics API is unreachable / unauthorized (never 500s the panel).

const AiGatewayModelSchema = z.object({
  model: z.string(),
  provider: z.string().nullable(),
  requests: z.number().int(),
});

const AiGatewayUsageSchema = z.object({
  available: z.boolean().openapi({ description: "False when analytics could not be read." }),
  reason: z.string().optional().openapi({ description: "Why analytics is unavailable / partial." }),
  gatewayId: z.string().openapi({ description: "The AI Gateway id queried.", example: "default-gateway" }),
  month: z.string().openapi({ description: "Calendar month in 'YYYY-MM' (UTC)." }),
  totalRequests: z.number().int(),
  cachedRequests: z.number().int(),
  erroredRequests: z.number().int(),
  byModel: z.array(AiGatewayModelSchema).openapi({ description: "Per-model request counts, busiest first." }),
});

adminIntegrationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/ai-gateway",
    operationId: "getAdminIntegrationsAiGatewayUsage",
    tags: ["Admin"],
    summary: "AI Gateway request analytics for the current calendar month",
    description:
      "Request-level analytics for the account's AI Gateway (Workers AI, Replicate, Fal, etc.) via " +
      "the Cloudflare GraphQL Analytics API. Best-effort — returns available=false with a reason " +
      "when the analytics token is missing or lacks permission, so the panel degrades gracefully.",
    responses: {
      200: {
        description: "Current-month AI Gateway usage (or an unavailable marker).",
        content: { "application/json": { schema: AiGatewayUsageSchema } },
      },
    },
  }),
  async (c) => {
    const usage = await getAiGatewayUsage(c.env);
    return c.json(usage, 200);
  },
);
