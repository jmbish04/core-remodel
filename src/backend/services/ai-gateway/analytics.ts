/**
 * @fileoverview Cloudflare AI Gateway usage analytics.
 *
 * Reads request-level analytics for the account's AI Gateway (the
 * `AI_GATEWAY_ID` var) from the Cloudflare GraphQL Analytics API. This covers
 * every provider we route THROUGH the gateway — Workers AI, Replicate, Fal,
 * etc. (Gemini is intentionally NOT here: the Gemini interactions API bypasses
 * the gateway and is metered independently in `gemini_usage_log`.)
 *
 * Best-effort by design: the GraphQL query requires an API token with
 * `Account Analytics: Read`, and the exact AdaptiveGroups dimension names can
 * vary. Any failure (missing token, 401, schema mismatch) is caught and
 * surfaced as `{ available: false, reason }` so the usage page degrades to an
 * informative panel instead of erroring. The real error text is returned in
 * `reason` so it can be shown to the operator and acted on.
 */

import { getCloudflareAccountId } from "../../utils/secrets";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** Per-model request rollup within the gateway for the period. */
export interface AiGatewayModelUsage {
  model: string;
  provider: string | null;
  requests: number;
}

/** Structured AI Gateway usage for the current month (or an unavailable marker). */
export interface AiGatewayUsage {
  available: boolean;
  /** Populated when `available` is false — the reason (missing token, error text). */
  reason?: string;
  gatewayId: string;
  /** 'YYYY-MM' (UTC). */
  month: string;
  totalRequests: number;
  cachedRequests: number;
  erroredRequests: number;
  byModel: AiGatewayModelUsage[];
}

/** Resolve the Cloudflare API token used for the Analytics GraphQL call. */
async function getAnalyticsToken(env: Env): Promise<string | null> {
  try {
    const token = await env.CLOUDFLARE_WRANGLER_API_TOKEN.get();
    return token || null;
  } catch {
    return null;
  }
}

/** POST a GraphQL query; throws with the first error message on any failure. */
async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as {
    data?: any;
    errors?: Array<{ message: string }>;
  };

  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}`);
  }
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data;
}

/**
 * The primary query — request counts grouped by model + provider + cache/error
 * dimensions. `aiGatewayRequestsAdaptiveGroups` is the AI Gateway analytics
 * dataset under `viewer.accounts`.
 */
const RICH_QUERY = `query GatewayUsage($accountTag: string!, $gateway: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      aiGatewayRequestsAdaptiveGroups(
        filter: { gateway: $gateway, datetime_geq: $start, datetime_leq: $end }
        limit: 1000
        orderBy: [count_DESC]
      ) {
        count
        dimensions { model provider cacheStatus success }
      }
    }
  }
}`;

/** Fallback query — total request count only, if the rich dimensions error. */
const TOTAL_QUERY = `query GatewayTotal($accountTag: string!, $gateway: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      aiGatewayRequestsAdaptiveGroups(
        filter: { gateway: $gateway, datetime_geq: $start, datetime_leq: $end }
        limit: 1
      ) {
        count
      }
    }
  }
}`;

/**
 * Fetch AI Gateway usage for the current UTC calendar month.
 *
 * Never throws — returns an {@link AiGatewayUsage} with `available: false` and
 * a human-readable `reason` on any failure so callers can render a fallback.
 */
export async function getAiGatewayUsage(env: Env): Promise<AiGatewayUsage> {
  const gatewayId = env.AI_GATEWAY_ID;
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = now.toISOString();

  const base: AiGatewayUsage = {
    available: false,
    gatewayId,
    month,
    totalRequests: 0,
    cachedRequests: 0,
    erroredRequests: 0,
    byModel: [],
  };

  const [accountTag, token] = await Promise.all([
    getCloudflareAccountId(env),
    getAnalyticsToken(env),
  ]);

  if (!accountTag) return { ...base, reason: "CLOUDFLARE_ACCOUNT_ID is not configured" };
  if (!token) return { ...base, reason: "No Cloudflare API token available for analytics" };

  const variables = { accountTag, gateway: gatewayId, start, end };

  // Attempt the rich, dimensioned query first.
  try {
    const data = await graphql(token, RICH_QUERY, variables);
    const groups: Array<{
      count: number;
      dimensions: {
        model?: string;
        provider?: string;
        cacheStatus?: string;
        success?: string | boolean;
      };
    }> = data?.viewer?.accounts?.[0]?.aiGatewayRequestsAdaptiveGroups ?? [];

    const byModelMap = new Map<string, AiGatewayModelUsage>();
    let totalRequests = 0;
    let cachedRequests = 0;
    let erroredRequests = 0;

    for (const g of groups) {
      const count = Number(g.count) || 0;
      totalRequests += count;

      const cs = String(g.dimensions?.cacheStatus ?? "").toLowerCase();
      if (cs === "hit" || cs === "cached") cachedRequests += count;

      const success = g.dimensions?.success;
      if (success === false || success === "false") erroredRequests += count;

      const model = g.dimensions?.model || "unknown";
      const provider = g.dimensions?.provider ?? null;
      const key = `${provider ?? ""}:${model}`;
      const existing = byModelMap.get(key);
      if (existing) existing.requests += count;
      else byModelMap.set(key, { model, provider, requests: count });
    }

    return {
      available: true,
      gatewayId,
      month,
      totalRequests,
      cachedRequests,
      erroredRequests,
      byModel: [...byModelMap.values()].sort((a, b) => b.requests - a.requests),
    };
  } catch (richErr) {
    // Rich dimensions may not match the current schema — fall back to a bare
    // total so the page can still show gateway request volume.
    try {
      const data = await graphql(token, TOTAL_QUERY, variables);
      const groups: Array<{ count: number }> =
        data?.viewer?.accounts?.[0]?.aiGatewayRequestsAdaptiveGroups ?? [];
      const totalRequests = groups.reduce((sum, g) => sum + (Number(g.count) || 0), 0);
      return {
        available: true,
        gatewayId,
        month,
        totalRequests,
        cachedRequests: 0,
        erroredRequests: 0,
        byModel: [],
        reason: `Per-model breakdown unavailable: ${String(richErr).slice(0, 200)}`,
      };
    } catch (totalErr) {
      return { ...base, reason: String(totalErr).slice(0, 300) };
    }
  }
}
