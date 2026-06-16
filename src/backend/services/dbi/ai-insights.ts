/**
 * Per-contractor AI busyness analysis (SPEC Phase 6).
 *
 * Splits a contractor's gathered permits into work filed BEFORE vs AFTER the
 * 126 Colby filing date and asks Workers AI to judge how busy they are on each
 * side — so we can reason about whether a contractor is tied up with prior
 * commitments or newly-taken work. High-confidence matches are weighted; loosely
 * matched permits are surfaced separately so a fuzzy hit can't overstate load.
 *
 * The prompt is built as an ES6 template literal (real newlines) — never
 * `Array.join("\n")` — so it survives the AI Gateway transport intact.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { permitsContactInsights } from "@backend/db";
import { isObject, normalizeText, parseDate } from "./soda";
import type { GatheredPermit, MonitoredContractor } from "./contractor-sync";

export type Busyness = "idle" | "light" | "busy";

export type ContractorInsight = {
  riskLevel: "low" | "medium" | "high";
  beforeBusyness: Busyness;
  afterBusyness: Busyness;
  summary: string;
  highlights: string[];
};

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

type SideMetrics = {
  total: number;
  open: number;
  recentlyClosed: number;
  highConfidence: number;
  lowConfidence: number;
  mostRecentActivityDate: string | null;
  daysSinceActivity: number | null;
};

function daysBetween(iso: string | null, now: Date): number | null {
  const date = parseDate(iso);
  if (!date) return null;
  return Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** Aggregate one side (before / after) of a contractor's permits. */
function summarizeSide(permits: GatheredPermit[], now: Date): SideMetrics {
  let mostRecent: string | null = null;
  for (const permit of permits) {
    const date = permit.recentActivity.recentActivityDate;
    if (date && (!mostRecent || parseDate(date)!.getTime() > parseDate(mostRecent)!.getTime())) {
      mostRecent = date;
    }
  }
  return {
    total: permits.length,
    open: permits.filter((p) => p.isOpen).length,
    recentlyClosed: permits.filter((p) => p.isRecentlyClosed).length,
    highConfidence: permits.filter((p) => p.matchConfidence === "high").length,
    lowConfidence: permits.filter((p) => p.matchConfidence === "low").length,
    mostRecentActivityDate: mostRecent,
    daysSinceActivity: daysBetween(mostRecent, now),
  };
}

/** Deterministic busyness fallback (also the floor the AI result is sanity-checked against). */
function classifyBusyness(side: SideMetrics): Busyness {
  const activeRecent = side.daysSinceActivity !== null && side.daysSinceActivity <= 120;
  if (side.open === 0 && !activeRecent) return "idle";
  if (side.open >= 3 || (side.open >= 1 && side.daysSinceActivity !== null && side.daysSinceActivity <= 60)) {
    return "busy";
  }
  return "light";
}

function coerceBusyness(value: unknown, fallback: Busyness): Busyness {
  const normalized = typeof value === "string" ? normalizeText(value) : "";
  return normalized === "idle" || normalized === "light" || normalized === "busy"
    ? (normalized as Busyness)
    : fallback;
}

function describeSide(label: string, side: SideMetrics): string {
  const recency =
    side.daysSinceActivity === null
      ? "no detected activity"
      : `most recent activity ${side.daysSinceActivity} days ago`;
  return `${label}: ${side.total} permits (${side.open} open, ${side.recentlyClosed} recently closed), ${recency}; ${side.highConfidence} strong matches, ${side.lowConfidence} loose matches`;
}

/**
 * Generate the busyness insight via Workers AI, falling back to the heuristic on
 * any error or unparseable response.
 */
async function generateInsight(
  env: Env,
  contractorName: string,
  before: SideMetrics,
  after: SideMetrics,
): Promise<ContractorInsight> {
  const beforeFallback = classifyBusyness(before);
  const afterFallback = classifyBusyness(after);

  const prompt = `You are analyzing how busy the contractor "${contractorName}" is on other San Francisco permits, relative to a homeowner's project at 126 Colby Street.

Permits are split by when they were filed relative to the homeowner's permit:

${describeSide("BEFORE the homeowner filed", before)}
${describeSide("AFTER the homeowner filed", after)}

"open" permits are still active. "recently closed" permits closed after the homeowner filed. "Strong matches" are tied to the contractor by license; "loose matches" are name/address fuzzy matches — weight them less.

Judge how busy the contractor is on each side. Return STRICT JSON only:
{"beforeBusyness":"idle|light|busy","afterBusyness":"idle|light|busy","summary":"one or two sentences","highlights":["2-4 short bullet strings"]}

Guidance: "busy" = multiple open permits or very recent activity; "light" = some activity; "idle" = no open permits and no recent activity. If a side is mostly loose matches, lean lower and say so.`;

  try {
    const response = await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You output concise JSON only. beforeBusyness and afterBusyness must each be one of idle, light, busy. highlights must be an array of 2-4 short strings.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 600,
    });

    const rawText =
      isObject(response) && typeof response.response === "string"
        ? response.response
        : JSON.stringify(response);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : null;

    if (parsed) {
      const beforeBusyness = coerceBusyness(parsed.beforeBusyness, beforeFallback);
      const afterBusyness = coerceBusyness(parsed.afterBusyness, afterFallback);
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : buildFallbackSummary(contractorName, beforeBusyness, afterBusyness);
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 4)
        : [];
      return {
        riskLevel: deriveRisk(beforeBusyness, afterBusyness),
        beforeBusyness,
        afterBusyness,
        summary,
        highlights: highlights.length > 0 ? highlights : defaultHighlights(before, after),
      };
    }
  } catch {
    // fall through to heuristic
  }

  return {
    riskLevel: deriveRisk(beforeFallback, afterFallback),
    beforeBusyness: beforeFallback,
    afterBusyness: afterFallback,
    summary: buildFallbackSummary(contractorName, beforeFallback, afterFallback),
    highlights: defaultHighlights(before, after),
  };
}

function deriveRisk(before: Busyness, after: Busyness): "low" | "medium" | "high" {
  const score = (value: Busyness) => (value === "busy" ? 2 : value === "light" ? 1 : 0);
  const total = score(before) + score(after);
  return total >= 3 ? "high" : total >= 1 ? "medium" : "low";
}

function buildFallbackSummary(name: string, before: Busyness, after: Busyness): string {
  return `${name} appears ${before} on work predating 126 Colby and ${after} on work taken on since.`;
}

function defaultHighlights(before: SideMetrics, after: SideMetrics): string[] {
  return [
    `${before.open} open permit(s) filed before 126 Colby` +
      (before.daysSinceActivity !== null ? `, last active ${before.daysSinceActivity} days ago.` : "."),
    `${after.open} open permit(s) filed after 126 Colby` +
      (after.daysSinceActivity !== null ? `, last active ${after.daysSinceActivity} days ago.` : "."),
  ];
}

/**
 * Compute + persist the busyness insight for one contractor. Returns the insight
 * so callers can include it in an API response without a re-read.
 */
export async function generateContractorInsight(
  env: Env,
  contractor: MonitoredContractor,
  permits: GatheredPermit[],
  runId: string,
): Promise<ContractorInsight> {
  const now = new Date();
  const before = summarizeSide(
    permits.filter((p) => p.relationToAnchor === "before"),
    now,
  );
  const after = summarizeSide(
    permits.filter((p) => p.relationToAnchor === "after" || p.relationToAnchor === "concurrent"),
    now,
  );

  const insight = await generateInsight(env, contractor.contactName, before, after);

  const db = drizzle(env.DB);
  const existing = await db
    .select()
    .from(permitsContactInsights)
    .where(eq(permitsContactInsights.contactName, contractor.contactName))
    .get();

  await db
    .insert(permitsContactInsights)
    .values({
      id: existing?.id ?? crypto.randomUUID(),
      contactName: contractor.contactName,
      riskLevel: insight.riskLevel,
      beforeBusyness: insight.beforeBusyness,
      afterBusyness: insight.afterBusyness,
      summary: insight.summary,
      highlights: JSON.stringify(insight.highlights),
      metrics: JSON.stringify({ before, after }),
      model: AI_MODEL,
      lastRunId: runId,
      datetimeCreated: existing?.datetimeCreated ?? now,
      datetimeUpdated: now,
    })
    .onConflictDoUpdate({
      target: permitsContactInsights.contactName,
      set: {
        riskLevel: insight.riskLevel,
        beforeBusyness: insight.beforeBusyness,
        afterBusyness: insight.afterBusyness,
        summary: insight.summary,
        highlights: JSON.stringify(insight.highlights),
        metrics: JSON.stringify({ before, after }),
        model: AI_MODEL,
        lastRunId: runId,
        datetimeUpdated: now,
      },
    })
    .run();

  return insight;
}
