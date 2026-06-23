/**
 * @fileoverview Autonomous monitor for showroom sourcing coverage.
 *
 * The static `* * * * *` cron invokes this service from `src/_worker.ts`.
 * It scans existing D1 category coverage and dispatches the
 * ShowroomResearchAgent by native RPC when a category is under-covered or all
 * currently mapped showrooms have active homeowner rejection ratings.
 */

import { getAgentByName } from "agents";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  showroomStoreCategory,
  showroomStoreCategoryMapping,
  showroomStores,
  storeRating,
} from "@backend/db/schema/showroom/index";
import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";

const THROTTLE_SECONDS = 60 * 60 * 24;
const MAX_AUTOMATIC_SWEEPS_PER_TICK = 1;

type CategoryCoverage = {
  mappedStoreIds: Set<number>;
  rejectedStoreIds: Set<number>;
  negativeConstraints: string[];
};

function normalizeConstraint(note: string | null): string | null {
  const text = note?.trim();
  if (!text) return null;
  return `Homeowner rejected a mapped showroom with this reason: ${text}`;
}

async function wasRecentlySwept(env: Env, categoryId: number): Promise<boolean> {
  if (!env.CACHE) return false;
  const value = await env.CACHE.get(`showroom-sourcing-monitor:${categoryId}`);
  return Boolean(value);
}

async function markSwept(env: Env, categoryId: number) {
  if (!env.CACHE) return;
  await env.CACHE.put(
    `showroom-sourcing-monitor:${categoryId}`,
    new Date().toISOString(),
    { expirationTtl: THROTTLE_SECONDS },
  );
}

function analyzeCoverage(
  rows: Array<{
    storeId: number;
    rating: number | null;
    ratingNotes: string | null;
  }>,
): CategoryCoverage {
  const coverage: CategoryCoverage = {
    mappedStoreIds: new Set<number>(),
    rejectedStoreIds: new Set<number>(),
    negativeConstraints: [],
  };

  for (const row of rows) {
    coverage.mappedStoreIds.add(row.storeId);
    if ((row.rating ?? 5) <= 1) {
      coverage.rejectedStoreIds.add(row.storeId);
      const constraint = normalizeConstraint(row.ratingNotes);
      if (constraint) coverage.negativeConstraints.push(constraint);
    }
  }

  return coverage;
}

/**
 * CACHE (KV) key that opts the cron into plan-gating. When set to "true", the
 * autonomous monitor drafts a research plan for homeowner approval (a pending
 * sourcing_sweep_session) instead of running the category sweep immediately.
 * Toggle at runtime via KV — no redeploy. Absent/anything-else = legacy behavior.
 */
const CRON_PLAN_GATE_KEY = "sourcing:cron_plan_gate";

export async function monitorShowroomSourcingCoverage(env: Env): Promise<{
  checkedCategories: number;
  triggeredSweeps: number;
  queuedPlans: number;
}> {
  const db = drizzle(env.DB);
  const planGate = (await env.CACHE?.get(CRON_PLAN_GATE_KEY)) === "true";
  const categories = await db
    .select()
    .from(showroomStoreCategory)
    .where(eq(showroomStoreCategory.isActive, true));

  let triggeredSweeps = 0;
  let queuedPlans = 0;

  for (const category of categories) {
    if (triggeredSweeps + queuedPlans >= MAX_AUTOMATIC_SWEEPS_PER_TICK) break;
    if (await wasRecentlySwept(env, category.id)) continue;

    const rows = await db
      .select({
        storeId: showroomStores.id,
        rating: storeRating.rating,
        ratingNotes: storeRating.ratingNotes,
      })
      .from(showroomStoreCategoryMapping)
      .innerJoin(
        showroomStores,
        eq(showroomStoreCategoryMapping.storeId, showroomStores.id),
      )
      .leftJoin(
        storeRating,
        and(
          eq(storeRating.storeId, showroomStores.id),
          eq(storeRating.isActive, true),
        ),
      )
      .where(eq(showroomStoreCategoryMapping.categoryId, category.id));

    const coverage = analyzeCoverage(rows);
    const mappedCount = coverage.mappedStoreIds.size;
    const allMappedRejected =
      mappedCount > 0 && coverage.rejectedStoreIds.size === mappedCount;

    if (mappedCount > 1 && !allMappedRejected) continue;

    const agent = await getAgentByName<Env, ShowroomResearchAgent>(
      env.SHOWROOM_RESEARCH_AGENT as any,
      "showroom-research",
    );

    const prompt = `Autonomous sourcing sweep for category coverage.

Category: ${category.name}
Description: ${category.description ?? "none"}
Mapped showroom count: ${mappedCount}
All mapped showrooms rejected by homeowner: ${allMappedRejected ? "yes" : "no"}

Use the negative constraints to avoid repeating showroom traits the homeowner rejected. Find better cited sources and candidate vendors for this category.`;

    if (planGate) {
      // Draft a plan for homeowner approval instead of auto-sweeping. The pending
      // sourcing_sweep_session surfaces in the console for review/approval.
      const constraintBlock =
        coverage.negativeConstraints.length > 0
          ? `\n\nNegative constraints:\n${coverage.negativeConstraints.map((c) => `- ${c}`).join("\n")}`
          : "";
      await agent.discoverSweepPlan({
        targetType: "category",
        targetId: category.id,
        prompt: `${prompt}${constraintBlock}`,
        maxSources: 3,
        researchMode: "deep",
        negativeConstraints: coverage.negativeConstraints,
      });
      queuedPlans += 1;
    } else {
      await agent.deepSweepCategory({
        categoryId: category.id,
        prompt,
        maxSources: 3,
        negativeConstraints: coverage.negativeConstraints,
        triggerSource: allMappedRejected
          ? "cron-rejection-loop"
          : "cron-category-gap",
      });
      triggeredSweeps += 1;
    }

    await markSwept(env, category.id);
  }

  return { checkedCategories: categories.length, triggeredSweeps, queuedPlans };
}
