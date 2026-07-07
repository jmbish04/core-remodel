/**
 * @fileoverview The deep-research pipeline engine.
 *
 * TypeScript port of Google's ADK deep-research pipeline, run non-interactively
 * (the plan is auto-approved; no QNA / interactive planner):
 *
 *   1. {@link generateResearchPlan}  — plan_generator (plain, no search)
 *   2. {@link planReportSections}    — section_planner (plain)
 *   3. {@link researchSections}      — section_researcher (grounded search)
 *   4. {@link evaluateResearch}      — research_evaluator (ungrounded JSON)
 *   5. loop while "fail" & iterations < max:
 *      {@link executeFollowUps}      — enhanced_search_executor (grounded)
 *   6. {@link composeCitedReport}    — report_composer + citation resolution
 *
 * Each stepwise function takes/returns JSON-serializable values so Cloudflare
 * Workflows can run phases as separate durable steps. {@link runDeepResearch}
 * orchestrates all of them in-process.
 *
 * Gemini access mirrors the house pattern in
 * `src/backend/ai/agents/DeepResearchAgent/methods/agent-steps.ts`: the shared
 * `createGeminiAiGatewayClient` factory, `tools: [{ googleSearch: {} }]` for
 * grounded calls, and defensive JSON parsing (strip ```json fences, fall back
 * to the outermost `{...}`). NOTE: Gemini cannot combine `googleSearch`
 * grounding with structured output, so the evaluator (which needs no search)
 * uses `responseMimeType: "application/json"` while grounded research calls
 * describe their output shape in the prompt body.
 */

import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

import {
  collectGroundingSources,
  renderSourceList,
  resolveCitations,
} from "./citations";
import {
  enhancedSearchPrompt,
  planGeneratorPrompt,
  reportComposerPrompt,
  researchEvaluatorPrompt,
  sectionPlannerPrompt,
  sectionResearcherPrompt,
} from "./prompts";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RESEARCH_GOALS,
  createInitialState,
  type DeepResearchFeedback,
  type DeepResearchOptions,
  type DeepResearchPhaseEvent,
  type DeepResearchResult,
  type DeepResearchState,
} from "./types";

/** Heavy-reasoning model: plan, outline, evaluator, report composer. */
const CORE_MODEL = "gemini-2.5-pro";

/** Fast model for grounded research passes (search-heavy, high volume). */
const RESEARCH_MODEL = "gemini-2.5-flash";

/** ISO date (YYYY-MM-DD) injected where the ADK prompts used datetime.now. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Per-call logging, mirroring the agent-steps observability convention. */
function logModelCall(
  step: string,
  model: string,
  promptChars: number,
  outputChars: number,
) {
  console.log(
    `[deep-research] step=${step} model=${model} promptChars=${promptChars} outputChars=${outputChars}`,
  );
}

/** Strip ```json fences (defensive JSON cleanup, same as agent-steps). */
function cleanupJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/** Parse model JSON output; fall back to the outermost `{...}`, then `fallback`. */
function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(cleanupJson(raw)) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return fallback;
    }
  }
}

/**
 * Plain (ungrounded) Gemini call. Set `json` for
 * `responseMimeType: "application/json"` structured output.
 */
async function generatePlain(
  env: Env,
  step: string,
  model: string,
  prompt: string,
  json = false,
): Promise<string> {
  const ai = await createGeminiAiGatewayClient(env);
  const response = (await ai.models.generateContent({
    model,
    ...(json ? { config: { responseMimeType: "application/json" } } : {}),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  } as any)) as { text?: string };
  const text = (response.text ?? "").trim();
  logModelCall(step, model, prompt.length, text.length);
  return text;
}

/**
 * Grounded Gemini call with the Google Search tool. Returns both the output
 * text and the raw response so callers can harvest grounding metadata.
 */
async function generateGrounded(
  env: Env,
  step: string,
  prompt: string,
): Promise<{ text: string; response: unknown }> {
  const ai = await createGeminiAiGatewayClient(env);
  const response = (await ai.models.generateContent({
    model: RESEARCH_MODEL,
    config: { tools: [{ googleSearch: {} }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  } as any)) as any;
  const text = (typeof response?.text === "string" ? response.text : "").trim();
  logModelCall(step, RESEARCH_MODEL, prompt.length, text.length);
  return { text, response };
}

// ---------------------------------------------------------------------------
// Stepwise functions (each JSON-serializable in/out for durable Workflows)
// ---------------------------------------------------------------------------

/**
 * Step 1 — plan_generator: produce the bulleted plan of `maxResearchGoals`
 * `[RESEARCH]` goals plus any `[DELIVERABLE][IMPLIED]` extras. Plain
 * generation (the ADK plan generator is explicitly forbidden from searching).
 */
export async function generateResearchPlan(
  env: Env,
  topic: string,
  opts: DeepResearchOptions = {},
): Promise<string> {
  const prompt = planGeneratorPrompt({
    topic,
    guidance: opts.guidance,
    maxGoals: opts.maxResearchGoals ?? DEFAULT_MAX_RESEARCH_GOALS,
    currentDate: today(),
  });
  return generatePlain(env, "plan_generator", CORE_MODEL, prompt);
}

/**
 * Step 2 — section_planner: 4-6 section markdown report outline (no
 * References section; citations are in-line at compose time).
 */
export async function planReportSections(
  env: Env,
  topic: string,
  plan: string,
): Promise<string> {
  const prompt = sectionPlannerPrompt({ topic, plan });
  return generatePlain(env, "section_planner", CORE_MODEL, prompt);
}

/**
 * Step 3 — section_researcher: the first grounded research pass. A single
 * grounded call executes Phase 1 (4-5 targeted queries per `[RESEARCH]`
 * goal via the googleSearch tool) then Phase 2 `[DELIVERABLE]` synthesis
 * with no new searches. Grounding sources are harvested into the state.
 *
 * @throws if the model call fails or produces no findings — callers
 *         (Workflows / {@link runDeepResearch}) rely on this to retry or
 *         abort, since nothing downstream is useful without findings.
 */
export async function researchSections(
  env: Env,
  topic: string,
  state: DeepResearchState,
  opts: DeepResearchOptions = {},
): Promise<DeepResearchState> {
  const next = structuredClone(state);
  const prompt = sectionResearcherPrompt({
    topic,
    plan: next.plan,
    guidance: opts.guidance,
    currentDate: today(),
  });
  const { text, response } = await generateGrounded(
    env,
    "section_researcher",
    prompt,
  );
  if (!text) {
    throw new Error("deep-research: section researcher returned no findings");
  }
  next.findings = text;
  collectGroundingSources(response, next);
  return next;
}

/**
 * Step 4 — research_evaluator: the critic. Ungrounded JSON call (grounding
 * and structured output are mutually exclusive on Gemini; the evaluator
 * needs no search). Unparseable output degrades to a "pass" verdict with a
 * warning rather than blocking the pipeline.
 */
export async function evaluateResearch(
  env: Env,
  topic: string,
  findings: string,
): Promise<DeepResearchFeedback> {
  const prompt = researchEvaluatorPrompt({
    topic,
    findings,
    currentDate: today(),
  });
  const raw = await generatePlain(
    env,
    "research_evaluator",
    CORE_MODEL,
    prompt,
    true,
  );

  const parsed = safeJson<{
    grade?: string;
    comment?: string;
    follow_up_queries?: unknown;
  } | null>(raw, null);

  if (!parsed || (parsed.grade !== "pass" && parsed.grade !== "fail")) {
    console.warn(
      "[deep-research] Evaluator output unparseable; defaulting to pass.",
    );
    return {
      grade: "pass",
      comment: "Evaluator output was unparseable; accepting findings as-is.",
      followUpQueries: null,
    };
  }

  const queries = Array.isArray(parsed.follow_up_queries)
    ? parsed.follow_up_queries
        .filter((q): q is string => typeof q === "string" && q.trim() !== "")
        .map((q) => q.trim())
    : null;

  return {
    grade: parsed.grade,
    comment: typeof parsed.comment === "string" ? parsed.comment : "",
    followUpQueries: parsed.grade === "fail" ? (queries ?? []) : null,
  };
}

/**
 * Step 5 — enhanced_search_executor: grounded refinement pass. Executes every
 * follow-up query from a failed evaluation, merges the new evidence, and
 * REPLACES `findings` with the improved complete set (per the ADK contract).
 * Bumps `iterations`; keeps old findings if the model returns nothing.
 */
export async function executeFollowUps(
  env: Env,
  topic: string,
  state: DeepResearchState,
  feedback: DeepResearchFeedback,
): Promise<DeepResearchState> {
  const next = structuredClone(state);
  next.iterations += 1;

  const prompt = enhancedSearchPrompt({
    topic,
    comment: feedback.comment,
    followUpQueries: feedback.followUpQueries ?? [],
    findings: next.findings,
    currentDate: today(),
  });
  const { text, response } = await generateGrounded(
    env,
    "enhanced_search_executor",
    prompt,
  );
  if (text) next.findings = text;
  collectGroundingSources(response, next);
  return next;
}

/**
 * Step 6 — report_composer: compose the final markdown report. The prompt
 * carries plan + findings + outline + the rendered `src-N: title (url)`
 * source list (the ADK `include_contents="none"` equivalent), instructs
 * `<cite source="src-N" />` as the ONLY citation format, and the tags are
 * then resolved to ` [title](url)` links via {@link resolveCitations}.
 */
export async function composeCitedReport(
  env: Env,
  topic: string,
  state: DeepResearchState,
): Promise<string> {
  const prompt = reportComposerPrompt({
    topic,
    plan: state.plan,
    outline: state.outline,
    findings: state.findings,
    sourceList: renderSourceList(state.sources),
    currentDate: today(),
  });
  const raw = await generatePlain(env, "report_composer", CORE_MODEL, prompt);
  return resolveCitations(raw, state.sources);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full deep-research pipeline for `topic`.
 *
 * Failure semantics: this function never throws — on a step failure it
 * returns the best partial result accumulated so far (the report falls back
 * to the raw findings) and logs via `console.error` — EXCEPT when even the
 * FIRST research pass fails, in which case it throws so callers (Cloudflare
 * Workflow steps) can retry: without any findings there is nothing usable.
 */
export async function runDeepResearch(
  env: Env,
  topic: string,
  opts: DeepResearchOptions = {},
): Promise<DeepResearchResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let state = createInitialState();
  let evaluation: DeepResearchFeedback | null = null;

  // Progress hook — best-effort; a telemetry failure must never stall research.
  const emit = async (event: DeepResearchPhaseEvent) => {
    if (!opts.onPhase) return;
    try {
      await opts.onPhase(event);
    } catch (err) {
      console.error("[deep-research] onPhase hook failed:", err);
    }
  };

  // 1. Plan (non-fatal: a degraded single-goal plan still lets research run).
  await emit({ key: "plan", label: "Generating research plan", status: "running", index: 0 });
  try {
    state.plan = await generateResearchPlan(env, topic, opts);
  } catch (error) {
    console.error("[deep-research] plan_generator failed:", error);
  }
  if (!state.plan.trim()) {
    state.plan = `- [RESEARCH] Investigate and gather comprehensive, well-sourced information on: ${topic}
- [DELIVERABLE][IMPLIED] Synthesize the gathered information into a structured summary of the findings.`;
  }
  await emit({
    key: "plan",
    label: "Generating research plan",
    status: "complete",
    index: 0,
    detail: `${state.plan.split("\n").filter((l) => l.trim().startsWith("-")).length} goals planned`,
    artifact: state.plan,
  });

  // 2. Report outline (non-fatal: composer tolerates an empty outline).
  await emit({ key: "outline", label: "Structuring the report outline", status: "running", index: 1 });
  try {
    state.outline = await planReportSections(env, topic, state.plan);
  } catch (error) {
    console.error("[deep-research] section_planner failed:", error);
  }
  await emit({
    key: "outline",
    label: "Structuring the report outline",
    status: "complete",
    index: 1,
    artifact: state.outline,
  });

  // 3. First research pass — the only step allowed to throw out of here.
  await emit({ key: "research", label: "Researching (grounded web search)", status: "running", index: 2 });
  try {
    state = await researchSections(env, topic, state, opts);
  } catch (error) {
    await emit({
      key: "research",
      label: "Researching (grounded web search)",
      status: "failed",
      index: 2,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await emit({
    key: "research",
    label: "Researching (grounded web search)",
    status: "complete",
    index: 2,
    detail: `${Object.keys(state.sources).length} sources collected`,
    artifact: { findingsChars: state.findings.length, sourceCount: Object.keys(state.sources).length },
  });

  // 4 + 5. Critique → refinement loop (all non-fatal past this point).
  try {
    let round = 1;
    await emit({ key: `evaluate-${round}`, label: `Evaluating research quality (pass ${round})`, status: "running", index: 2 + round * 2 });
    evaluation = await evaluateResearch(env, topic, state.findings);
    await emit({
      key: `evaluate-${round}`,
      label: `Evaluating research quality (pass ${round})`,
      status: "complete",
      index: 2 + round * 2,
      detail: `Grade: ${evaluation.grade}`,
      artifact: evaluation,
    });
    while (
      evaluation.grade === "fail" &&
      state.iterations < maxIterations &&
      (evaluation.followUpQueries?.length ?? 0) > 0
    ) {
      await emit({ key: `follow-ups-${round}`, label: `Filling research gaps (pass ${round})`, status: "running", index: 3 + round * 2 });
      state = await executeFollowUps(env, topic, state, evaluation);
      await emit({
        key: `follow-ups-${round}`,
        label: `Filling research gaps (pass ${round})`,
        status: "complete",
        index: 3 + round * 2,
        detail: `${Object.keys(state.sources).length} sources total`,
      });
      round += 1;
      await emit({ key: `evaluate-${round}`, label: `Evaluating research quality (pass ${round})`, status: "running", index: 2 + round * 2 });
      evaluation = await evaluateResearch(env, topic, state.findings);
      await emit({
        key: `evaluate-${round}`,
        label: `Evaluating research quality (pass ${round})`,
        status: "complete",
        index: 2 + round * 2,
        detail: `Grade: ${evaluation.grade}`,
        artifact: evaluation,
      });
    }
  } catch (error) {
    console.error("[deep-research] evaluation/refinement loop failed:", error);
  }

  // 6. Compose the cited report; fall back to raw findings on failure.
  const composeIndex = 20; // stable slot after any evaluate/follow-up rounds
  await emit({ key: "compose", label: "Composing the cited report", status: "running", index: composeIndex });
  let report = "";
  try {
    report = await composeCitedReport(env, topic, state);
  } catch (error) {
    console.error("[deep-research] report_composer failed:", error);
  }
  if (!report.trim()) report = state.findings;
  await emit({
    key: "compose",
    label: "Composing the cited report",
    status: "complete",
    index: composeIndex,
    detail: `${report.length.toLocaleString()} chars, ${Object.keys(state.sources).length} cited sources`,
    artifact: { reportChars: report.length },
  });

  return { ...state, report, evaluation };
}
