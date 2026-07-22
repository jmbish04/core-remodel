/**
 * @fileoverview The agent surface registry — every autonomous execution surface
 * in this Worker, declared once.
 *
 * WHY THIS EXISTS
 * ---------------
 * This Worker runs 24 things that can start work on their own: 15 Durable
 * Object agents, 9 Workflows, 7 cron jobs and an MCP server. Each one writes to
 * the shared `agent_runs` ledger via `services/agent-runs.ts`, keyed by a free
 * `agent` slug. A free-text key is right for the ledger — a retired agent's
 * history must survive the deletion of its code — but it means nothing can
 * answer two questions the monitoring UI has to answer:
 *
 *   1. What KIND of thing is this? A workflow, a cron job and a chat agent fail
 *      differently and are retried differently, so the UI badges them
 *      differently. That fact lives here, not in 24 call sites.
 *   2. What ISN'T reporting? A ledger can only show what wrote to it. Without a
 *      declared denominator, an empty queue is indistinguishable from a healthy
 *      one — which is the exact failure this whole feature exists to kill.
 *      `coverage()` diffs this list against the distinct agents actually seen.
 *
 * MAINTENANCE
 * -----------
 * Adding a surface here does NOT instrument it; it declares that it SHOULD be
 * instrumented. A surface listed here with no runs shows up as a coverage gap,
 * loudly. That asymmetry is deliberate: forgetting to add the registry entry
 * costs you a label, forgetting to instrument costs you the alarm.
 */

/** How the surface is executed. Drives the badge and the retry expectations. */
export const SURFACE_KINDS = ["workflow", "durable-object", "cron", "mcp"] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export interface SurfaceDef {
  /** Stable slug — MUST match the `agent` passed to `startRun`. */
  agent: string;
  /** Human label for the UI. */
  label: string;
  kind: SurfaceKind;
  /** Where it lives, so a coverage gap is actionable without a grep. */
  file: string;
  /**
   * Roughly how often this should produce runs when healthy. Used only to
   * soften the coverage report: a surface that legitimately runs monthly must
   * not be reported as "broken" because it has no runs today.
   */
  cadence: "continuous" | "hourly" | "daily" | "weekly" | "on-demand";
  /** One line on what it does — rendered in the coverage table. */
  purpose: string;
}

/**
 * All 24 surfaces.
 *
 * Sourced from `wrangler.jsonc` (workflows :93-139, durable objects :370-439,
 * cron triggers :156) and the `scheduled()` handler in `src/_worker.ts`.
 */
export const AGENT_SURFACES: SurfaceDef[] = [
  // ── Workflows ─────────────────────────────────────────────────────────────
  {
    agent: "showroom-research",
    label: "Showroom Scrape",
    kind: "workflow",
    file: "src/backend/services/showroom-scrape-workflow.ts",
    cadence: "on-demand",
    purpose: "Crawl a showroom site, extract brands, categories and access level.",
  },
  {
    agent: "brand-research",
    label: "Brand Research",
    kind: "workflow",
    file: "src/backend/services/brand-research-workflow.ts",
    cadence: "on-demand",
    purpose: "Deep-research a brand, scrape its site, harvest imagery and catalogs.",
  },
  {
    agent: "product-research",
    label: "Product Research",
    kind: "workflow",
    file: "src/backend/services/product-research-workflow.ts",
    cadence: "on-demand",
    purpose: "Deep-research a product, scrape its page, persist specs and photos.",
  },
  {
    agent: "image-processing",
    label: "Image Processing",
    kind: "workflow",
    file: "src/backend/services/image-processor/workflow.ts",
    cadence: "continuous",
    purpose: "Vision-describe, analyze, embed and index one uploaded image.",
  },
  {
    agent: "image-batch",
    label: "Image Batch",
    kind: "workflow",
    file: "src/backend/services/image-processor/batch-workflow.ts",
    cadence: "on-demand",
    purpose: "Fan out image processing across an upload batch.",
  },
  {
    agent: "deep-research-job",
    label: "Deep Research Job",
    kind: "workflow",
    file: "src/backend/services/deep-research-job-workflow.ts",
    cadence: "on-demand",
    purpose: "Run a multi-step research job: plan, research, extract, cross-check.",
  },
  {
    agent: "blank-canvas-batch",
    label: "Blank Canvas Batch",
    kind: "workflow",
    file: "src/backend/services/render/blank-canvas-batch-workflow.ts",
    cadence: "on-demand",
    purpose: "Generate blank-canvas renders for a batch of listing photos.",
  },
  {
    agent: "checklist-rationale",
    label: "Checklist Rationale",
    kind: "workflow",
    file: "src/backend/services/checklist-rationale-workflow.ts",
    cadence: "daily",
    purpose: "Draft rationale for questionnaire answers. The only cron-dispatched workflow.",
  },
  {
    agent: "showroom-onboarding",
    label: "Showroom Onboarding",
    kind: "workflow",
    file: "src/backend/services/showroom-onboarding-workflow.ts",
    cadence: "on-demand",
    purpose: "Enrich a newly imported showroom before its first scrape.",
  },

  // ── Durable Object agents ─────────────────────────────────────────────────
  {
    agent: "remodel-orchestrator",
    label: "Remodel Orchestrator",
    kind: "durable-object",
    file: "src/backend/ai/agents/RemodelOrchestrator/index.ts",
    cadence: "hourly",
    purpose:
      "Self-scheduling 4h project audit. Source of the cf_agents_schedules runaway — watch its run rate.",
  },
  {
    agent: "showroom-backfill",
    label: "Showroom Backfill Queue",
    kind: "durable-object",
    file: "src/backend/ai/agents/ShowroomResearchAgent/index.ts",
    cadence: "on-demand",
    purpose: "Agents-SDK queue task enriching one showroom end to end.",
  },
  {
    agent: "deep-research-agent",
    label: "Deep Research Agent",
    kind: "durable-object",
    file: "src/backend/ai/agents/DeepResearchAgent/index.ts",
    cadence: "on-demand",
    purpose: "Six-agent research loop over a topic.",
  },
  {
    agent: "research-agent",
    label: "Research Agent",
    kind: "durable-object",
    file: "src/backend/ai/agents/ResearchAgent/index.ts",
    cadence: "on-demand",
    purpose: "Plan-then-execute research with a human approval gate.",
  },
  {
    agent: "showroom-scout",
    label: "Showroom Scout",
    kind: "durable-object",
    file: "src/backend/ai/agents/showroom-scout/index.ts",
    cadence: "on-demand",
    purpose: "OpenAI-Agents loop that finds candidate showrooms and plans a drive.",
  },
  {
    agent: "permit-intelligence",
    label: "Permit Intelligence",
    kind: "durable-object",
    file: "src/backend/ai/agents/PermitIntelligenceAgent/index.ts",
    cadence: "on-demand",
    purpose: "Resolve contractor name variations against SF DBI permit records.",
  },
  {
    agent: "renovation-agent",
    label: "Renovation Agent",
    kind: "durable-object",
    file: "src/backend/ai/agents/RenovationAgent/index.ts",
    cadence: "on-demand",
    purpose: "Analyze uploads, observe rooms and style themes.",
  },
  {
    agent: "bid-portfolio-agent",
    label: "Bid Portfolio Agent",
    kind: "durable-object",
    file: "src/backend/ai/agents/BidPortfolioAgent/index.ts",
    cadence: "on-demand",
    purpose: "Vendor-facing chat over a scoped bid portfolio.",
  },
  {
    agent: "admin-chat-agent",
    label: "Admin Chat Agent",
    kind: "durable-object",
    file: "src/backend/ai/agents/AdminChatAgent/index.ts",
    cadence: "on-demand",
    purpose: "Admin-side chat across Workers AI models.",
  },
  {
    agent: "budget-agent",
    label: "Budget Agent",
    kind: "durable-object",
    file: "src/backend/ai/agents/BudgetAgent/index.ts",
    cadence: "on-demand",
    purpose: "Budget chat with a financial matrix tool run in a dynamic isolate.",
  },

  // ── Cron jobs ─────────────────────────────────────────────────────────────
  {
    agent: "cron-permit-sync",
    label: "Permit Sync",
    kind: "cron",
    file: "src/_worker.ts (0 14 * * *)",
    cadence: "daily",
    purpose: "Pull new SF DBI permit records.",
  },
  {
    agent: "cron-image-auto-heal",
    label: "Image Auto-Heal",
    kind: "cron",
    file: "src/backend/services/image-processor/auto-heal.ts",
    cadence: "continuous",
    purpose: "Requeue images stuck on transient Workers AI capacity errors (3040).",
  },
  {
    agent: "cron-places-backfill",
    label: "Showroom Places Backfill",
    kind: "cron",
    file: "src/_worker.ts (* * * * *)",
    cadence: "continuous",
    purpose: "Fill missing Google Places data on showrooms, a few per tick.",
  },
  {
    agent: "cron-sourcing-coverage",
    label: "Sourcing Coverage Monitor",
    kind: "cron",
    file: "src/_worker.ts (* * * * *)",
    cadence: "continuous",
    purpose: "Watch for material categories with no sourced showroom.",
  },
  {
    agent: "cron-gmail-ingest",
    label: "Gmail Ingest",
    kind: "cron",
    file: "src/_worker.ts (15 */4 * * *)",
    cadence: "hourly",
    purpose: "Ingest company email threads into the comms hub.",
  },
  {
    agent: "cron-sales-sweep",
    label: "Showroom Sales Sweep",
    kind: "cron",
    file: "src/_worker.ts (30 13 * * 1)",
    cadence: "weekly",
    purpose: "Weekly clearance and sale sweep across tracked showrooms.",
  },
  {
    agent: "cron-tesla-poll",
    label: "Tesla Drive Poll",
    kind: "cron",
    file: "src/_worker.ts (* * * * *)",
    cadence: "continuous",
    purpose: "Poll the vehicle while a drive is active.",
  },

  // ── MCP ───────────────────────────────────────────────────────────────────
  {
    agent: "mcp",
    label: "MCP Connector",
    kind: "mcp",
    file: "src/backend/mcp/agent.ts",
    cadence: "on-demand",
    purpose:
      "Claude's tool surface. Per-call logging already lives in mcp_tool_invocations; runs are recorded only for multi-step tools.",
  },
];

const BY_AGENT = new Map(AGENT_SURFACES.map((s) => [s.agent, s]));

/** Look up a surface by its ledger slug. */
export function surfaceOf(agent: string): SurfaceDef | undefined {
  return BY_AGENT.get(agent);
}

/**
 * Badge kind for a run.
 *
 * Prefers the registry, then falls back to what the run itself claims. An
 * unregistered agent still renders — it just renders as its trigger source,
 * which is honest, rather than being hidden.
 */
export function kindForRun(agent: string, triggeredBy?: string | null): SurfaceKind | "user" {
  const s = BY_AGENT.get(agent);
  if (s) return s.kind;
  if (triggeredBy === "cron") return "cron";
  if (triggeredBy === "mcp") return "mcp";
  return "user";
}

/** Display label, falling back to the raw slug so nothing ever renders blank. */
export function labelForAgent(agent: string): string {
  return BY_AGENT.get(agent)?.label ?? agent;
}

/** Total declared surfaces — the denominator in the coverage report. */
export const SURFACE_COUNT = AGENT_SURFACES.length;
