import type { GoogleGenAI } from "@google/genai";

import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

export const GEMINI_DEEP_RESEARCH_AGENT = "deep-research-preview-04-2026" as const;
export const GEMINI_DEEP_RESEARCH_MAX_AGENT = "deep-research-max-preview-04-2026" as const;

const INTERACTIONS_API_VERSION = "v1beta";
const INTERACTIONS_API_REVISION = "2026-05-20";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_WAIT_MS = 8 * 60_000;
const RESEARCH_MCP_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export type DeepResearchAgentMode = "standard" | "max";
export type DeepResearchVisualization = "auto" | "off";
export type DeepResearchScopeType = "session" | "product" | "store" | "category";

export interface DeepResearchMcpScope {
  type: DeepResearchScopeType;
  id: number;
  sessionId?: number;
  productId?: number;
  storeId?: number;
  categoryId?: number;
  interactionId?: string;
}

export interface DeepResearchMcpToolConfig {
  type: "mcp_server";
  name: string;
  url: string;
  headers: Record<string, string>;
  allowed_tools: string[];
}

export interface DeepResearchMcpTokenRecord {
  scope: DeepResearchMcpScope;
  issuedAt: string;
  expiresAt: string;
}

export interface CreateDeepResearchInteractionInput {
  prompt: string;
  mode?: DeepResearchAgentMode;
  visualization?: DeepResearchVisualization;
  thinkingSummaries?: "auto" | "none";
  collaborativePlanning?: boolean;
  previousInteractionId?: string;
  tools?: Array<Record<string, unknown>>;
}

export interface DeepResearchPollResult {
  id: string;
  status: string;
  outputText: string;
  interaction: any;
}

export interface DeepResearchCitationPlan {
  reportMarkdown: string;
  citationUrls: string[];
}

function deepResearchAgent(mode: DeepResearchAgentMode | undefined): string {
  return mode === "max" ? GEMINI_DEEP_RESEARCH_MAX_AGENT : GEMINI_DEEP_RESEARCH_AGENT;
}

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    try {
      const normalized = new URL(text).toString();
      if (!out.includes(normalized)) out.push(normalized);
    } catch {
      // Ignore non-URL text extracted from model output.
    }
  }
  return out;
}

function collectUrlsFromUnknown(value: unknown, urls: string[]) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s)\]}>"']+/g)) {
      urls.push(match[0].replace(/[.,;:]+$/g, ""));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectUrlsFromUnknown(item, urls);
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectUrlsFromUnknown(item, urls);
    }
  }
}

export function extractCitationUrlsFromInteraction(interaction: any): string[] {
  const urls: string[] = [];
  collectUrlsFromUnknown(interaction?.output_text, urls);
  collectUrlsFromUnknown(interaction?.steps, urls);
  return uniqueUrls(urls);
}

export async function createDeepResearchInteraction(
  env: Env,
  input: CreateDeepResearchInteractionInput,
): Promise<any> {
  const ai = (await createGeminiAiGatewayClient(env)) as GoogleGenAI & {
    interactions: {
      create: (body: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>;
    };
  };

  const body: Record<string, unknown> = {
    api_version: INTERACTIONS_API_VERSION,
    input: input.prompt,
    agent: deepResearchAgent(input.mode),
    background: true,
    agent_config: {
      type: "deep-research",
      thinking_summaries: input.thinkingSummaries ?? "auto",
      visualization: input.visualization ?? "off",
      collaborative_planning: input.collaborativePlanning ?? false,
    },
    tools: input.tools ?? [
      { type: "google_search" },
      { type: "url_context" },
      { type: "code_execution" },
    ],
  };

  if (input.previousInteractionId) {
    body.previous_interaction_id = input.previousInteractionId;
  }

  return ai.interactions.create(body, {
    headers: {
      "Api-Revision": INTERACTIONS_API_REVISION,
    },
    maxRetries: 2,
    timeout: 60_000,
  });
}

export async function getDeepResearchInteraction(
  env: Env,
  interactionId: string,
  params?: Record<string, unknown>,
): Promise<any> {
  const ai = (await createGeminiAiGatewayClient(env)) as GoogleGenAI & {
    interactions: {
      get: (id: string, params?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<any>;
    };
  };

  return ai.interactions.get(
    interactionId,
    {
      api_version: INTERACTIONS_API_VERSION,
      ...params,
    },
    {
      headers: {
        "Api-Revision": INTERACTIONS_API_REVISION,
      },
      maxRetries: 2,
      timeout: 60_000,
    },
  );
}

export async function pollDeepResearchInteraction(
  env: Env,
  interactionId: string,
  options: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    onStatus?: (interaction: any) => Promise<void> | void;
  } = {},
): Promise<DeepResearchPollResult> {
  const startedAt = Date.now();
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  while (Date.now() - startedAt < maxWaitMs) {
    const interaction = await getDeepResearchInteraction(env, interactionId);
    await options.onStatus?.(interaction);

    if (interaction.status === "completed") {
      return {
        id: interactionId,
        status: interaction.status,
        outputText: interaction.output_text ?? "",
        interaction,
      };
    }

    if (interaction.status === "failed") {
      throw new Error(
        `Deep Research failed: ${interaction.error?.message ?? interaction.error ?? "unknown error"}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Deep Research timed out after ${Math.trunc(maxWaitMs / 1000)} seconds`);
}

export async function runDeepResearchForCitationPlan(
  env: Env,
  prompt: string,
  options: {
    mode?: DeepResearchAgentMode;
    tools?: Array<Record<string, unknown>>;
    maxWaitMs?: number;
  } = {},
): Promise<DeepResearchCitationPlan> {
  const interaction = await createDeepResearchInteraction(env, {
    prompt,
    mode: options.mode,
    visualization: "off",
    tools: options.tools,
  });
  const result = await pollDeepResearchInteraction(env, interaction.id, {
    maxWaitMs: options.maxWaitMs,
  });

  return {
    reportMarkdown: result.outputText,
    citationUrls: extractCitationUrlsFromInteraction(result.interaction),
  };
}

// ─── Collaborative planning adapters (gate a) ─────────────────────────────────
//
// These isolate the Gemini `collaborative_planning` preview-API behavior so the
// rest of the plan-review flow does not depend on its exact field names. When a
// collaborative-planning interaction runs, Gemini emits a PLAN and pauses for the
// caller to approve or amend before executing the research. The precise
// representation of that paused state is a PREVIEW contract — keep edits to the
// field lookups below confined to these two functions, and smoke-test against the
// live API before relying on them in production.

/** A research plan surfaced by a collaborative-planning interaction. */
export interface DeepResearchPlan {
  interactionId: string;
  planMarkdown: string | null;
  /** True once the interaction is paused waiting on plan approval/feedback. */
  awaitingApproval: boolean;
  status: string;
}

/**
 * Best-effort extraction of the plan + paused-state from a raw interaction.
 *
 * VALIDATE AGAINST LIVE PREVIEW API: we look in the most likely places (a
 * dedicated `plan`/`research_plan` field, an "awaiting_plan"/"planning" status,
 * then `output_text`). Adjust only the field reads here once the real shape is
 * confirmed — callers consume the normalized `DeepResearchPlan`.
 */
export function extractPlanFromInteraction(interaction: any): DeepResearchPlan {
  const status: string = interaction?.status ?? "unknown";
  const planMarkdown: string | null =
    interaction?.plan?.markdown ??
    interaction?.plan ??
    interaction?.research_plan ??
    (status === "awaiting_plan_approval" || status === "awaiting_input" || status === "planning"
      ? (interaction?.output_text ?? null)
      : null);

  const awaitingApproval =
    status === "awaiting_plan_approval" ||
    status === "awaiting_input" ||
    Boolean(interaction?.plan && status !== "completed");

  return {
    interactionId: interaction?.id ?? "",
    planMarkdown: typeof planMarkdown === "string" ? planMarkdown : null,
    awaitingApproval,
    status,
  };
}

/**
 * Start a collaborative-planning interaction and poll until it pauses with a
 * plan (or terminates). Returns the normalized plan for homeowner review.
 */
export async function draftDeepResearchPlan(
  env: Env,
  input: { prompt: string; mode?: DeepResearchAgentMode; tools?: Array<Record<string, unknown>> },
  options: { maxWaitMs?: number; pollIntervalMs?: number; onStatus?: (i: any) => Promise<void> | void } = {},
): Promise<DeepResearchPlan> {
  const interaction = await createDeepResearchInteraction(env, {
    prompt: input.prompt,
    mode: input.mode,
    visualization: "off",
    collaborativePlanning: true,
    tools: input.tools,
  });

  const startedAt = Date.now();
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  while (Date.now() - startedAt < maxWaitMs) {
    const current = await getDeepResearchInteraction(env, interaction.id);
    await options.onStatus?.(current);

    if (current.status === "failed") {
      throw new Error(
        `Deep Research planning failed: ${current.error?.message ?? current.error ?? "unknown error"}`,
      );
    }

    const plan = extractPlanFromInteraction(current);
    // Pause as soon as a plan is available and the interaction is awaiting input.
    if (plan.awaitingApproval && plan.planMarkdown) return plan;
    // If it completed without pausing (planning disabled/ignored), surface the report as the plan.
    if (current.status === "completed") {
      return { ...plan, planMarkdown: plan.planMarkdown ?? current.output_text ?? "", awaitingApproval: false };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Deep Research planning timed out after ${Math.trunc(maxWaitMs / 1000)} seconds`);
}

/**
 * Continue a paused collaborative-planning interaction. On approval, the
 * follow-up input releases the research run; on a change request, the homeowner
 * feedback re-plans. Chained via `previous_interaction_id`.
 *
 * VALIDATE AGAINST LIVE PREVIEW API: the exact "proceed" input wording may need
 * tuning; behavior (re-plan vs execute) is driven by `collaborativePlanning`.
 */
export async function continueDeepResearchPlan(
  env: Env,
  previousInteractionId: string,
  decision:
    | { kind: "approve" }
    | { kind: "revise"; feedback: string },
  options: { mode?: DeepResearchAgentMode; tools?: Array<Record<string, unknown>> } = {},
): Promise<any> {
  const input =
    decision.kind === "approve"
      ? "The plan is approved. Proceed with the research exactly as planned."
      : `Please revise the research plan with this feedback before proceeding: ${decision.feedback}`;

  return createDeepResearchInteraction(env, {
    prompt: input,
    mode: options.mode,
    visualization: "off",
    // Approving releases the run (planning off); revising keeps planning on to re-draft.
    collaborativePlanning: decision.kind === "revise",
    previousInteractionId,
    tools: options.tools,
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function researchMcpTokenKey(token: string): string {
  return `research-mcp:${token}`;
}

export async function createResearchMcpToolConfig(
  env: Env,
  params: {
    serverUrl?: string | null;
    scope: DeepResearchMcpScope;
    allowedTools?: string[];
  },
): Promise<DeepResearchMcpToolConfig | null> {
  const serverUrl = params.serverUrl?.trim();
  if (!serverUrl || !env.CACHE) return null;

  const token = randomToken();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + RESEARCH_MCP_TOKEN_TTL_SECONDS * 1000);

  const record: DeepResearchMcpTokenRecord = {
    scope: params.scope,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await env.CACHE.put(researchMcpTokenKey(token), JSON.stringify(record), {
    expirationTtl: RESEARCH_MCP_TOKEN_TTL_SECONDS,
  });

  return {
    type: "mcp_server",
    name: "Core Remodel Research Bridge",
    url: serverUrl,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    allowed_tools: params.allowedTools ?? [
      "get_deep_research_context",
      "record_deep_research_progress",
      "record_deep_research_source",
    ],
  };
}
