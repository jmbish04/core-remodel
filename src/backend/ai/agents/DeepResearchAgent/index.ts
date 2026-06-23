/**
 * @fileoverview DeepResearchAgent — Engine B: self-hosted Deep Research on
 * Cloudflare Agents (a Durable Object).
 *
 * Ports the 6-agent iterative loop from `zyakita/gemini-deep-research-oss`:
 *   1) QNA           — clarifying questions (optional / informational)
 *   2) Research Lead — decompose the goal into broad tier-1 tasks
 *   3) Report Plan   — flat blueprint outline (search-grounded)
 *   4) Researcher    — per task: Gemini + Google Search grounding, findings + sources
 *   5) Research Deep — gap analysis → follow-up tasks (iterative, tiers 2..depth)
 *   6) Reporter      — synthesise the final data-verified markdown report
 *
 * It reuses Engine A's persistence path so the Phase 6 portal is engine-agnostic:
 * the SAME `research_sessions` row (engine = "cf"), the SAME R2 keys, the SAME
 * Vectorize namespace via `embedAndUpsertChunks`, ending at status "complete".
 *
 * Entry points:
 *   @callable runDeepResearch(input)  — kicks the loop, returns immediately,
 *                                        runs the loop via ctx.waitUntil.
 *   @callable getStatus(sessionId)    — poll D1 for the session row.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable } from "agents";
import { streamText, convertToModelMessages } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";
import {
  chunkMarkdown,
  embedAndUpsertChunks,
  generateVisualizerWebapp,
} from "@backend/ai/agents/ResearchAgent/methods";
import {
  r2MarkdownKey,
  r2WebappKey,
  vectorNamespace,
} from "@backend/ai/agents/ResearchAgent/types";

import {
  runQnaAgent,
  runReportPlanAgent,
  runReporterAgent,
  runResearchDeepAgent,
  runResearcherAgent,
  runResearchLeadAgent,
} from "./methods/agent-steps";
import {
  cfEngineConfigSchema,
  DEFAULT_CF_ENGINE_CONFIG,
  DEFAULT_DEEP_RESEARCH_STATE,
  runDeepResearchInputSchema,
  type CfEngineConfig,
  type CfPhase,
  type CfResearchTask,
  type DeepResearchAgentState,
  type RunDeepResearchInput,
} from "./types";

const MAX_FINDINGS_DIGEST_CHARS = 12_000;

/**
 * Extract the numeric session id from a `cf-research-{id}` DO name. Returns
 * `null` for any name that doesn't match the expected shape (or yields a
 * non-finite number), so callers never query Vectorize with a bogus namespace.
 */
function parseSessionIdFromName(name: string | undefined): number | null {
  if (!name) return null;
  const match = /^cf-research-(\d+)$/.exec(name);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function buildBasePrompt(input: RunDeepResearchInput): string {
  if (input.prompt?.trim()) return input.prompt.trim();
  return `Conduct a comprehensive sourcing-research report for this Bay Area renovation topic: "${input.topic}". Cover product/material categories, specifications, finishes, dimensions, price ranges, lead times, warranty terms, installation requirements, and which Bay-Area showrooms or shippable vendors carry the relevant lines.`;
}

function findingsDigest(findings: CfResearchTask[]): string {
  let digest = "";
  for (const t of findings) {
    if (!t.learning?.trim()) continue;
    const block = `## ${t.title}\n${t.learning}\n`;
    if (digest.length + block.length > MAX_FINDINGS_DIGEST_CHARS) break;
    digest += block;
  }
  return digest || "No findings gathered yet.";
}

/** Run an array of async thunks with a fixed concurrency cap. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index], index);
    await next();
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(next());
  }
  await Promise.all(runners);
}

export class DeepResearchAgent extends AIChatAgent<Env, DeepResearchAgentState> {
  static docsMetadata() {
    return {
      name: "DeepResearchAgent",
      className: "DeepResearchAgent",
      description:
        "Engine B — self-hosted Deep Research on Cloudflare Agents. Ports the " +
        "6-agent iterative loop (QNA → Research Lead → Report Plan → Researcher " +
        "→ Research Deep/gap → Reporter) from gemini-deep-research-oss, running " +
        "Gemini + Google Search grounding through AI Gateway. Emits the same " +
        "R2 markdown + Vectorize + visualizer output contract as Engine A.",
      docsPath: "/docs/agents/cf-deep-research",
      methods: [
        {
          name: "runDeepResearch",
          description: "Kick off the 6-agent iterative research loop",
          params: "input: RunDeepResearchInput",
          returns: "{ sessionId, status }",
        },
        {
          name: "getStatus",
          description: "Poll D1 for the research session row",
          params: "sessionId: number",
          returns: "ResearchSession | null",
        },
      ],
      tools: [
        "Gemini (core + task models) via AI Gateway",
        "Google Search + URL context grounding (researcher)",
        "Code execution (reporter, for verified numbers)",
        "Workers AI bge-large-en-v1.5 (embeddings)",
        "R2 (markdown + visualizer)",
        "Vectorize (research:{sessionId} namespace)",
        "D1 (research_sessions index, engine = cf)",
      ],
    };
  }

  initialState: DeepResearchAgentState = { ...DEFAULT_DEEP_RESEARCH_STATE };

  private getDb() {
    return drizzle(this.env.DB);
  }

  private update(
    phase: CfPhase,
    progress: string,
    extras?: Partial<DeepResearchAgentState>,
  ) {
    this.setState({
      ...this.state,
      phase,
      progress,
      ...extras,
    } as DeepResearchAgentState);
  }

  /** Persist the live loop state into the D1 row (cf_engine_state JSON). */
  private async persistState(sessionId: number) {
    try {
      await this.getDb()
        .update(researchSessions)
        .set({ cfEngineState: JSON.stringify(this.state) })
        .where(eq(researchSessions.id, sessionId));
    } catch (err) {
      console.error("Failed to persist cf engine state:", err);
    }
  }

  // -------------------------------------------------------------------------
  // @callable: kick off the loop
  // -------------------------------------------------------------------------

  @callable()
  async runDeepResearch(rawInput: RunDeepResearchInput) {
    const input = runDeepResearchInputSchema.parse(rawInput);
    const config: CfEngineConfig = {
      ...DEFAULT_CF_ENGINE_CONFIG,
      ...cfEngineConfigSchema.partial().parse(input.config ?? {}),
    };

    const db = this.getDb();
    await db
      .update(researchSessions)
      .set({
        engine: "cf",
        status: "researching",
        cfEngineConfig: JSON.stringify(config),
      })
      .where(eq(researchSessions.id, input.sessionId));

    this.update("clarifying", "Starting Engine B deep research...", {
      sessionId: input.sessionId,
      topic: input.topic,
      maxTier: config.depth,
      currentTier: 0,
      tasksTotal: 0,
      tasksDone: 0,
      sourcesCount: 0,
      chunkCount: 0,
      questions: [],
    });

    // Run the long loop in the background; return the job id immediately.
    this.ctx.waitUntil(this.runLoop(input, config));
    return { sessionId: input.sessionId, status: "researching" as const };
  }

  // -------------------------------------------------------------------------
  // The 6-agent orchestration loop
  // -------------------------------------------------------------------------

  private async runLoop(input: RunDeepResearchInput, config: CfEngineConfig) {
    const db = this.getDb();
    const sessionId = input.sessionId;
    const query = buildBasePrompt(input);

    try {
      const ai = await createGeminiAiGatewayClient(this.env);
      const allFindings: CfResearchTask[] = [];
      const sourceSet = new Set<string>();

      // ── 1) QNA (optional) ────────────────────────────────────────────
      if (!config.skipClarifyingQuestions) {
        this.update("clarifying", "Generating clarifying questions...");
        try {
          const questions = await runQnaAgent(
            ai,
            config.coreModel,
            config.thinkingBudget,
            query,
          );
          this.update("clarifying", `Surfaced ${questions.length} questions`, {
            questions,
          });
        } catch (err) {
          console.warn("QNA step failed (non-fatal):", err);
        }
        await this.persistState(sessionId);
      }

      // ── 3) REPORT PLAN ───────────────────────────────────────────────
      this.update("report_plan", "Drafting the report plan...");
      const reportPlan = await runReportPlanAgent(
        ai,
        config.coreModel,
        config.thinkingBudget,
        { query, qna: this.state.questions },
      );
      this.update("report_plan", "Report plan ready", { reportPlan });
      await db
        .update(researchSessions)
        .set({ researchPlan: reportPlan })
        .where(eq(researchSessions.id, sessionId));
      await this.persistState(sessionId);

      // ── 2 + 5 + 4) Iterative research rounds ─────────────────────────
      for (let tier = 1; tier <= config.depth; tier++) {
        this.update(
          tier === 1 ? "planning_lead" : "gap_analysis",
          tier === 1
            ? "Decomposing into research tasks..."
            : `Analysing gaps for round ${tier}...`,
          { currentTier: tier },
        );

        const tasks =
          tier === 1
            ? await runResearchLeadAgent(
                ai,
                config.coreModel,
                config.thinkingBudget,
                query,
                config.wide,
              )
            : await runResearchDeepAgent(ai, config.coreModel, config.thinkingBudget, {
                reportPlan,
                findingsDigest: findingsDigest(allFindings),
                tier,
                limit: config.wide,
              });

        if (tasks.length === 0) {
          // No gaps — research converged early.
          this.update("gap_analysis", `Research converged at round ${tier}`, {
            currentTier: tier - 1,
          });
          break;
        }

        this.update("researching", `Running ${tasks.length} tasks (round ${tier})`, {
          tasksTotal: this.state.tasksTotal + tasks.length,
        });
        await this.persistState(sessionId);

        // ── Researcher fan-out with bounded concurrency ────────────────
        await runWithConcurrency(tasks, config.parallelSearch, async (task) => {
          task.status = "running";
          try {
            const result = await runResearcherAgent(
              ai,
              config.taskModel,
              config.thinkingBudget,
              task,
              { query, reportPlan },
            );
            task.learning = result.learning;
            task.sources = result.sources;
            task.status = "done";
            for (const url of result.sources) sourceSet.add(url);
          } catch (err) {
            task.status = "failed";
            task.learning = "";
            console.error(`Researcher task failed: ${task.title}`, err);
          }
          allFindings.push(task);
          this.update("researching", `Completed ${task.title}`, {
            tasksDone: this.state.tasksDone + 1,
            sourcesCount: sourceSet.size,
          });
        });

        await this.persistState(sessionId);
      }

      const usableFindings = allFindings.filter((t) => t.learning?.trim());
      if (usableFindings.length === 0) {
        throw new Error("Engine B gathered no usable findings");
      }

      // ── 6) REPORTER ──────────────────────────────────────────────────
      this.update("reporting", "Synthesising the final report...");
      const markdown = await runReporterAgent(ai, config.coreModel, config, {
        query,
        qna: this.state.questions,
        reportPlan,
        findings: usableFindings,
      });

      if (!markdown || markdown.length < 200) {
        throw new Error("Engine B reporter returned insufficient content");
      }

      // ── Finalise via the SAME contract as Engine A ───────────────────
      await this.finalize(sessionId, input.topic, markdown);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown Engine B failure";
      console.error("Engine B loop failed:", error);
      await db
        .update(researchSessions)
        .set({ status: "failed", errorMessage })
        .where(eq(researchSessions.id, sessionId));
      this.update("failed", `Engine B failed: ${errorMessage}`, { errorMessage });
      await this.persistState(sessionId);
    }
  }

  // -------------------------------------------------------------------------
  // Finalise: R2 markdown + Vectorize + visualizer (shared Engine-A contract)
  // -------------------------------------------------------------------------

  private async finalize(sessionId: number, topic: string, markdown: string) {
    const db = this.getDb();

    // ── R2 markdown ──────────────────────────────────────────────────
    this.update("reporting", "Saving report to R2...");
    const markdownKey = r2MarkdownKey(sessionId);
    await this.env.ARTIFACTS_BUCKET.put(markdownKey, markdown, {
      httpMetadata: { contentType: "text/markdown" },
      customMetadata: { sessionId: String(sessionId), topic, engine: "cf" },
    });
    await db
      .update(researchSessions)
      .set({ r2MarkdownKey: markdownKey })
      .where(eq(researchSessions.id, sessionId));

    // ── Vectorize (research:{sessionId}) ─────────────────────────────
    this.update("embedding", "Embedding chunks into Vectorize...");
    await db
      .update(researchSessions)
      .set({ status: "embedding" })
      .where(eq(researchSessions.id, sessionId));
    const { chunks } = chunkMarkdown(markdown);
    const embedResult = await embedAndUpsertChunks(this.env, chunks, sessionId);
    await db
      .update(researchSessions)
      .set({
        vectorNamespace: embedResult.namespace,
        chunkCount: embedResult.chunkCount,
      })
      .where(eq(researchSessions.id, sessionId));
    this.update("embedding", `Embedded ${embedResult.chunkCount} chunks`, {
      chunkCount: embedResult.chunkCount,
    });

    // ── Visualizer ───────────────────────────────────────────────────
    this.update("generating", "Generating interactive visualizer...");
    await db
      .update(researchSessions)
      .set({ status: "generating" })
      .where(eq(researchSessions.id, sessionId));
    try {
      const html = await generateVisualizerWebapp(this.env, topic, markdown);
      const webappKey = r2WebappKey(sessionId);
      await this.env.ARTIFACTS_BUCKET.put(webappKey, html, {
        httpMetadata: { contentType: "text/html" },
        customMetadata: { sessionId: String(sessionId), topic, engine: "cf" },
      });
      await db
        .update(researchSessions)
        .set({ r2WebappKey: webappKey })
        .where(eq(researchSessions.id, sessionId));
    } catch (err) {
      // Visualizer is best-effort — a missing one must not fail the run.
      console.error("Engine B visualizer generation failed (non-fatal):", err);
    }

    // ── Complete ─────────────────────────────────────────────────────
    await db
      .update(researchSessions)
      .set({ status: "complete", completedAt: new Date() })
      .where(eq(researchSessions.id, sessionId));
    this.update("complete", "Engine B research complete.", {
      vectorNamespace: vectorNamespace(sessionId),
    } as Partial<DeepResearchAgentState>);
    await this.persistState(sessionId);
  }

  // -------------------------------------------------------------------------
  // @callable: poll status
  // -------------------------------------------------------------------------

  @callable()
  async getStatus(sessionId: number) {
    const [session] = await this.getDb()
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId))
      .limit(1);
    return session ?? null;
  }

  // -------------------------------------------------------------------------
  // Chat: RAG over the Engine-B findings (shares the research:{id} namespace)
  // -------------------------------------------------------------------------

  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // Prefer the persisted state (set during `runDeepResearch`); fall back to
    // parsing the DO name only when it matches the expected `cf-research-{id}`
    // shape, so a malformed `this.name` never yields a bogus namespace query.
    const sessionId =
      typeof this.state.sessionId === "number" &&
      Number.isFinite(this.state.sessionId)
        ? this.state.sessionId
        : parseSessionIdFromName(this.name);
    let ragContext = "";

    if (sessionId !== null) {
      try {
        const lastMessage = this.messages[this.messages.length - 1];
        const queryText =
          lastMessage?.parts
            ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join(" ") || "summarize the research";

        const queryEmbedding = (await this.env.AI.run(
          "@cf/baai/bge-large-en-v1.5",
          { text: [queryText] },
          { gateway: { id: this.env.AI_GATEWAY_ID } },
        )) as { data: number[][] };

        const results = await this.env.RESEARCH_INDEX.query(
          queryEmbedding.data[0],
          { topK: 8, namespace: vectorNamespace(sessionId), returnMetadata: "all" },
        );

        const chunks = (results.matches ?? [])
          .filter((m) => (m.score ?? 0) > 0.5)
          .map((m) => (m.metadata as Record<string, unknown>)?.textPreview as string)
          .filter(Boolean);

        if (chunks.length > 0) {
          ragContext = `\n\nRELEVANT RESEARCH CONTEXT:\n${chunks
            .map((c, i) => `[${i + 1}] ${c}`)
            .join("\n\n")}`;
        }
      } catch (err) {
        console.error("Engine B RAG retrieval failed:", err);
      }
    }

    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct"),
      system: `You are a renovation sourcing research assistant. Answer with specific, quantitative, actionable detail and reference the research context when available.${ragContext}`,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onFinish,
    });
    return result.toUIMessageStreamResponse();
  }
}
