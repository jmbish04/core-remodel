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
 * 3. **The step-scoped tool recorder is exposed, not hidden.** Callers that
 *    want per-tool attribution use `ledgerTool` inside the callback; attribution
 *    is passed as an argument so concurrent steps cannot steal each other's
 *    tool calls.
 */
import type { WorkflowStep } from "cloudflare:workers";

import type { RunRecorder, StepRecorder } from "./agent-runs";

/**
 * Async-local handle to the step recorder for the `step.do` currently
 * executing, so `ledgerTool` can attribute a tool call without every helper
 * signature growing a parameter.
 *
 * A plain module-level variable is safe here ONLY because it is set and cleared
 * synchronously around a single awaited callback per wrapper instance, and
 * because a Workflow instance executes its steps sequentially. Any code that
 * fans out with `Promise.all` inside one step must pass the recorder explicitly
 * instead — which is exactly what `run.step((step) => ...)` already offers.
 */
let activeStep: StepRecorder | null = null;

/**
 * Record a tool call inside the currently executing wrapped step.
 *
 * Falls through to a bare invocation when there is no active step, so a helper
 * using this is safe to call from an uninstrumented path.
 */
export async function ledgerTool<T>(
  name: string,
  args: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const step = activeStep;
  if (!step) return fn();
  return step.tool(name, args, fn);
}

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
      run.step(name, async (stepRecorder) => {
        const previous = activeStep;
        activeStep = stepRecorder;
        try {
          return await originalDo(name, ...rest);
        } finally {
          // Restore rather than null out: a nested wrapped step must not blind
          // its parent's remaining tool calls.
          activeStep = previous;
        }
      })) as WorkflowStep["do"],

    sleep: step.sleep.bind(step),
    sleepUntil: step.sleepUntil.bind(step),
    waitForEvent: step.waitForEvent.bind(step),
  };

  return wrapped;
}
