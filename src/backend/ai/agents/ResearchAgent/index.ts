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
import { GoogleGenAI } from "@google/genai";
import { callable } from "agents";
import { streamText, convertToModelMessages } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import {
  chunkMarkdown,
  embedAndUpsertChunks,
  generateVisualizerWebapp,
} from "./methods";
import { runHealthProbe } from "./health";
import {
  type ResearchAgentState,
  DEFAULT_RESEARCH_STATE,
  r2MarkdownKey,
  r2WebappKey,
  vectorNamespace,
} from "./types";

// Define a type for the Deep Research interaction state
type InteractionState = {
  id: string;
  status: string;
  output_text?: string;
  error?: string;
};

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
        "Gemini 2.5 Pro (deep research + visualizer generation)",
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

  // -------------------------------------------------------------------------
  // Private: Gemini client factory
  // -------------------------------------------------------------------------

  private async getGeminiClient(): Promise<GoogleGenAI> {
    const geminiApiKey = await this.env.GEMINI_API_KEY.get();
    const cloudflareAccountId = await this.env.CLOUDFLARE_ACCOUNT_ID.get();

    if (!geminiApiKey) throw new Error("GEMINI_API_KEY not configured");
    if (!cloudflareAccountId) throw new Error("CLOUDFLARE_ACCOUNT_ID not configured");

    return new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${this.env.AI_GATEWAY_ID}/google-ai-studio`,
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
  async startResearch(topic: string, sessionId: number): Promise<void> {
    const db = this.getDb();

    try {
      this.updateProgress("researching", "Starting Gemini deep research...", {
        currentSessionId: sessionId,
        currentTopic: topic,
      });

      await db
        .update(researchSessions)
        .set({ status: "researching" })
        .where(eq(researchSessions.id, sessionId));

      const ai = await this.getGeminiClient();

      // Deep Research Interactions API expects interactions.create with background=True
      const interaction = await ai.interactions.create({
        input: `Conduct a comprehensive deep research report on the following topic: "${topic}".
Include specific numbers, percentages, and price ranges throughout. Format as clean Markdown with proper headers, bullet points, and tables where appropriate.`,
        agent: "deep-research-preview-04-2026",
        background: true,
        agent_config: { type: "deep-research", thinking_summaries: "auto" }
      }) as any;

      // Save the interaction ID so it can be resumed
      this.setState({ ...this.state, interactionId: interaction.id });

      // Process the stream asynchronously without blocking the RPC response
      this.ctx.waitUntil(this.monitorResearchStream(this.state.interactionId!, sessionId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await db.update(researchSessions).set({ status: "failed", errorMessage }).where(eq(researchSessions.id, sessionId));
      this.updateProgress("failed", `Failed to start research: ${errorMessage}`);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Background Research Stream Monitor
  // -------------------------------------------------------------------------

  private async monitorResearchStream(interactionId: string, sessionId: number) {
    const db = this.getDb();
    let isComplete = false;
    let lastEventId: string | undefined = this.state.lastEventId;

    try {
      const ai = await this.getGeminiClient();
      
      const processStream = async (stream: any) => {
        for await (const event of stream) {
          if (event.event_id) {
            lastEventId = event.event_id;
            this.setState({ ...this.state, lastEventId });
          }
          if (event.type === "step.delta" || event.event_type === "step.delta") {
            const delta = event.delta;
            if (delta.type === "thought") {
              this.updateProgress("researching", `Thinking: ${delta.text}`);
            } else if (delta.type === "text") {
              this.updateProgress("researching", "Generating report...");
            }
          } else if (["interaction.completed", "error"].includes(event.type || event.event_type)) {
            isComplete = true;
          }
        }
      };

      // Loop to handle reconnects
      while (!isComplete) {
        const statusResponse = await ai.interactions.get(interactionId);
        
        if (statusResponse.status === "completed") {
          isComplete = true;
          await this.finalizeResearch(sessionId, this.state.currentTopic!, statusResponse.output_text || "");
          break;
        } else if (statusResponse.status === "failed") {
          throw new Error("Deep research failed on Gemini servers");
        } else if (statusResponse.status === "in_progress") {
          try {
            const stream = await ai.interactions.get(interactionId, { stream: true, last_event_id: lastEventId });
            await processStream(stream);
          } catch (streamErr) {
            console.warn("Stream disconnected, polling again in 10s...", streamErr);
            await new Promise(r => setTimeout(r, 10000));
          }
        } else {
          // Unknown status
          await new Promise(r => setTimeout(r, 10000));
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
            ragContext = `\n\nRELEVANT RESEARCH CONTEXT (from embedded research documents):\n${relevantChunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}`;
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

When answering, always reference relevant findings from the research context if available. If the context doesn't contain relevant information for the question, say so and provide your best general knowledge.`;

    const result = streamText({
      model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct"),
      system: systemPrompt,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onFinish,
    });

    return result.toUIMessageStreamResponse();
  }
}
