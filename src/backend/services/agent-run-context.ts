/**
 * @fileoverview Ambient "which run am I inside" context.
 *
 * WHY NOT A MODULE-LEVEL VARIABLE
 * -------------------------------
 * The obvious implementation — `let currentRunId` set on entry and cleared on
 * exit — is wrong here, and wrong in exactly the place that matters most.
 * `image-processor/batch-workflow.ts` processes a wave of images with
 * `Promise.all`, so several `runImageProcessingSteps` calls are interleaved in
 * ONE isolate. A shared mutable variable would hand every AI call the run id of
 * whichever image happened to start last, and the cost dashboard would confi-
 * dently attribute the whole batch's spend to a single arbitrary image.
 *
 * A wrong number on a cost page is worse than no number, because nobody
 * double-checks a number that looks plausible. `AsyncLocalStorage` keeps the
 * association per async call-chain, which is what "the run I am inside"
 * actually means.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `env.AI.run` appears ~130 times across ~40 files. Threading a run id through
 * every one of those signatures — and through the service layers between them —
 * would be an enormous diff whose only purpose is plumbing, and every call site
 * missed would be a silent hole in the spend attribution. The recorder already
 * wraps execution in `run.step(...)` / `run.tool(...)`; binding the context
 * there means metering picks the run id up for free, everywhere, with no call
 * site changes.
 *
 * SCOPE AND HONESTY
 * -----------------
 * Only calls made INSIDE a `run.step` or `run.tool` callback are attributed.
 * An AI call made inside a run but outside any step records `agent_run_id`
 * NULL and renders as "(unattributed)". That is deliberate: a missing
 * attribution is visible and fixable; a guessed one is not.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface AgentRunContext {
  /** `agent_runs.id`, or null when the ledger insert failed. */
  runId: number | null;
  /** `agent_run_steps.id` when inside a step, else null. */
  stepId: number | null;
}

const storage = new AsyncLocalStorage<AgentRunContext>();

/** Run `fn` with the given run/step bound to its async call-chain. */
export function withAgentRunContext<T>(ctx: AgentRunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The run this code is executing inside, or null. */
export function currentAgentRunId(): number | null {
  return storage.getStore()?.runId ?? null;
}

/** The step this code is executing inside, or null. */
export function currentAgentStepId(): number | null {
  return storage.getStore()?.stepId ?? null;
}

/** Full context, for callers that want both without two lookups. */
export function currentAgentRunContext(): AgentRunContext | null {
  return storage.getStore() ?? null;
}
