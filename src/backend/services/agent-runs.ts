/**
 * @fileoverview Agent run recorder.
 *
 * The single way anything in this codebase writes to the agent run ledger.
 *
 * DESIGN RULE: recording must never be able to break the work it records.
 * Every write here is best-effort and swallows its own errors. An agent whose
 * scrape succeeded but whose telemetry insert failed has still succeeded — the
 * opposite (losing real work to a logging bug) is unacceptable. This mirrors
 * `logGeminiUsage`, which takes the same stance for the same reason.
 *
 * Usage:
 *
 * ```ts
 * const run = await startRun(env, {
 *   agent: "showroom-research",
 *   operation: "scrape_store",
 *   targetType: "showroom_store",
 *   targetId: String(storeId),
 *   targetLabel: store.name,
 *   triggeredBy: "user",
 * });
 *
 * try {
 *   await run.step("fetch page", async () => { ... });
 *   const data = await run.tool("browser.render", { url }, () => render(url));
 *   await run.succeed({ brandsFound: data.brands.length });
 * } catch (err) {
 *   await run.fail(err);   // records code + message, rethrows nothing
 *   throw err;
 * }
 * ```
 */
import { agentRunSteps, agentRunToolCalls, agentRuns } from "@backend/db";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { errorCodeOf, messageOf, safeJson } from "./agent-run-format";

export { errorCodeOf, safeJson } from "./agent-run-format";

export interface StartRunInput {
  agent: string;
  operation: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  input?: unknown;
  triggeredBy?: "cron" | "user" | "mcp" | "agent";
  /** Set when this run replaces an earlier failed one. */
  parentRunId?: number;
  attempt?: number;
}

/** Handle returned by {@link startRun}. All methods are best-effort. */
export interface RunRecorder {
  /** Ledger row id, or null if the initial insert failed. */
  readonly id: number | null;
  /** Wrap a named phase. Records timing and failure, rethrows the original. */
  step<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Wrap one tool/external call. Records args, result, timing, failure. */
  tool<T>(name: string, args: unknown, fn: () => Promise<T>): Promise<T>;
  succeed(output?: unknown): Promise<void>;
  fail(error: unknown): Promise<void>;
  /** Park the run for human review (HITL). */
  needsApproval(output?: unknown): Promise<void>;
}

/** A recorder that writes nothing — used when the ledger insert fails. */
function nullRecorder(): RunRecorder {
  return {
    id: null,
    async step(_label, fn) {
      return fn();
    },
    async tool(_name, _args, fn) {
      return fn();
    },
    async succeed() {},
    async fail() {},
    async needsApproval() {},
  };
}

/**
 * Open a run and return a recorder.
 *
 * Never throws: if the ledger is unavailable the caller gets a no-op recorder
 * and the real work proceeds unrecorded.
 */
export async function startRun(env: Env, input: StartRunInput): Promise<RunRecorder> {
  const db = drizzle(env.DB);
  const startedAt = new Date();

  let runId: number;
  try {
    const [row] = await db
      .insert(agentRuns)
      .values({
        agent: input.agent,
        operation: input.operation,
        targetType: input.targetType,
        targetId: input.targetId,
        targetLabel: input.targetLabel,
        status: "running",
        attempt: input.attempt ?? 1,
        parentRunId: input.parentRunId,
        inputJson: safeJson(input.input),
        triggeredBy: input.triggeredBy,
        startedAt,
      })
      .returning({ id: agentRuns.id });
    if (!row) return nullRecorder();
    runId = row.id;
  } catch (error) {
    console.error("[agent-runs] failed to open run:", error);
    return nullRecorder();
  }

  let seq = 0;
  let currentStepId: number | null = null;

  const finish = async (
    status: "succeeded" | "failed" | "needs_approval",
    extra: { output?: unknown; error?: unknown } = {},
  ) => {
    try {
      const endedAt = new Date();
      await db
        .update(agentRuns)
        .set({
          status,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          outputJson: extra.output !== undefined ? safeJson(extra.output) : undefined,
          errorCode: extra.error !== undefined ? errorCodeOf(extra.error) : undefined,
          errorMessage: extra.error !== undefined ? messageOf(extra.error) : undefined,
        })
        .where(eq(agentRuns.id, runId));
    } catch (error) {
      console.error("[agent-runs] failed to close run:", error);
    }
  };

  return {
    id: runId,

    async step(label, fn) {
      seq += 1;
      const stepStart = new Date();
      let stepId: number | null = null;
      try {
        const [row] = await db
          .insert(agentRunSteps)
          .values({ runId, seq, label, status: "running", startedAt: stepStart })
          .returning({ id: agentRunSteps.id });
        stepId = row?.id ?? null;
        currentStepId = stepId;
      } catch (error) {
        console.error("[agent-runs] failed to open step:", error);
      }

      try {
        const result = await fn();
        if (stepId !== null) {
          const endedAt = new Date();
          await db
            .update(agentRunSteps)
            .set({
              status: "succeeded",
              endedAt,
              durationMs: endedAt.getTime() - stepStart.getTime(),
            })
            .where(eq(agentRunSteps.id, stepId))
            .catch(() => {});
        }
        return result;
      } catch (error) {
        if (stepId !== null) {
          const endedAt = new Date();
          await db
            .update(agentRunSteps)
            .set({
              status: "failed",
              errorMessage: messageOf(error),
              endedAt,
              durationMs: endedAt.getTime() - stepStart.getTime(),
            })
            .where(eq(agentRunSteps.id, stepId))
            .catch(() => {});
        }
        // The step recorded its failure; the caller still owns the error.
        throw error;
      } finally {
        currentStepId = null;
      }
    },

    async tool(name, args, fn) {
      const callStart = Date.now();
      const stepId = currentStepId;
      try {
        const result = await fn();
        try {
          await db.insert(agentRunToolCalls).values({
            runId,
            stepId,
            tool: name,
            ok: true,
            argsJson: safeJson(args),
            resultJson: safeJson(result),
            durationMs: Date.now() - callStart,
          });
        } catch (error) {
          console.error("[agent-runs] failed to record tool call:", error);
        }
        return result;
      } catch (error) {
        try {
          await db.insert(agentRunToolCalls).values({
            runId,
            stepId,
            tool: name,
            ok: false,
            argsJson: safeJson(args),
            errorCode: errorCodeOf(error),
            errorMessage: messageOf(error),
            durationMs: Date.now() - callStart,
          });
        } catch (recordError) {
          console.error("[agent-runs] failed to record failed tool call:", recordError);
        }
        throw error;
      }
    },

    succeed: (output) => finish("succeeded", { output }),
    fail: (error) => finish("failed", { error }),
    needsApproval: (output) => finish("needs_approval", { output }),
  };
}
