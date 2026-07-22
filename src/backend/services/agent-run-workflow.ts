/**
 * @fileoverview Bridge between Cloudflare Workflow steps and the agent run ledger.
 *
 * A Workflow already names and retries its own phases via `step.do(label, fn)`.
 * The ledger wants those same phases as `agent_run_steps` rows. Rather than
 * hand-writing `run.step(...)` around all ~60 `step.do` calls across the nine
 * workflows — a large, error-prone diff where every missed call site becomes a
 * silent hole in the trace — this wraps the `WorkflowStep` object once so every
 * `step.do` records itself.
 *
 * Instrumenting a workflow therefore costs three lines:
 *
 * ```ts
 * const run = await startRun(env, { agent: "brand-research", operation: "research_brand", ... });
 * const step = ledgerSteps(rawStep, run);          // ← every step.do now recorded
 * try { ...unchanged body...; await run.succeed(digest); }
 * catch (err) { await run.fail(err); throw err; }
 * ```
 *
 * DESIGN RULES
 * ------------
 * 1. **Recording must never change execution.** The wrapper delegates to the
 *    real `step.do` with the same arguments and returns its exact value. If the
 *    ledger write fails, `run.step` swallows it (see `agent-runs.ts`) and the
 *    workflow proceeds. Nothing here adds a failure mode.
 * 2. **Retries stay the Workflow's job.** A `step.do` that Cloudflare retries
 *    internally re-enters this wrapper, so a retried phase produces one ledger
 *    step per attempt. That is intended — an expensive step retried three times
 *    should look like three steps, not one.
 * 3. **Spend attribution is automatic.** `run.step` binds the run/step to the
 *    callback's async chain (see `agent-run-context.ts`), so any AI call made
 *    inside a wrapped step records its `agent_run_id` without the call site
 *    knowing the ledger exists.
 */
import type { WorkflowStep } from "cloudflare:workers";

import type { RunRecorder } from "./agent-runs";

/**
 * Wrap a `WorkflowStep` so every `step.do` also writes an `agent_run_steps` row.
 *
 * `sleep`, `sleepUntil` and `waitForEvent` are passed through untouched — they
 * are not work, and recording them would bloat the trace with rows nobody reads.
 */
export function ledgerSteps(step: WorkflowStep, run: RunRecorder): WorkflowStep {
  // `step.do` is overloaded — (name, cb) and (name, config, cb) — and its
  // callback type is constrained to `Serializable<T>`. Rather than restate
  // those generics (and drift the moment the runtime types change), forward the
  // arguments verbatim and re-assert the public type once at the boundary.
  const originalDo = step.do.bind(step) as (...args: unknown[]) => Promise<unknown>;

  const wrapped: WorkflowStep = {
    ...step,

    do: ((name: string, ...rest: unknown[]) =>
      run.step(name, () => originalDo(name, ...rest))) as WorkflowStep["do"],

    sleep: step.sleep.bind(step),
    sleepUntil: step.sleepUntil.bind(step),
    waitForEvent: step.waitForEvent.bind(step),
  };

  return wrapped;
}
