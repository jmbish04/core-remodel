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
 *   const data = await run.step("fetch page", async (step) =>
 *     step.tool("browser.render", { url }, () => render(url)),
 *   );
 *   await run.succeed({ brandsFound: data.brands.length });
 * } catch (err) {
 *   await run.fail(err);   // records code + message, rethrows nothing
 *   throw err;
 * }
 * ```
 */
import { agentRunSteps, agentRunToolCalls, agentRuns } from "@backend/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { withAgentRunContext } from "./agent-run-context";
import { errorCodeOf, messageOf, safeJson } from "./agent-run-format";
import { recordUsage } from "./usage/metering";

/**
 * Durable Object wall-clock rate, USD per second.
 *
 * Cloudflare bills DO duration in GB-seconds; this is a flat per-second stand-in
 * so the ledger has a real number to sum instead of the $0 it reported before
 * anything wrote DO usage at all. It will be wrong in magnitude and right in
 * shape — a runaway shows up as a curve going up, which is the whole job.
 *
 * ponytail: flat rate, not GB-seconds. Replace with the real figure off the next
 * Cloudflare invoice; the calibration knob is this one constant.
 */
const DURABLE_OBJECT_COST_PER_SECOND_USD = 0.0000125;

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

/** Records tool calls attributed to one specific step. */
export interface StepRecorder {
  tool<T>(name: string, args: unknown, fn: () => Promise<T>): Promise<T>;
}

/** Handle returned by {@link startRun}. All methods are best-effort. */
export interface RunRecorder {
  /** Ledger row id, or null if the initial insert failed. */
  readonly id: number | null;
  /**
   * Wrap a named phase. Records timing and failure, rethrows the original.
   *
   * The callback receives a STEP-SCOPED recorder; use `step.tool(...)` so the
   * call is attributed to this step. Attribution is passed as an argument
   * rather than held in shared instance state precisely so concurrent steps
   * (`Promise.all` over pages, say) cannot steal each other's tool calls.
   */
  step<T>(label: string, fn: (step: StepRecorder) => Promise<T>): Promise<T>;
  /** Wrap a tool call made OUTSIDE any step (recorded with a null step). */
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
      return fn({ tool: (_name, _args, f) => f() });
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

    // Price the run's wall-clock as Durable Object compute.
    //
    // WHY HERE. `DURABLE_OBJECT` has been a declared metered provider since the
    // metering system shipped, and its ceiling has never once been able to
    // trip — because nothing anywhere wrote a DURABLE_OBJECT usage row, so
    // `getCycleSpend` summed to $0 forever. A budget over an unmeasured number
    // is decoration. Every Agent, Durable Object and Workflow entry point in
    // this repo already opens a run through `startRun`, and a run's duration IS
    // the billable quantity for a DO, so this one writer covers all of them
    // without touching 26 classes.
    //
    // Recorded on close (not open) because duration is not known until then.
    // `recordUsage` never throws by contract.
    const durationMs = Date.now() - startedAt.getTime();
    await recordUsage(env, {
      agentRunId: runId,
      provider: "DURABLE_OBJECT",
      model: `${input.agent}/${input.operation}`,
      feature: input.agent,
      latencyMs: durationMs,
      status: status === "failed" ? "error" : "ok",
      costUsd: (durationMs / 1000) * DURABLE_OBJECT_COST_PER_SECOND_USD,
      meta: { operation: input.operation, targetType: input.targetType },
    });
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
      } catch (error) {
        console.error("[agent-runs] failed to open step:", error);
      }

      const scoped: StepRecorder = {
        tool: (name, args, f) => recordTool(name, args, f, stepId),
      };

      try {
        // Bind the run/step to this callback's async chain so any AI call made
        // inside it attributes its spend without the call site knowing about
        // the ledger at all. See agent-run-context.ts for why this is an
        // AsyncLocalStorage and not a module-level variable.
        const result = await withAgentRunContext({ runId, stepId }, () => fn(scoped));
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
      }
    },

    async tool(name, args, fn) {
      return withAgentRunContext({ runId, stepId: null }, () => recordTool(name, args, fn, null));
    },

    succeed: (output) => finish("succeeded", { output }),
    fail: (error) => finish("failed", { error }),
    needsApproval: (output) => finish("needs_approval", { output }),
  };

  /**
   * Record one tool call against an explicit step (or null for run-level).
   * Never swallows the caller's error — it records, then rethrows.
   */
  async function recordTool<T>(
    name: string,
    args: unknown,
    fn: () => Promise<T>,
    stepId: number | null,
  ): Promise<T> {
    const callStart = Date.now();
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
  }
}
