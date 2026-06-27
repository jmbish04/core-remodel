/**
 * @fileoverview DeepResearchAgent (Engine B) — types, config schema, state.
 *
 * Engine B is a self-hosted port of the 6-agent iterative research loop from
 * `zyakita/gemini-deep-research-oss`, adapted to the home-renovation / Bay-Area
 * sourcing domain and running on the Cloudflare Agents SDK (a Durable Object).
 *
 * It deliberately reuses Engine A's persistence contract so the Phase 6 portal
 * is engine-agnostic:
 *   - the SAME `research_sessions` D1 row (with `engine = "cf"`)
 *   - the SAME R2 keys (`research/{id}/report.md`, `research/{id}/visualizer.html`)
 *   - the SAME Vectorize namespace (`research:{id}`) via `embedAndUpsertChunks`
 *   - `status` ending at `complete` with `r2MarkdownKey`, `r2WebappKey`,
 *     `vectorNamespace`, `chunkCount` populated.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Run configuration — mirrors the OSS `stores/setting` shape
// ---------------------------------------------------------------------------

/** Research-task source target, ported from the OSS agents. */
export const cfResearchTargetSchema = z.enum([
  "WEB",
  "ACADEMIC",
  "SOCIAL",
  "FILE_UPLOAD",
]);
export type CfResearchTarget = z.infer<typeof cfResearchTargetSchema>;

/**
 * Engine-B run config. Field names mirror the OSS setting store so the contract
 * is recognisable: `depth` (iteration rounds), `wide` (breadth / tasks per
 * round), `parallelSearch` (concurrent researchers), `reportTone`, `minWords`,
 * `coreModel`/`taskModel`, `thinkingBudget`.
 */
export const cfEngineConfigSchema = z.object({
  /** Heavy reasoning model (lead, deep-gap, report-plan, reporter). */
  coreModel: z.string().default("gemini-2.5-pro"),
  /** Fast model for the per-task researcher (grounded search). */
  taskModel: z.string().default("gemini-2.5-flash"),
  /** Gemini thinking budget (tokens) per step. */
  thinkingBudget: z.number().int().min(0).max(24_576).default(2_048),
  /** Number of iterative research rounds (gap loop). OSS default 3. */
  depth: z.number().int().min(1).max(5).default(3),
  /** Breadth: max research tasks generated per round. OSS default 7. */
  wide: z.number().int().min(1).max(12).default(7),
  /** Concurrent researcher fan-out within a round. OSS default 3. */
  parallelSearch: z.number().int().min(1).max(6).default(3),
  /** Writing tone hint passed to the reporter. */
  reportTone: z
    .enum([
      "journalist-tone",
      "analytical-tone",
      "homeowner-friendly",
      "contractor-brief",
      "designer-spec",
    ])
    .default("homeowner-friendly"),
  /** Minimum target length (words) for the final report. */
  minWords: z.number().int().min(500).max(20_000).default(4_000),
  /** Skip the clarifying-questions step (QNA). Default true for unattended runs. */
  skipClarifyingQuestions: z.boolean().default(true),
});
export type CfEngineConfig = z.infer<typeof cfEngineConfigSchema>;

export const DEFAULT_CF_ENGINE_CONFIG: CfEngineConfig = cfEngineConfigSchema.parse({});

// ---------------------------------------------------------------------------
// Run input — what the route hands the agent
// ---------------------------------------------------------------------------

/**
 * Optional domain target so Engine-B runs can be anchored to a showroom store,
 * product, or material — matching Engine A's typed launcher.
 */
export const cfTargetTypeSchema = z.enum([
  "generic",
  "showroom",
  "product",
  "material",
]);
export type CfTargetType = z.infer<typeof cfTargetTypeSchema>;

export const runDeepResearchInputSchema = z.object({
  /** D1 research_sessions id this run writes into (created by the route). */
  sessionId: z.number().int().positive(),
  /** Short topic / title. */
  topic: z.string().min(3),
  /** Full research prompt (user-reviewed). Falls back to a topic template. */
  prompt: z.string().nullish(),
  /** Domain anchor. */
  targetType: cfTargetTypeSchema.default("generic"),
  targetId: z.number().int().positive().nullish(),
  /** Run configuration (partial — merged onto defaults). */
  config: cfEngineConfigSchema.partial().nullish(),
});
export type RunDeepResearchInput = z.infer<typeof runDeepResearchInputSchema>;

// ---------------------------------------------------------------------------
// Loop state — persisted to D1 (cf_engine_state JSON) + broadcast via setState
// ---------------------------------------------------------------------------

export type CfPhase =
  | "idle"
  | "clarifying" // QNA
  | "planning_lead" // Research Lead (decompose)
  | "report_plan" // Report Plan (blueprint)
  | "researching" // Researcher fan-out (per round)
  | "gap_analysis" // Research Deep (gap → follow-up tasks)
  | "reporting" // Reporter (synthesise)
  | "embedding" // chunk + Vectorize
  | "generating" // visualizer
  | "complete"
  | "failed";

/** A single research task produced by the lead / deep-gap agents. */
export interface CfResearchTask {
  tier: number;
  title: string;
  direction: string;
  target: CfResearchTarget;
  status: "pending" | "running" | "done" | "failed";
  /** Findings text returned by the researcher (grounded). */
  learning?: string;
  /** Source URLs surfaced via grounding metadata. */
  sources?: string[];
}

export interface CfClarifyingQuestion {
  question: string;
  suggestedRefinement: string;
}

export interface DeepResearchAgentState {
  sessionId: number | null;
  topic: string | null;
  phase: CfPhase;
  /** Human-readable progress line. */
  progress: string;
  /** Current iteration round (1-based). */
  currentTier: number;
  /** Config depth (max rounds). */
  maxTier: number;
  /** Tallies for the portal progress UI. */
  tasksTotal: number;
  tasksDone: number;
  sourcesCount: number;
  chunkCount: number;
  /** Clarifying questions surfaced by the QNA step (informational). */
  questions: CfClarifyingQuestion[];
  /** The flat report-plan outline (markdown). */
  reportPlan?: string;
  errorMessage?: string;
}

export const DEFAULT_DEEP_RESEARCH_STATE: DeepResearchAgentState = {
  sessionId: null,
  topic: null,
  phase: "idle",
  progress: "Ready",
  currentTier: 0,
  maxTier: 0,
  tasksTotal: 0,
  tasksDone: 0,
  sourcesCount: 0,
  chunkCount: 0,
  questions: [],
};

// ---------------------------------------------------------------------------
// Output contract (shared with Engine A) — documented for the Phase 6 portal
// ---------------------------------------------------------------------------

/**
 * The engine-agnostic output contract. Engine B writes ALL of these into the
 * same `research_sessions` row + R2 + Vectorize as Engine A:
 *   - status:          "complete"
 *   - r2MarkdownKey:   `research/{sessionId}/report.md`        (text/markdown)
 *   - r2WebappKey:     `research/{sessionId}/visualizer.html`  (text/html)
 *   - vectorNamespace: `research:{sessionId}`
 *   - chunkCount:      number of embedded chunks
 *   - engine:          "cf"
 * The portal reads markdown via GET /api/admin/research/:id/markdown and the
 * visualizer via GET /api/admin/research/:id/visualizer, identical to Engine A.
 */
export const CF_ENGINE_OUTPUT_CONTRACT = {
  engine: "cf",
  r2MarkdownKey: (sessionId: number) => `research/${sessionId}/report.md`,
  r2WebappKey: (sessionId: number) => `research/${sessionId}/visualizer.html`,
  vectorNamespace: (sessionId: number) => `research:${sessionId}`,
} as const;
