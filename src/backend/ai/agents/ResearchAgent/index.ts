/**
 * @fileoverview ResearchAgent — AI Deep Research Orchestrator
 *
 * Extends AIChatAgent from @cloudflare/ai-chat for the Cloudflare Agents SDK.
 * Provides:
 *   - @callable startResearch() — orchestrates the full Gemini deep research
 *     pipeline: prompt → R2 save → chunk → embed → generate visualizer
 *   - onChatMessage() — RAG-powered streaming chat over research findings
 *     using Vectorize semantic search + Gemini 2.5 Flash for low-latency
 *   - @callable getSessionStatus() — poll D1 for session status
 *   - @callable healthProbe() — verify all required bindings
 *
 * Model selection:
 *   Research + Visualizer gen: gemini-2.5-pro (quality)
 *   RAG chat streaming:       gemini-2.5-flash (latency)
 *   Embeddings:               @cf/baai/bge-large-en-v1.5 (Workers AI)
 *
 * All Gemini calls route through AI Gateway for usage tracking.
 * Embeddings strictly use env.AI.run() — no constructor pattern.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable } from "agents";
import { GoogleGenAI } from "@google/genai";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  researchSessions,
  researchPlanRevisions,
} from "@backend/db/schema/admin/research_sessions";
import {
  continueDeepResearchPlan,
  createDeepResearchInteraction,
  createResearchMcpToolConfig,
  draftDeepResearchPlan,
  GEMINI_DEEP_RESEARCH_AGENT,
  GEMINI_DEEP_RESEARCH_MAX_AGENT,
  getDeepResearchInteraction,
} from "@backend/services/gemini/deep-research";
import { annotatePlan } from "@backend/ai/plan-review/annotate-plan";
import {
  chunkMarkdown,
  embedAndUpsertChunks,
  generateVisualizerWebapp,
  buildChatDataTools,
} from "./methods";
import { runHealthProbe } from "./health";
import {
  type ResearchAgentState,
  DEFAULT_RESEARCH_STATE,
  type StartResearchInput,
  type StartResearchOptions,
  r2MarkdownKey,
  r2WebappKey,
  vectorNamespace,
} from "./types";

function normalizeStartResearchArgs(
  topicOrInput: string | StartResearchInput,
  sessionId?: number,
): StartResearchInput {
  if (typeof topicOrInput === "string") {
    if (!sessionId) {
      throw new Error("sessionId is required when startResearch is called with a topic string");
    }
    return {
      topic: topicOrInput,
      sessionId,
    };
  }

  return topicOrInput;
}

function researchPrompt(input: StartResearchInput): string {
  const basePrompt =
    input.prompt?.trim() ||
    `Conduct a comprehensive deep research report on the following topic: "${input.topic}".`;

  const plan = input.researchPlan?.trim();

  return `Conduct a comprehensive Deep Research report for this remodel planning topic.

Topic:
${input.topic}

User-reviewed prompt:
${basePrompt}

${plan ? `Approved research plan:\n${plan}` : "Approved research plan:\nnone"}

Requirements:
- Include specific numbers, percentages, price ranges, warranty details, lead-time notes, and vendor comparison points where available.
- Cite source URLs inline for factual claims.
- Prefer manufacturer, showroom, warranty, installation, pricing, and review sources.
- Format as clean Markdown with headers, bullet points, and tables where appropriate.
- Separate confirmed facts from inferred recommendations.`;
}

function progressTextFromInteraction(interaction: any): string {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as any;
    const content = Array.isArray(step?.content) ? step.content : [];
    for (let j = content.length - 1; j >= 0; j--) {
      const item = content[j] as any;
      if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
        return "Generating report...";
      }
      if (
        (item?.type === "thought" || item?.type === "thought_summary") &&
        typeof item.text === "string" &&
        item.text.trim()
      ) {
        return `Thinking: ${item.text.trim().slice(0, 240)}`;
      }
    }
  }
  return "Deep Research in progress...";
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ResearchAgent extends AIChatAgent<Env, ResearchAgentState> {
  // -------------------------------------------------------------------------
  // Metadata for /docs and /context endpoints
  // -------------------------------------------------------------------------

  static docsMetadata() {
    return {
      name: "ResearchAgent",
      className: "ResearchAgent",
      description:
        "AI Deep Research Orchestrator. Runs Gemini deep research, stores findings " +
        "in R2, embeds into Vectorize for RAG, generates interactive visualizer " +
        "webapps via Dynamic Workers, and provides contextual chat over findings.",
      docsPath: "/docs/agents/research",
      methods: [
        {
          name: "startResearch",
          description:
            "Kick off a full deep research pipeline: Gemini → R2 → Vectorize → Visualizer",
          params: "topic: string, sessionId: number",
          returns: "void (broadcasts progress via WebSocket state)",
        },
        {
          name: "getSessionStatus",
          description: "Get the current status of a research session from D1",
          params: "sessionId: number",
          returns: "ResearchSession | null",
        },
        {
          name: "healthProbe",
          description: "Verify all required bindings for the research pipeline",
          params: "none",
          returns: "HealthProbeResult",
        },
      ],
      tools: [
        `${GEMINI_DEEP_RESEARCH_AGENT} / ${GEMINI_DEEP_RESEARCH_MAX_AGENT} via Gemini Interactions API`,
        "Scoped MCP bridge for per-session context/progress/source callbacks",
        "Gemini 2.5 Pro (visualizer generation)",
        "Gemini 2.5 Flash (RAG chat streaming)",
        "Workers AI bge-large-en-v1.5 (embeddings via env.AI.run())",
        "R2 (markdown + visualizer storage)",
        "Vectorize (semantic search with session namespaces)",
        "D1 (research session index)",
        "Dynamic Workers (visualizer serving via env.LOADER)",
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Agent state — broadcast to connected clients via WebSocket
  // -------------------------------------------------------------------------

  initialState: ResearchAgentState = { ...DEFAULT_RESEARCH_STATE };

  private updateProgress(
    status: ResearchAgentState["status"],
    progress: string,
    extras?: Partial<ResearchAgentState>,
  ) {
    this.setState({
      ...this.state,
      status,
      progress,
      ...extras,
    } as ResearchAgentState);
  }

  // -------------------------------------------------------------------------
  // OnConnect - Check if we need to resume streaming
  // -------------------------------------------------------------------------
  
  onConnect() {
    if (
      this.state.interactionId && 
      this.state.status === "researching"
    ) {
      // Resume monitoring the background task if a client reconnects
      this.ctx.waitUntil(this.monitorResearchStream(this.state.interactionId, this.state.currentSessionId!));
    }
  }

  // Private: Gemini client factory
  // -------------------------------------------------------------------------

  private async getGeminiClient(): Promise<GoogleGenAI> {
    const geminiApiKey = await this.env.GEMINI_API_KEY.get();
    const cloudflareAccountId = await this.env.CLOUDFLARE_ACCOUNT_ID.get();
    const CF_AIG_TOKEN = await this.env.CLOUDFLARE_AI_GATEWAY_TOKEN.get();
    
    if (!CF_AIG_TOKEN) throw new Error("CLOUDFLARE_AI_GATEWAY_TOKEN not configured");
    if (!geminiApiKey) throw new Error("GEMINI_API_KEY not configured");
    if (!cloudflareAccountId) throw new Error("CLOUDFLARE_ACCOUNT_ID not configured");

    return new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${this.env.AI_GATEWAY_ID}/google-ai-studio`,
        headers: {
          "cf-aig-authorization": `Bearer ${CF_AIG_TOKEN}`,
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Private: D1 database accessor
  // -------------------------------------------------------------------------

  private getDb() {
    return drizzle(this.env.DB);
  }

  // -------------------------------------------------------------------------
  // @callable: Start Deep Research Pipeline
  // -------------------------------------------------------------------------

  @callable()
  async startResearch(
    topicOrInput: string | StartResearchInput,
    sessionIdArg?: number,
    legacyOptions?: StartResearchOptions,
  ): Promise<void> {
  const input = {
      ...normalizeStartResearchArgs(topicOrInput, sessionIdArg),
      ...legacyOptions,
    };
    const db = this.getDb();

    // HITL plan-review gate: draft a plan in the background and pause for the
    // homeowner. The straight-through path below is preserved for usePlanReview=false.
    if (input.usePlanReview) {
      this.ctx.waitUntil(this.draftPlanPhase(input));
      return;
    }

    try {
      this.updateProgress("researching", "Starting Gemini deep research...", {
        currentSessionId: input.sessionId,
        currentTopic: input.topic,
        mcpBridgeEnabled: input.enableMcpBridge ?? false,
      });

      await db
        .update(researchSessions)
        .set({
          status: "researching",
          interactionAgent:
            input.mode === "max"
              ? GEMINI_DEEP_RESEARCH_MAX_AGENT
              : GEMINI_DEEP_RESEARCH_AGENT,
          mcpBridgeEnabled: input.enableMcpBridge ?? false,
        })
        .where(eq(researchSessions.id, input.sessionId));

      const tools: Array<Record<string, unknown>> = [
        { type: "google_search" },
        { type: "url_context" },
        { type: "code_execution" },
      ];

      if (input.enableMcpBridge) {
        const mcpTool = await createResearchMcpToolConfig(this.env, {
          serverUrl: input.mcpServerUrl,
          scope: {
            type: "session",
            id: input.sessionId,
            sessionId: input.sessionId,
          },
        });
        if (mcpTool) tools.push(mcpTool as unknown as Record<string, unknown>);
      }

      const interaction = await createDeepResearchInteraction(this.env, {
        prompt: researchPrompt(input),
        mode: input.mode,
        visualization: input.visualization ?? "off",
        tools,
      });

      // Save the interaction ID so it can be resumed
      this.setState({
        ...this.state,
        interactionId: interaction.id,
        currentSessionId: input.sessionId,
        currentTopic: input.topic,
      });

      await db
        .update(researchSessions)
        .set({
          interactionId: interaction.id,
        })
        .where(eq(researchSessions.id, input.sessionId));

      // Process the stream asynchronously without blocking the RPC response
      this.ctx.waitUntil(this.monitorResearchStream(interaction.id, input.sessionId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await db.update(researchSessions).set({ status: "failed", errorMessage }).where(eq(researchSessions.id, input.sessionId));
      this.updateProgress("failed", `Failed to start research: ${errorMessage}`);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Plan-review gate (a)+(b): draft a collaborative plan, annotate it, pause
  // -------------------------------------------------------------------------

  /** Build the deep-research tool list (search/url/code + optional MCP bridge). */
  private async buildResearchTools(input: {
    enableMcpBridge?: boolean;
    mcpServerUrl?: string | null;
    sessionId: number;
  }): Promise<Array<Record<string, unknown>>> {
    const tools: Array<Record<string, unknown>> = [
      { type: "google_search" },
      { type: "url_context" },
      { type: "code_execution" },
    ];
    if (input.enableMcpBridge) {
      const mcpTool = await createResearchMcpToolConfig(this.env, {
        serverUrl: input.mcpServerUrl,
        scope: { type: "session", id: input.sessionId, sessionId: input.sessionId },
      });
      if (mcpTool) tools.push(mcpTool as unknown as Record<string, unknown>);
    }
    return tools;
  }

  /**
   * Draft (or, with feedback + previousInteractionId, re-draft) a research plan
   * via Gemini collaborative planning, have the onboard agent annotate it, then
   * pause at `awaiting_plan_approval`. Runs in the background (waitUntil).
   */
  private async draftPlanPhase(
    input: StartResearchInput,
    previousInteractionId?: string,
    feedback?: string,
  ): Promise<void> {
    const db = this.getDb();
    try {
      this.updateProgress(
        "planning",
        feedback ? "Revising research plan with your feedback..." : "Drafting a research plan...",
        {
          currentSessionId: input.sessionId,
          currentTopic: input.topic,
          mcpBridgeEnabled: input.enableMcpBridge ?? false,
          planStatus: "drafting",
        },
      );
      await db
        .update(researchSessions)
        .set({
          status: "planning",
          planStatus: "drafting",
          interactionAgent:
            input.mode === "max" ? GEMINI_DEEP_RESEARCH_MAX_AGENT : GEMINI_DEEP_RESEARCH_AGENT,
          mcpBridgeEnabled: input.enableMcpBridge ?? false,
        })
        .where(eq(researchSessions.id, input.sessionId));

      const tools = await this.buildResearchTools(input);
      const planPrompt = feedback
        ? `Please revise the research plan using this homeowner feedback before proceeding: ${feedback}`
        : researchPrompt(input);

      const plan = await draftDeepResearchPlan(
        this.env,
        { prompt: planPrompt, mode: input.mode, tools, previousInteractionId },
        {
          onStatus: (i) =>
            this.updateProgress("planning", progressTextFromInteraction(i), { planStatus: "drafting" }),
        },
      );

      const planMarkdown = plan.planMarkdown ?? "";
      this.setState({
        ...this.state,
        planInteractionId: plan.interactionId,
        currentSessionId: input.sessionId,
        currentTopic: input.topic,
      });

      // Gate (b): onboard agent annotates the plan before the homeowner sees it.
      this.updateProgress("planning", "Reviewing the plan...", { planStatus: "annotating" });
      await db
        .update(researchSessions)
        .set({ planStatus: "annotating", planInteractionId: plan.interactionId, researchPlan: planMarkdown })
        .where(eq(researchSessions.id, input.sessionId));

      const annotations = await annotatePlan(this.env, {
        planMarkdown,
        topic: input.topic,
      });
      const annotationsJson = JSON.stringify(annotations);

      const [session] = await db
        .select()
        .from(researchSessions)
        .where(eq(researchSessions.id, input.sessionId))
        .limit(1);
      const revision = session?.planRevision ?? 0;

      await db.insert(researchPlanRevisions).values({
        sessionId: input.sessionId,
        revision,
        planMarkdown,
        planAnnotations: annotationsJson,
        homeownerFeedback: feedback ?? null,
      });

      await db
        .update(researchSessions)
        .set({
          status: "awaiting_plan_approval",
          planStatus: "awaiting_approval",
          planAnnotations: annotationsJson,
        })
        .where(eq(researchSessions.id, input.sessionId));

      this.updateProgress("awaiting_plan_approval", "Plan ready for your review.", {
        planStatus: "awaiting_approval",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(researchSessions)
        .set({ status: "failed", errorMessage })
        .where(eq(researchSessions.id, input.sessionId));
      this.updateProgress("failed", `Plan drafting failed: ${errorMessage}`);
    }
  }

  // -------------------------------------------------------------------------
  // @callable: Approve the plan and release the research run (gate c)
  // -------------------------------------------------------------------------

  @callable()
  async approvePlan(sessionId: number): Promise<void> {
    const db = this.getDb();
    const [session] = await db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId))
      .limit(1);

    if (!session) throw new Error(`Research session ${sessionId} not found`);
    if (session.status !== "awaiting_plan_approval" || !session.planInteractionId) {
      throw new Error(`Session ${sessionId} is not awaiting plan approval`);
    }

    try {
      await db
        .update(researchSessions)
        .set({ status: "researching", planStatus: "approved", planApprovedAt: new Date() })
        .where(eq(researchSessions.id, sessionId));
      this.updateProgress("researching", "Plan approved — running the research...", {
        currentSessionId: sessionId,
        currentTopic: session.topic,
        planStatus: "approved",
      });

      const mode = session.interactionAgent === GEMINI_DEEP_RESEARCH_MAX_AGENT ? "max" : "standard";
      const tools = await this.buildResearchTools({
        enableMcpBridge: session.mcpBridgeEnabled ?? false,
        mcpServerUrl: null,
        sessionId,
      });
      const interaction = await continueDeepResearchPlan(
        this.env,
        session.planInteractionId,
        { kind: "approve" },
        { mode, tools },
      );

      this.setState({
        ...this.state,
        interactionId: interaction.id,
        currentSessionId: sessionId,
        currentTopic: session.topic,
      });
      await db
        .update(researchSessions)
        .set({ interactionId: interaction.id })
        .where(eq(researchSessions.id, sessionId));

      this.ctx.waitUntil(this.monitorResearchStream(interaction.id, sessionId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(researchSessions)
        .set({ status: "failed", errorMessage })
        .where(eq(researchSessions.id, sessionId));
      this.updateProgress("failed", `Failed to start approved run: ${errorMessage}`);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // @callable: Request changes — re-plan with homeowner feedback (gate c loop)
  // -------------------------------------------------------------------------

  @callable()
  async revisePlan(sessionId: number, feedback: string): Promise<void> {
    const db = this.getDb();
    const [session] = await db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId))
      .limit(1);

    if (!session) throw new Error(`Research session ${sessionId} not found`);
    if (session.status !== "awaiting_plan_approval" || !session.planInteractionId) {
      throw new Error(`Session ${sessionId} is not awaiting plan approval`);
    }
    const trimmed = feedback?.trim();
    if (!trimmed) throw new Error("Feedback is required to request plan changes");

    await db
      .update(researchSessions)
      .set({ planStatus: "revising", status: "planning", planRevision: (session.planRevision ?? 0) + 1 })
      .where(eq(researchSessions.id, sessionId));

    const input: StartResearchInput = {
      topic: session.topic,
      sessionId,
      prompt: session.prompt,
      researchPlan: session.researchPlan,
      enableMcpBridge: session.mcpBridgeEnabled ?? false,
      mode: session.interactionAgent === GEMINI_DEEP_RESEARCH_MAX_AGENT ? "max" : "standard",
    };
    this.ctx.waitUntil(this.draftPlanPhase(input, session.planInteractionId, trimmed));
  }

  // -------------------------------------------------------------------------
  // Private: Background Research Stream Monitor
  // -------------------------------------------------------------------------

  private async monitorResearchStream(interactionId: string, sessionId: number) {
    const db = this.getDb();

    try {
      const [session] = await db
        .select()
        .from(researchSessions)
        .where(eq(researchSessions.id, sessionId))
        .limit(1);

      const topic = session?.topic ?? this.state.currentTopic ?? "research session";

      while (true) {
        const statusResponse = await getDeepResearchInteraction(this.env, interactionId);
        
        if (statusResponse.status === "completed") {
          await this.finalizeResearch(sessionId, topic, statusResponse.output_text || "");
          break;
        } else if (statusResponse.status === "failed") {
          throw new Error(
            `Deep research failed on Gemini servers: ${statusResponse.error?.message ?? statusResponse.error ?? "unknown error"}`,
          );
        } else if (statusResponse.status === "in_progress") {
          this.updateProgress("researching", progressTextFromInteraction(statusResponse));
          await db
            .update(researchSessions)
            .set({
              interactionId,
              lastEventId: statusResponse.last_event_id ?? this.state.lastEventId ?? null,
            })
            .where(eq(researchSessions.id, sessionId));
          await new Promise((resolve) => setTimeout(resolve, 10_000));
        } else {
          this.updateProgress("researching", `Deep Research status: ${statusResponse.status}`);
          await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
      }
    } catch (error) {
      console.error("Research stream error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error in background research";
      await db.update(researchSessions).set({ status: "failed", errorMessage }).where(eq(researchSessions.id, sessionId));
      this.updateProgress("failed", `Research failed: ${errorMessage}`);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Finalize Research (R2, Vectorize, Visualizer)
  // -------------------------------------------------------------------------

  private async finalizeResearch(sessionId: number, topic: string, markdown: string) {
    const db = this.getDb();
    
    if (!markdown || markdown.length < 100) {
      throw new Error("Gemini returned insufficient research content");
    }

    // ── Save to R2 ───────────────────────────────────────────────────
    this.updateProgress("researching", "Saving research to R2...");
    const markdownKey = r2MarkdownKey(sessionId);
    await this.env.ARTIFACTS_BUCKET.put(markdownKey, markdown, {
      httpMetadata: { contentType: "text/markdown" },
      customMetadata: { sessionId: String(sessionId), topic },
    });
    await db.update(researchSessions).set({ r2MarkdownKey: markdownKey }).where(eq(researchSessions.id, sessionId));

    // ── Phase 2: Embedding ────────────────────────────────────────────
    this.updateProgress("embedding", "Chunking markdown for embeddings...");
    await db.update(researchSessions).set({ status: "embedding" }).where(eq(researchSessions.id, sessionId));

    const { chunks } = chunkMarkdown(markdown);
    this.updateProgress("embedding", `Embedding ${chunks.length} chunks into Vectorize...`);
    const embedResult = await embedAndUpsertChunks(this.env, chunks, sessionId);

    await db.update(researchSessions).set({
      vectorNamespace: embedResult.namespace,
      chunkCount: embedResult.chunkCount,
    }).where(eq(researchSessions.id, sessionId));

    this.updateProgress("embedding", `Embedded ${embedResult.chunkCount} chunks`, { chunkCount: embedResult.chunkCount });

    // ── Phase 3: Visualizer Generation ────────────────────────────────
    this.updateProgress("generating", "Generating interactive visualizer webapp...");
    await db.update(researchSessions).set({ status: "generating" }).where(eq(researchSessions.id, sessionId));

    const visualizerHtml = await generateVisualizerWebapp(this.env, topic, markdown);
    const webappKey = r2WebappKey(sessionId);
    await this.env.ARTIFACTS_BUCKET.put(webappKey, visualizerHtml, {
      httpMetadata: { contentType: "text/html" },
      customMetadata: { sessionId: String(sessionId), topic },
    });

    // ── Complete ──────────────────────────────────────────────────────
    await db.update(researchSessions).set({
      status: "complete",
      r2WebappKey: webappKey,
      completedAt: new Date(),
    }).where(eq(researchSessions.id, sessionId));

    this.updateProgress("complete", "Research complete! All artifacts saved.", { currentSessionId: sessionId });
  }

  // -------------------------------------------------------------------------
  // @callable: Get Session Status
  // -------------------------------------------------------------------------

  @callable()
  async getSessionStatus(sessionId: number) {
    const db = this.getDb();
    const [session] = await db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId))
      .limit(1);

    return session ?? null;
  }

  // -------------------------------------------------------------------------
  // @callable: Health Probe
  // -------------------------------------------------------------------------

  @callable()
  async healthProbe() {
    return runHealthProbe(this.env);
  }

  // -------------------------------------------------------------------------
  // Chat: RAG-powered streaming via Gemini 2.5 Flash
  // -------------------------------------------------------------------------

  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // Extract session ID from the DO instance name
    // Instance name format: "research-{sessionId}" or just the sessionId
    const instanceName = this.name;
    const sessionIdStr = instanceName.replace("research-", "");
    const sessionId = parseInt(sessionIdStr, 10);

    let ragContext = "";

    if (!isNaN(sessionId)) {
      try {
        // Get the user's latest message for the semantic query
        // UIMessage v5+ uses `parts` instead of `content`
        const lastMessage = this.messages[this.messages.length - 1];
        const queryText =
          lastMessage?.parts
            ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join(" ")
          || "summarize the research";

        // Generate query embedding
        const queryEmbedding = (await this.env.AI.run(
          "@cf/baai/bge-large-en-v1.5",
          { text: [queryText] },
          { gateway: { id: this.env.AI_GATEWAY_ID } },
        )) as { data: number[][] };

        // Search Vectorize with session namespace isolation
        const namespace = vectorNamespace(sessionId);
        const searchResults = await this.env.RESEARCH_INDEX.query(
          queryEmbedding.data[0],
          {
            topK: 8,
            namespace,
            returnMetadata: "all",
          },
        );

        // Retrieve chunk text from metadata
        if (searchResults.matches && searchResults.matches.length > 0) {
          const relevantChunks = searchResults.matches
            .filter((m) => (m.score ?? 0) > 0.5)
            .map(
              (m) =>
                (m.metadata as Record<string, unknown>)?.textPreview as string ?? "",
            )
            .filter(Boolean);

          if (relevantChunks.length > 0) {
            let relevantContextText = "";
            for (let i = 0; i < relevantChunks.length; i++) {
              relevantContextText = `${relevantContextText}[${i + 1}] ${relevantChunks[i]}

`;
            }
            ragContext = `

RELEVANT RESEARCH CONTEXT (from embedded research documents):
${relevantContextText.trimEnd()}`;
          }
        }
      } catch (err) {
        console.error("RAG context retrieval failed:", err);
        // Continue without RAG context — still useful as a general assistant
      }
    }

    // Stream response using Workers AI for low latency
    // Using Workers AI as the streaming provider for Cloudflare-native compatibility
    const workersai = createWorkersAI({ binding: this.env.AI });

    const systemPrompt = `You are an expert research assistant for home renovation and construction projects. You have access to a deep research database and can answer questions with specific, data-driven insights.

Your responses should be:
- Specific and quantitative (include numbers, percentages, price ranges)
- Actionable (provide concrete next steps)
- Contextual (reference the research findings when available)
- Concise but thorough${ragContext}

You also have TOOLS to ground answers in the homeowner's live D1 data and across every embedded research session:
- list_materials — the Materials Schedule (what's needed/purchased, by room)
- list_showrooms — tracked Bay Area showroom stores
- list_products — products captured across showrooms (optionally scoped to a showroom)
- search_research — global semantic search across ALL deep-research documents

Call these tools whenever the question touches the homeowner's materials, vendors, products, or past research — then ground your answer in the returned records. Prefer real data over generic advice.

When answering, always reference relevant findings from the research context if available. If the context doesn't contain relevant information for the question, say so and provide your best general knowledge.`;

    const result = streamText({
      model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct"),
      system: systemPrompt,
      messages: await convertToModelMessages(this.messages),
      tools: buildChatDataTools(this.env),
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}
