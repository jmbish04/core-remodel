/**
 * @fileoverview The six Engine-B agent steps as plain async functions.
 *
 * Each wraps a Gemini call through the AI Gateway (`createGeminiAiGatewayClient`)
 * exactly as `ShowroomResearchAgent/methods/deep-sweep.ts` does, reusing the
 * Google-Search-grounding pattern from the OSS `researcher` agent. Structured
 * steps use `responseMimeType: "application/json"` + a responseSchema, mirroring
 * the OSS agents 1:1; the researcher step uses `googleSearch` + `urlContext`
 * grounding and returns findings text plus extracted source URLs.
 */

import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

import {
  LANGUAGE_REQUIREMENT_PROMPT,
  QNA_PROMPT,
  REPORT_PLAN_PROMPT,
  RESEARCHER_PROMPT,
  RESEARCH_DEEP_PROMPT,
  RESEARCH_LEAD_PROMPT,
  currentDateTimePrompt,
  reporterPrompt,
} from "../prompts";
import type {
  CfClarifyingQuestion,
  CfEngineConfig,
  CfResearchTask,
  CfResearchTarget,
} from "../types";

type GeminiClient = Awaited<ReturnType<typeof createGeminiAiGatewayClient>>;

const TARGET_ENUM: CfResearchTarget[] = [
  "WEB",
  "ACADEMIC",
  "SOCIAL",
  "FILE_UPLOAD",
];

function systemInstruction(prompt: string) {
  return {
    parts: [
      { text: prompt },
      { text: currentDateTimePrompt() },
      { text: LANGUAGE_REQUIREMENT_PROMPT },
    ],
  };
}

function cleanupJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

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

function normalizeTarget(value: unknown): CfResearchTarget {
  return TARGET_ENUM.includes(value as CfResearchTarget)
    ? (value as CfResearchTarget)
    : "WEB";
}

// ---------------------------------------------------------------------------
// 1. QNA
// ---------------------------------------------------------------------------

export async function runQnaAgent(
  ai: GeminiClient,
  model: string,
  thinkingBudget: number,
  query: string,
): Promise<CfClarifyingQuestion[]> {
  const response = (await ai.models.generateContent({
    model,
    config: {
      thinkingConfig: { thinkingBudget },
      systemInstruction: systemInstruction(QNA_PROMPT),
      responseMimeType: "application/json",
    },
    contents: [{ role: "user", parts: [{ text: query }] }],
  } as any)) as { text?: string };

  const parsed = safeJson<{ questions?: CfClarifyingQuestion[] }>(
    response.text ?? "",
    { questions: [] },
  );
  return (parsed.questions ?? []).filter(
    (q) => q && typeof q.question === "string",
  );
}

// ---------------------------------------------------------------------------
// 2 + 4. RESEARCH LEAD (tier 1) and RESEARCH DEEP (gap, tier > 1)
// ---------------------------------------------------------------------------

type TaskAgentResponse = {
  tasks: { title: string; direction: string; target: string }[];
};

async function runTaskAgent(
  ai: GeminiClient,
  model: string,
  thinkingBudget: number,
  systemPrompt: string,
  userContent: string,
  tier: number,
  limit: number,
): Promise<CfResearchTask[]> {
  const response = (await ai.models.generateContent({
    model,
    config: {
      thinkingConfig: { thinkingBudget },
      systemInstruction: systemInstruction(systemPrompt),
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          tasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                direction: { type: "STRING" },
                target: { type: "STRING", enum: TARGET_ENUM },
              },
              required: ["title", "direction", "target"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
  } as any)) as { text?: string };

  const parsed = safeJson<TaskAgentResponse>(response.text ?? "", { tasks: [] });
  return (parsed.tasks ?? []).slice(0, limit).map((t) => ({
    tier,
    title: String(t.title ?? "Untitled task"),
    direction: String(t.direction ?? ""),
    target: normalizeTarget(t.target),
    status: "pending" as const,
  }));
}

export function runResearchLeadAgent(
  ai: GeminiClient,
  model: string,
  thinkingBudget: number,
  query: string,
  limit: number,
): Promise<CfResearchTask[]> {
  return runTaskAgent(
    ai,
    model,
    thinkingBudget,
    RESEARCH_LEAD_PROMPT,
    `High-level renovation sourcing goal:\n\n${query}`,
    1,
    limit,
  );
}

export function runResearchDeepAgent(
  ai: GeminiClient,
  model: string,
  thinkingBudget: number,
  args: { reportPlan: string; findingsDigest: string; tier: number; limit: number },
): Promise<CfResearchTask[]> {
  const userContent = `REPORT_PLAN:\n${args.reportPlan}\n\nFINDINGS SO FAR (digest):\n${args.findingsDigest}\n\nIdentify gaps and emit follow-up research tasks. If the findings already satisfy the plan, return an empty tasks array.`;
  return runTaskAgent(
    ai,
    model,
    thinkingBudget,
    RESEARCH_DEEP_PROMPT,
    userContent,
    args.tier,
    args.limit,
  );
}

// ---------------------------------------------------------------------------
// 3. REPORT PLAN — flat outline (uses search grounding to fill gaps)
// ---------------------------------------------------------------------------

export async function runReportPlanAgent(
  ai: GeminiClient,
  model: string,
  thinkingBudget: number,
  args: { query: string; qna: CfClarifyingQuestion[] },
): Promise<string> {
  const qnaText =
    args.qna.length > 0
      ? args.qna
          .map((q) => `Q: ${q.question}\nDirection: ${q.suggestedRefinement}`)
          .join("\n\n")
      : "none";

  const response = (await ai.models.generateContent({
    model,
    config: {
      thinkingConfig: { thinkingBudget },
      systemInstruction: systemInstruction(REPORT_PLAN_PROMPT),
      tools: [{ googleSearch: {} }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `QUERY:\n${args.query}\n\nCLARIFYING Q&A:\n${qnaText}\n\nProduce the flat research outline now.`,
          },
        ],
      },
    ],
  } as any)) as { text?: string };

  return (response.text ?? "").trim();
}

// ---------------------------------------------------------------------------
// 5. RESEARCHER — grounded retrieval, returns findings + source URLs
// ---------------------------------------------------------------------------

export interface ResearcherResult {
  learning: string;
  sources: string[];
  webSearchQueries: string[];
}

function extractSources(response: any): string[] {
  const urls = new Set<string>();
  for (const candidate of response?.candidates ?? []) {
    for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
      const uri = chunk?.web?.uri;
      if (typeof uri === "string" && uri.startsWith("http")) urls.add(uri);
    }
    for (const meta of candidate?.urlContextMetadata?.urlMetadata ?? []) {
      const uri = meta?.retrievedUrl ?? meta?.url;
      if (typeof uri === "string" && uri.startsWith("http")) urls.add(uri);
    }
  }
  return [...urls];
}

function extractWebQueries(response: any): string[] {
  const queries = new Set<string>();
  for (const candidate of response?.candidates ?? []) {
    for (const q of candidate?.groundingMetadata?.webSearchQueries ?? []) {
      if (typeof q === "string") queries.add(q);
    }
  }
  return [...queries];
}

export async function runResearcherAgent(
  ai: GeminiClient,
  model: string,
  thinkingBudget: number,
  task: CfResearchTask,
  context: { query: string; reportPlan: string },
  retryCount = 0,
): Promise<ResearcherResult> {
  const userContent = `OVERALL GOAL:\n${context.query}\n\nREPORT PLAN (for context):\n${context.reportPlan}\n\nYOUR SPECIFIC TASK:\n${task.direction}`;

  try {
    const response = (await ai.models.generateContent({
      model,
      config: {
        thinkingConfig: { thinkingBudget },
        systemInstruction: systemInstruction(RESEARCHER_PROMPT),
        tools: [{ urlContext: {} }, { googleSearch: {} }],
      },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
    } as any)) as any;

    return {
      learning: (response.text ?? "").trim(),
      sources: extractSources(response),
      webSearchQueries: extractWebQueries(response),
    };
  } catch (error) {
    if (retryCount < 2) {
      return runResearcherAgent(
        ai,
        model,
        thinkingBudget,
        task,
        context,
        retryCount + 1,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 6. REPORTER — synthesise the final markdown report
// ---------------------------------------------------------------------------

export async function runReporterAgent(
  ai: GeminiClient,
  model: string,
  config: CfEngineConfig,
  args: {
    query: string;
    qna: CfClarifyingQuestion[];
    reportPlan: string;
    findings: CfResearchTask[];
  },
): Promise<string> {
  const qnaText =
    args.qna.length > 0
      ? args.qna
          .map((q) => `Q: ${q.question}\nDirection: ${q.suggestedRefinement}`)
          .join("\n\n")
      : "none";

  const findingsText = args.findings
    .filter((t) => t.learning?.trim())
    .map((t, i) => {
      const sources = (t.sources ?? []).length
        ? `\nSources:\n${(t.sources ?? []).map((u) => `- ${u}`).join("\n")}`
        : "";
      return `### Finding ${i + 1}: ${t.title}\n${t.learning}${sources}`;
    })
    .join("\n\n");

  const userContent = `QUERY:\n${args.query}\n\nQ&A:\n${qnaText}\n\nREPORT_PLAN:\n${args.reportPlan}\n\nFINDINGS:\n${findingsText}`;

  const response = (await ai.models.generateContent({
    model,
    config: {
      thinkingConfig: { thinkingBudget: config.thinkingBudget },
      systemInstruction: systemInstruction(
        reporterPrompt(config.reportTone, config.minWords),
      ),
      tools: [{ codeExecution: {} }],
    },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
  } as any)) as { text?: string };

  return (response.text ?? "").trim();
}
