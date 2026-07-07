/**
 * @fileoverview Research-job recorder — the single write path for the
 * `research_jobs` / `research_job_steps` tables that back the research console
 * (/admin/shopping/research) and the per-job live viewport.
 *
 * Every research launcher (BrandResearchWorkflow, ProductResearchWorkflow,
 * DeepResearchJobWorkflow, the showroom deep-sweep) records through this
 * module so the console renders one uniform timeline regardless of engine:
 *
 *   const jobId = await createResearchJob(env, { kind: "brand", ... });
 *   await beginStep(env, jobId, "deep-research", "Running deep research", 2);
 *   await completeStep(env, jobId, "deep-research", { detail: "...", artifact });
 *   ...
 *   await completeJob(env, jobId, { report, sources });
 *
 * Idempotency: steps upsert on the (jobId, stepKey) unique index, so a
 * Cloudflare Workflow retry that re-runs a step simply refreshes the same row
 * — the timeline never duplicates. Progress = completedSteps / totalSteps.
 *
 * EVERY function here is best-effort and never throws: research must keep
 * running even if telemetry writes hiccup. Failures log to console.error.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";

import {
  researchJobs,
  researchJobSteps,
  type ResearchJob,
  type ResearchJobInsert,
} from "@backend/db/schema/research/index";

/** Args for creating a job row. `totalSteps` drives the progress estimate. */
export interface CreateResearchJobArgs {
  kind: ResearchJob["kind"];
  title: string;
  topic?: string | null;
  criteria?: string | null;
  entityType?: "showroom" | "brand" | "product" | null;
  entityId?: number | null;
  totalSteps: number;
  workflowInstanceId?: string | null;
}

/** Create a job row (status "pending"). Returns the new job id, or null on failure. */
export async function createResearchJob(
  env: Env,
  args: CreateResearchJobArgs,
): Promise<number | null> {
  try {
    const db = drizzle(env.DB);
    const [row] = await db
      .insert(researchJobs)
      .values({
        kind: args.kind,
        title: args.title,
        topic: args.topic ?? null,
        criteria: args.criteria ?? null,
        entityType: args.entityType ?? null,
        entityId: args.entityId ?? null,
        totalSteps: Math.max(1, args.totalSteps),
        workflowInstanceId: args.workflowInstanceId ?? null,
      } as ResearchJobInsert)
      .returning({ id: researchJobs.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[research-jobs] createResearchJob failed:", err);
    return null;
  }
}

/** Patch job columns (status, narration, artifacts). Never throws. */
export async function updateJob(
  env: Env,
  jobId: number | null | undefined,
  patch: Partial<{
    status: ResearchJob["status"];
    currentStep: string | null;
    plan: string | null;
    outline: string | null;
    report: string | null;
    sources: unknown;
    result: unknown;
    error: string | null;
    totalSteps: number;
    workflowInstanceId: string | null;
  }>,
): Promise<void> {
  if (!jobId) return;
  try {
    const db = drizzle(env.DB);
    await db
      .update(researchJobs)
      .set({ ...patch, updatedAt: new Date() } as Partial<ResearchJobInsert>)
      .where(eq(researchJobs.id, jobId));
  } catch (err) {
    console.error(`[research-jobs] updateJob(${jobId}) failed:`, err);
  }
}

/**
 * Mark a step "running" — upserts the (jobId, stepKey) row so workflow retries
 * refresh rather than duplicate. Also sets the job's live narration line and
 * flips a pending job to running.
 */
export async function beginStep(
  env: Env,
  jobId: number | null | undefined,
  stepKey: string,
  label: string,
  sortOrder: number,
): Promise<void> {
  if (!jobId) return;
  try {
    const db = drizzle(env.DB);
    await db
      .insert(researchJobSteps)
      .values({ jobId, stepKey, label, status: "running", sortOrder, startedAt: new Date() })
      .onConflictDoUpdate({
        target: [researchJobSteps.jobId, researchJobSteps.stepKey],
        set: { status: "running", label, sortOrder, startedAt: new Date() },
      });
    await db
      .update(researchJobs)
      .set({ status: "running", currentStep: label, updatedAt: new Date() })
      .where(eq(researchJobs.id, jobId));
  } catch (err) {
    console.error(`[research-jobs] beginStep(${jobId}, ${stepKey}) failed:`, err);
  }
}

/**
 * Mark a step complete with its output artifact, bump completedSteps, and
 * recompute progress (capped at 99 until completeJob seals it at 100).
 */
export async function completeStep(
  env: Env,
  jobId: number | null | undefined,
  stepKey: string,
  opts?: { detail?: string | null; artifact?: unknown },
): Promise<void> {
  if (!jobId) return;
  try {
    const db = drizzle(env.DB);
    await db
      .update(researchJobSteps)
      .set({
        status: "complete",
        detail: opts?.detail ?? null,
        artifact: opts?.artifact ?? null,
        completedAt: new Date(),
      })
      .where(and(eq(researchJobSteps.jobId, jobId), eq(researchJobSteps.stepKey, stepKey)));

    // completedSteps = count of complete step rows (idempotent under retries,
    // unlike a naive increment).
    const [counts] = await db
      .select({
        done: sql<number>`count(*)`,
      })
      .from(researchJobSteps)
      .where(and(eq(researchJobSteps.jobId, jobId), eq(researchJobSteps.status, "complete")));
    const [job] = await db
      .select({ totalSteps: researchJobs.totalSteps })
      .from(researchJobs)
      .where(eq(researchJobs.id, jobId))
      .limit(1);
    const done = counts?.done ?? 0;
    const total = Math.max(job?.totalSteps ?? 1, done, 1);
    await db
      .update(researchJobs)
      .set({
        completedSteps: done,
        progress: Math.min(99, Math.round((done / total) * 100)),
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, jobId));
  } catch (err) {
    console.error(`[research-jobs] completeStep(${jobId}, ${stepKey}) failed:`, err);
  }
}

/** Mark a step failed (job-level failure is recorded separately via failJob). */
export async function failStep(
  env: Env,
  jobId: number | null | undefined,
  stepKey: string,
  detail?: string,
): Promise<void> {
  if (!jobId) return;
  try {
    const db = drizzle(env.DB);
    await db
      .update(researchJobSteps)
      .set({ status: "failed", detail: detail ?? null, completedAt: new Date() })
      .where(and(eq(researchJobSteps.jobId, jobId), eq(researchJobSteps.stepKey, stepKey)));
  } catch (err) {
    console.error(`[research-jobs] failStep(${jobId}, ${stepKey}) failed:`, err);
  }
}

/** Seal the job: status complete, progress 100, final artifacts. */
export async function completeJob(
  env: Env,
  jobId: number | null | undefined,
  finals?: Partial<{ report: string | null; sources: unknown; result: unknown }>,
): Promise<void> {
  if (!jobId) return;
  try {
    const db = drizzle(env.DB);
    await db
      .update(researchJobs)
      .set({
        ...finals,
        status: "complete",
        progress: 100,
        currentStep: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      } as Partial<ResearchJobInsert>)
      .where(eq(researchJobs.id, jobId));
  } catch (err) {
    console.error(`[research-jobs] completeJob(${jobId}) failed:`, err);
  }
}

/** Mark the job failed with an error message (progress left as-is). */
export async function failJob(
  env: Env,
  jobId: number | null | undefined,
  error: unknown,
): Promise<void> {
  if (!jobId) return;
  try {
    const db = drizzle(env.DB);
    await db
      .update(researchJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        currentStep: null,
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, jobId));
  } catch (err) {
    console.error(`[research-jobs] failJob(${jobId}) failed:`, err);
  }
}

/**
 * Build a deep-research-engine `onPhase` callback bound to a job. Engine
 * phases land as steps keyed `engine:<phase>` (sortOrder base + phase index),
 * and the plan/outline/report artifacts are mirrored onto the job row so the
 * viewport shows them as soon as they exist.
 */
export function enginePhaseRecorder(env: Env, jobId: number | null | undefined, sortBase = 100) {
  return async (phase: {
    key: string;
    label: string;
    status: "running" | "complete" | "failed";
    index: number;
    detail?: string;
    artifact?: unknown;
  }): Promise<void> => {
    if (!jobId) return;
    const stepKey = `engine:${phase.key}`;
    if (phase.status === "running") {
      await beginStep(env, jobId, stepKey, phase.label, sortBase + phase.index);
      return;
    }
    if (phase.status === "failed") {
      await failStep(env, jobId, stepKey, phase.detail);
      return;
    }
    await completeStep(env, jobId, stepKey, {
      detail: phase.detail ?? null,
      artifact: phase.artifact,
    });
    // Mirror headline artifacts onto the job row for instant viewport render.
    if (phase.key === "plan" && typeof phase.artifact === "string") {
      await updateJob(env, jobId, { plan: phase.artifact });
    } else if (phase.key === "outline" && typeof phase.artifact === "string") {
      await updateJob(env, jobId, { outline: phase.artifact });
    }
  };
}
