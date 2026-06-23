/**
 * @fileoverview Showroom sweep plan-review (Phase 2) — gates (a)+(b)+(c).
 *
 * Gives a showroom deep-sweep a durable `sourcing_sweep_sessions` row so a
 * research PLAN can be drafted, annotated by the onboard agent, reviewed by the
 * homeowner, and only then run. Flow:
 *
 *   discoverSweepPlan -> createSweepSession (status: planning)
 *                     -> draftSweepPlan (gate a + b) -> awaiting_plan_approval
 *   approveSweepPlan  -> runApprovedSweep (sweeping -> complete)
 *   reviseSweepPlan   -> draftSweepPlan again with feedback (gate c loop)
 *
 * Design note: on approval the run reuses the EXISTING extraction sweep
 * (`deepSweep*`) in quick citation-discovery mode, with the approved plan
 * markdown as the reviewed prompt. This keeps 100% of the image/spec/finding/
 * vector pipeline and avoids a second long deep-research run after the plan
 * interaction already produced the plan. (Deep citation discovery on approval —
 * reusing the plan interaction's report — is a documented follow-up.)
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  sourcingPlanRevisions,
  sourcingSweepSessions,
  type SourcingSweepSession,
} from "@backend/db/schema/showroom/index";
import {
  continueDeepResearchPlan,
  draftDeepResearchPlan,
  extractCitationUrlsFromInteraction,
  pollDeepResearchInteraction,
} from "@backend/services/gemini/deep-research";
import { annotatePlan } from "@backend/ai/plan-review/annotate-plan";
import { loadProductPromptContext, generateProductDraftPrompt } from "./prompt-context";
import {
  deepSweepCategory as runDeepSweepCategory,
  deepSweepProduct as runDeepSweepProduct,
  deepSweepStore as runDeepSweepStore,
} from "./deep-sweep";

export interface DiscoverSweepPlanInput {
  targetType: "product" | "store" | "category";
  targetId: number;
  prompt?: string;
  maxSources?: number;
  researchMode?: "quick" | "deep";
  enableMcpBridge?: boolean;
  negativeConstraints?: string[];
  mcpServerUrl?: string | null;
}

type ProgressFn = (message: string, progress?: number) => void;

function targetLabel(session: Pick<SourcingSweepSession, "targetType" | "targetId">): string {
  return `${session.targetType} #${session.targetId}`;
}

/** Create the sweep session row up front so the route can return an id to poll. */
export async function createSweepSession(env: Env, input: DiscoverSweepPlanInput): Promise<number> {
  const db = drizzle(env.DB);
  const [row] = await db
    .insert(sourcingSweepSessions)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      prompt: input.prompt?.trim() || null,
      researchMode: input.researchMode ?? "deep",
      maxSources: input.maxSources ?? null,
      enableMcpBridge: input.enableMcpBridge ?? false,
      status: "planning",
      planStatus: "drafting",
    })
    .returning();
  return row.id;
}

/** Build the base research brief that seeds the plan for this target. */
async function buildBrief(
  env: Env,
  session: SourcingSweepSession,
  negativeConstraints: string[],
): Promise<string> {
  const explicit = session.prompt?.trim();
  if (explicit) return explicit;

  if (session.targetType === "product") {
    // Reuse the existing Workers-AI draft-prompt builder for products.
    return generateProductDraftPrompt(env, session.targetId, negativeConstraints);
  }

  const kind = session.targetType === "store" ? "showroom" : "showroom category";
  const constraintBlock =
    negativeConstraints.length > 0
      ? `\n\nAvoid repeating these prior homeowner rejections:\n${negativeConstraints.map((c) => `- ${c}`).join("\n")}`
      : "";
  return `Plan deep-research sourcing for ${kind} #${session.targetId} as part of a high-end San Francisco home renovation. Identify reputation, reliability, pricing posture, return/delivery policy, standout inventory, and current storefront imagery worth capturing.${constraintBlock}`;
}

/** Gather negative constraints for the target (reused by the brief + annotation). */
async function negativeConstraintsFor(
  env: Env,
  session: SourcingSweepSession,
): Promise<string[]> {
  if (session.targetType === "product") {
    try {
      const ctx = await loadProductPromptContext(env, session.targetId);
      return ctx.negativeConstraints ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

const PLAN_TOOLS: Array<Record<string, unknown>> = [
  { type: "google_search" },
  { type: "url_context" },
  { type: "code_execution" },
];

/**
 * Draft (or re-draft with feedback) a plan, annotate it, and pause at
 * `awaiting_plan_approval`. Runs in the agent's background (waitUntil).
 */
export async function draftSweepPlan(
  env: Env,
  sessionId: number,
  opts: { feedback?: string; onProgress?: ProgressFn } = {},
): Promise<void> {
  const db = drizzle(env.DB);
  const report = opts.onProgress ?? (() => {});

  try {
    const [session] = await db
      .select()
      .from(sourcingSweepSessions)
      .where(eq(sourcingSweepSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Error(`Sweep session ${sessionId} not found`);

    report(opts.feedback ? "Revising the research plan..." : "Drafting a research plan...");
    await db
      .update(sourcingSweepSessions)
      .set({ status: "planning", planStatus: "drafting" })
      .where(eq(sourcingSweepSessions.id, sessionId));

    const negativeConstraints = await negativeConstraintsFor(env, session);
    const brief = await buildBrief(env, session, negativeConstraints);

    let planMarkdown = brief;
    let planInteractionId: string | null = session.planInteractionId ?? null;

    if (session.researchMode === "deep") {
      // Gate (a): Gemini collaborative planning produces a reviewable plan.
      const planPrompt = opts.feedback
        ? `Please revise the sourcing research plan using this homeowner feedback before proceeding: ${opts.feedback}\n\nOriginal brief:\n${brief}`
        : brief;
      const plan = await draftDeepResearchPlan(
        env,
        {
          prompt: planPrompt,
          mode: "standard",
          tools: PLAN_TOOLS,
          previousInteractionId: opts.feedback ? session.planInteractionId ?? undefined : undefined,
        },
        { onStatus: () => report("Gemini is drafting the research plan...") },
      );
      planMarkdown = plan.planMarkdown ?? brief;
      planInteractionId = plan.interactionId || planInteractionId;
    } else if (opts.feedback) {
      // Quick mode revision: fold the feedback into the brief directly.
      planMarkdown = `${brief}\n\nHomeowner feedback to incorporate:\n${opts.feedback}`;
    }

    // Gate (b): onboard agent annotates the plan before the homeowner sees it.
    report("Reviewing the plan...");
    await db
      .update(sourcingSweepSessions)
      .set({ planStatus: "annotating", planMarkdown, planInteractionId })
      .where(eq(sourcingSweepSessions.id, sessionId));

    const annotations = await annotatePlan(env, {
      planMarkdown,
      topic: targetLabel(session),
      priorRejections: negativeConstraints,
    });
    const annotationsJson = JSON.stringify(annotations);

    await db.insert(sourcingPlanRevisions).values({
      sweepSessionId: sessionId,
      revision: session.planRevision ?? 0,
      planMarkdown,
      planAnnotations: annotationsJson,
      homeownerFeedback: opts.feedback ?? null,
    });

    await db
      .update(sourcingSweepSessions)
      .set({
        status: "awaiting_plan_approval",
        planStatus: "awaiting_approval",
        planAnnotations: annotationsJson,
      })
      .where(eq(sourcingSweepSessions.id, sessionId));

    report("Plan ready for your review.");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourcingSweepSessions)
      .set({ status: "failed", errorMessage })
      .where(eq(sourcingSweepSessions.id, sessionId));
  }
}

/**
 * Run the approved plan: dispatch the existing extraction sweep with the
 * approved plan markdown as the reviewed prompt, then persist the result.
 */
export async function runApprovedSweep(
  env: Env,
  sessionId: number,
  onProgress?: ProgressFn,
): Promise<void> {
  const db = drizzle(env.DB);
  const report = onProgress ?? (() => {});

  const [session] = await db
    .select()
    .from(sourcingSweepSessions)
    .where(eq(sourcingSweepSessions.id, sessionId))
    .limit(1);
  if (!session) return;

  try {
    const prompt = session.planMarkdown ?? session.prompt ?? undefined;
    const maxSources = session.maxSources ?? undefined;
    const enableMcpBridge = session.enableMcpBridge ?? false;

    // Deep-citation on approval: if a deep plan interaction exists, RELEASE it
    // (continue the collaborative interaction → the approved deep research now
    // runs to completion) and seed the citations it found into the extraction
    // sweep, so the approved deep research is used rather than re-run.
    let seedCitationUrls: string[] = [];
    if (session.researchMode === "deep" && session.planInteractionId) {
      try {
        report("Running the approved deep research…");
        const interaction = await continueDeepResearchPlan(
          env,
          session.planInteractionId,
          { kind: "approve" },
        );
        const completed = await pollDeepResearchInteraction(env, interaction.id, {
          onStatus: () => report("Approved deep research in progress…"),
        });
        seedCitationUrls = extractCitationUrlsFromInteraction(completed.interaction);
        report(`Approved research surfaced ${seedCitationUrls.length} citations; extracting…`);
      } catch (error) {
        // Non-fatal: fall back to quick citation discovery on the approved plan,
        // but surface the cause so API failures/timeouts are diagnosable.
        const details = error instanceof Error ? error.message : String(error);
        console.error(`Approved deep research failed for sweep session ${sessionId}:`, error);
        report(`Deep research run unavailable (${details}); falling back to quick citation discovery.`);
      }
    }

    const common = {
      prompt,
      maxSources,
      // Quick citation discovery runs the full extraction pipeline; when a deep
      // run was released above, its citations seed discovery so they are reused.
      researchMode: "quick" as const,
      enableMcpBridge,
      triggerSource: "manual" as const,
      seedCitationUrls: seedCitationUrls.length > 0 ? seedCitationUrls : undefined,
    };

    const result =
      session.targetType === "product"
        ? await runDeepSweepProduct(env, { productId: session.targetId, ...common }, report)
        : session.targetType === "store"
          ? await runDeepSweepStore(env, { storeId: session.targetId, ...common }, report)
          : await runDeepSweepCategory(env, { categoryId: session.targetId, ...common }, report);

    await db
      .update(sourcingSweepSessions)
      .set({
        status: result.success ? "complete" : "failed",
        resultJson: JSON.stringify(result),
        errorMessage: result.success ? null : result.warnings.join(" · ") || "Sweep failed",
        completedAt: new Date(),
      })
      .where(eq(sourcingSweepSessions.id, sessionId));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(sourcingSweepSessions)
      .set({ status: "failed", errorMessage, completedAt: new Date() })
      .where(eq(sourcingSweepSessions.id, sessionId));
  }
}
