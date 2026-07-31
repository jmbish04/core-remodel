/**
 * Shared helpers for the Deep Research bridge tools
 * (get_deep_research_context / record_deep_research_progress / record_deep_research_source).
 *
 * Scope resolution: a research-scoped token carries its own scope; a worker-auth
 * caller must pass sessionId in args (legacy behaviour).
 */
import { and, eq } from "drizzle-orm";

import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import {
  showroomStoreCategory,
  showroomStoreProducts,
  showroomStores,
  storeProductResearch,
  storeResearch,
} from "@backend/db/schema/showroom/index";
import { loadProductPromptContext } from "@backend/ai/agents/ShowroomResearchAgent/methods/prompt-context";
import type { DeepResearchMcpScope } from "@backend/services/gemini/deep-research";

import type { Db, ToolCtx } from "../types";

export function resolveResearchScope(ctx: ToolCtx): DeepResearchMcpScope {
  const scope: DeepResearchMcpScope =
    ctx.auth.kind === "research"
      ? ctx.auth.scope
      : {
          type: "session" as const,
          id: Number(ctx.args.sessionId ?? 0),
          sessionId: Number(ctx.args.sessionId ?? 0),
        };

  if (!scope.id) {
    throw new Error("Research scope is required");
  }
  return scope;
}

export function normalizeSentiment(value: unknown): "good" | "bad" | "neutral" {
  return value === "good" || value === "bad" || value === "neutral" ? value : "neutral";
}

function scopedKey(scope: DeepResearchMcpScope, suffix: string): string {
  return `research-mcp:${scope.type}:${scope.id}:${suffix}`;
}

export async function appendScopedCacheEvent(
  env: Env,
  scope: DeepResearchMcpScope,
  suffix: string,
  event: Record<string, unknown>,
) {
  if (!env.CACHE) return;
  const key = scopedKey(scope, suffix);
  const existing = await env.CACHE.get(key);
  let events: Array<Record<string, unknown>> = [];
  if (existing) {
    try {
      events = JSON.parse(existing) as Array<Record<string, unknown>>;
    } catch {
      events = [];
    }
  }
  events.push({ ...event, at: new Date().toISOString() });
  await env.CACHE.put(key, JSON.stringify(events.slice(-50)), {
    expirationTtl: 6 * 60 * 60,
  });
}

export async function getResearchContext(
  db: Db,
  env: Env,
  scope: DeepResearchMcpScope,
): Promise<string> {
  if (scope.type === "product") {
    const context = await loadProductPromptContext(env, scope.productId ?? scope.id);
    return JSON.stringify(context, null, 2);
  }

  if (scope.type === "store") {
    const [store] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, scope.storeId ?? scope.id))
      .limit(1);
    return JSON.stringify({ store }, null, 2);
  }

  if (scope.type === "category") {
    const [category] = await db
      .select()
      .from(showroomStoreCategory)
      .where(eq(showroomStoreCategory.id, scope.categoryId ?? scope.id))
      .limit(1);
    return JSON.stringify({ category }, null, 2);
  }

  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, scope.sessionId ?? scope.id))
    .limit(1);

  return JSON.stringify({ session }, null, 2);
}

export async function recordResearchSource(
  db: Db,
  env: Env,
  scope: DeepResearchMcpScope,
  args: Record<string, any>,
): Promise<string> {
  const url = String(args.url ?? "").trim();
  if (!url) throw new Error("url is required");
  new URL(url);

  const finding = String(args.finding ?? args.summary ?? args.title ?? url).trim();
  if (!finding) throw new Error("finding, summary, or title is required");

  await appendScopedCacheEvent(env, scope, "sources", {
    url,
    title: args.title ?? null,
    summary: args.summary ?? null,
    finding,
    sentiment: normalizeSentiment(args.sentiment),
  });

  if (scope.type === "product") {
    const productId = scope.productId ?? scope.id;
    const [product] = await db
      .select({ id: showroomStoreProducts.id })
      .from(showroomStoreProducts)
      .where(eq(showroomStoreProducts.id, productId))
      .limit(1);
    if (!product) throw new Error(`Product ${productId} not found`);

    const [existing] = await db
      .select({ id: storeProductResearch.id })
      .from(storeProductResearch)
      .where(
        and(
          eq(storeProductResearch.storeProductId, productId),
          eq(storeProductResearch.finding, finding),
          eq(storeProductResearch.findingUrl, url),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(storeProductResearch).values({
        storeProductId: productId,
        finding,
        findingUrl: url,
        sentiment: normalizeSentiment(args.sentiment),
      });
    }
  }

  if (scope.type === "store") {
    const storeId = scope.storeId ?? scope.id;
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1);
    if (!store) throw new Error(`Store ${storeId} not found`);

    const [existing] = await db
      .select({ id: storeResearch.id })
      .from(storeResearch)
      .where(
        and(
          eq(storeResearch.storeId, storeId),
          eq(storeResearch.finding, finding),
          eq(storeResearch.findingUrl, url),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(storeResearch).values({
        storeId,
        finding,
        findingUrl: url,
        sentiment: normalizeSentiment(args.sentiment),
      });
    }
  }

  return JSON.stringify({ recorded: true, scope, url });
}
