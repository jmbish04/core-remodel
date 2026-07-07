/**
 * @fileoverview Barrel for the deep-research engine.
 *
 * A reusable TypeScript port of Google's ADK deep-research pipeline
 * (plan_generator → section_planner → section_researcher →
 * [research_evaluator → enhanced_search_executor] loop → report_composer
 * with `<cite source="src-N"/>` citations), run non-interactively on
 * Cloudflare Workers via the shared Gemini AI-Gateway client.
 *
 * Usage:
 * ```ts
 * import { runDeepResearch } from "@backend/ai/deep-research";
 * const result = await runDeepResearch(env, topic, { guidance });
 * ```
 *
 * The stepwise functions (generateResearchPlan, planReportSections,
 * researchSections, evaluateResearch, executeFollowUps, composeCitedReport)
 * are exported so Cloudflare Workflows can run each phase as a separate
 * durable step — every input/output is JSON-serializable.
 */

export type {
  DeepResearchFeedback,
  DeepResearchOptions,
  DeepResearchResult,
  DeepResearchSource,
  DeepResearchState,
} from "./types";
export {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_RESEARCH_GOALS,
  createInitialState,
} from "./types";

export {
  composeCitedReport,
  evaluateResearch,
  executeFollowUps,
  generateResearchPlan,
  planReportSections,
  researchSections,
  runDeepResearch,
} from "./engine";

export {
  CITE_TAG_REGEX,
  collectGroundingSources,
  renderSourceList,
  resolveCitations,
} from "./citations";
