/**
 * @fileoverview Public types + state helpers for the deep-research engine.
 *
 * This module is a TypeScript port of Google's ADK deep-research pipeline
 * (`plan_generator` → `section_planner` → `section_researcher` →
 * [`research_evaluator` → escalation check → `enhanced_search_executor`] loop
 * → `report_composer`), adapted to non-interactive use on Cloudflare Workers:
 * there is no user in the loop, the plan is auto-approved, and the interactive
 * planner / QNA stages are dropped.
 *
 * Every type here is intentionally JSON-serializable so the stepwise engine
 * functions (see `engine.ts`) can be run as separate durable steps inside a
 * Cloudflare Workflow — state is passed in and returned as plain objects.
 */

/**
 * A single web source discovered via Gemini Google-Search grounding metadata.
 *
 * Port of the ADK `collect_research_sources_callback` source record: each
 * unique grounding URL gets a stable short id (`src-1`, `src-2`, …) that the
 * report composer later cites via `<cite source="src-N" />` tags.
 */
export interface DeepResearchSource {
  /** Stable short citation id, e.g. `"src-1"`. */
  shortId: string;
  /** Page title reported by grounding metadata (falls back to the domain). */
  title: string;
  /** Fully-qualified source URL (grounding redirect URLs are kept as-is). */
  url: string;
  /** Source domain, from grounding metadata or derived from the URL host. */
  domain: string;
  /**
   * Claims (model-output text segments) this source supports, with the
   * grounding confidence score for each — port of `groundingSupports`
   * (`segment.text` × `confidenceScores` × `groundingChunkIndices`).
   */
  supportedClaims: Array<{ textSegment: string; confidence: number }>;
}

/**
 * The research critic's verdict — port of the ADK `Feedback` Pydantic model
 * returned by `research_evaluator`.
 */
export interface DeepResearchFeedback {
  /** `"pass"` if the research is sufficient, `"fail"` if it needs revision. */
  grade: "pass" | "fail";
  /** Detailed explanation of the evaluation. */
  comment: string;
  /**
   * 5–7 specific follow-up search queries when the grade is `"fail"`;
   * `null` when the grade is `"pass"`.
   */
  followUpQueries: string[] | null;
}

/**
 * Accumulated pipeline state. Mirrors the ADK session-state keys:
 * `research_plan`, `report_sections`, `section_research_findings`,
 * `sources`, `url_to_short_id`, and the escalation-loop iteration counter.
 */
export interface DeepResearchState {
  /** The `[RESEARCH]` / `[DELIVERABLE]` bulleted plan (plan_generator). */
  plan: string;
  /** The 4–6 section markdown report outline (section_planner). */
  outline: string;
  /** The full research findings document (section_researcher + refinements). */
  findings: string;
  /** All collected sources keyed by short id (`src-1` → source). */
  sources: Record<string, DeepResearchSource>;
  /** Reverse map: source URL → stable short id (keeps ids stable across calls). */
  urlToShortId: Record<string, string>;
  /** Number of refinement (enhanced-search) passes executed so far. */
  iterations: number;
}

/**
 * Final result of {@link import("./engine").runDeepResearch}: the accumulated
 * state plus the composed report and the last critic evaluation.
 */
export interface DeepResearchResult extends DeepResearchState {
  /**
   * Final markdown report with `<cite source="src-N"/>` tags resolved to
   * `[title](url)` links. Falls back to `findings` if composition fails.
   */
  report: string;
  /** The last evaluator verdict, or `null` if the evaluator never ran. */
  evaluation: DeepResearchFeedback | null;
}

/** Tunables for a deep-research run. */
export interface DeepResearchOptions {
  /**
   * Extra domain guidance woven into the plan-generation and research
   * prompts (e.g. extraction goals, negative constraints, source priorities).
   */
  guidance?: string;
  /** Refinement-loop cap (evaluator-fail → follow-up passes). Default 2. */
  maxIterations?: number;
  /** Number of initial `[RESEARCH]` goals in the plan. Default 5. */
  maxResearchGoals?: number;
}

/** Default refinement-loop cap (matches the ADK `max_iterations=2` loop). */
export const DEFAULT_MAX_ITERATIONS = 2;

/** Default number of action-oriented `[RESEARCH]` goals (the ADK "5 goals"). */
export const DEFAULT_MAX_RESEARCH_GOALS = 5;

/** Create a fresh, empty pipeline state. */
export function createInitialState(): DeepResearchState {
  return {
    plan: "",
    outline: "",
    findings: "",
    sources: {},
    urlToShortId: {},
    iterations: 0,
  };
}
