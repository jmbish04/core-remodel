/**
 * @fileoverview RenovationAgent — Centralized AI gateway for all photo
 * analysis and renovation intelligence.
 *
 * This agent provides callable RPCs for:
 * - Image analysis (vision + structured reasoning)
 * - Photo review processing (upload + tag + persist)
 * - Semantic image search
 * - Renovation consultation (contextual Q&A)
 *
 * All AI calls flow through this agent, which manages model selection:
 *   Vision: @cf/meta/llama-3.2-11b-vision-instruct
 *   Reasoning: @cf/openai/gpt-oss-120b (json_schema structured output)
 *   Embeddings: @cf/baai/bge-base-en-v1.5
 */

import { Agent, callable, type Connection } from "agents";
import { ImageProcessorService } from "@backend/services/image-processor";
import { WorkersAIProvider } from "@backend/ai/providers/workers-ai";
import { modelRegistry } from "@backend/ai/models";
import { type RenovationAgentState, RENOVATION_ADVICE_SCHEMA } from "./types";

// ---------------------------------------------------------------------------
// Agent State
// ---------------------------------------------------------------------------

const DEFAULT_STATE: RenovationAgentState = {
  analyzedImages: [],
  styleThemes: [],
  roomsObserved: [],
};

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class RenovationAgent extends Agent<Env, RenovationAgentState> {
  static docsMetadata() {
    return {
      name: "RenovationAgent",
      className: "RenovationAgent",
      description:
        "Centralized AI gateway for renovation photo analysis, consultation, and search. " +
        "All vision and reasoning AI calls flow through this agent. Maintains conversational " +
        "context about analyzed images and style themes.",
      docsPath: "/docs/agents/renovation",
      methods: [
        {
          name: "analyzeImage",
          description: "Analyze a single image with vision + structured reasoning",
          params: "imageDataUrl: string",
          returns: "ImageAnalysisResult",
        },
        {
          name: "processUpload",
          description: "Full pipeline: upload to CF Images + AI analysis + persist to D1",
          params: "fileBase64: string, filename: string, mimeType: string",
          returns: "ProcessUploadResult",
        },
        {
          name: "searchImages",
          description: "Semantic image search via Vectorize embeddings",
          params: "query: string, topK?: number",
          returns: "SearchResult[]",
        },
        {
          name: "consult",
          description: "Get renovation advice based on analyzed images and a query",
          params: "query: string",
          returns: "RenovationAdvice",
        },
        {
          name: "getContext",
          description: "Get the current agent context (analyzed images, themes, rooms)",
          params: "none",
          returns: "RenovationAgentState",
        },
      ],
      tools: [
        "Workers AI llama-3.2-11b-vision-instruct (vision analysis)",
        "Workers AI gpt-oss-120b (structured reasoning via json_schema)",
        "Workers AI bge-base-en-v1.5 (embeddings)",
        "Cloudflare Images (storage + delivery)",
        "D1 (persistence)",
        "Vectorize (semantic search)",
      ],
    };
  }

  initialState = DEFAULT_STATE;

  // -------------------------------------------------------------------------
  // Private: get or create ImageProcessorService
  // -------------------------------------------------------------------------

  private async getProcessor(): Promise<ImageProcessorService> {
    const accountId = await this.env.CLOUDFLARE_ACCOUNT_ID.get();
    const apiToken = await this.env.CLOUDFLARE_API_TOKEN.get();

    if (!accountId || !apiToken) {
      throw new Error("Cloudflare credentials not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)");
    }

    return new ImageProcessorService(this.env, accountId, apiToken);
  }

  // -------------------------------------------------------------------------
  // Private: update agent state with analysis results
  // -------------------------------------------------------------------------

  private updateContext(imageId: string, analysis: { roomType: string; keywords: string[] }, deliveryUrl?: string) {
    const state = this.state;

    state.analyzedImages.push({
      imageId,
      roomType: analysis.roomType,
      keywords: analysis.keywords,
      deliveryUrl,
      analyzedAt: new Date().toISOString(),
    });

    // Accumulate unique style themes
    for (const kw of analysis.keywords) {
      if (!state.styleThemes.includes(kw)) {
        state.styleThemes.push(kw);
      }
    }

    // Track unique rooms
    if (!state.roomsObserved.includes(analysis.roomType)) {
      state.roomsObserved.push(analysis.roomType);
    }

    // Keep last 50 analyzed images in context
    if (state.analyzedImages.length > 50) {
      state.analyzedImages = state.analyzedImages.slice(-50);
    }

    this.setState(state);
  }

  // -------------------------------------------------------------------------
  // RPC: Analyze a single image (vision + structured reasoning)
  // -------------------------------------------------------------------------

  @callable()
  async analyzeImage(imageDataUrl: string) {
    const processor = await this.getProcessor();
    const analysis = await processor.analyzeImage(imageDataUrl);

    // Update running context
    this.updateContext(crypto.randomUUID(), analysis);

    return analysis;
  }

  // -------------------------------------------------------------------------
  // RPC: Full upload pipeline (CF Images + AI + D1)
  // -------------------------------------------------------------------------

  @callable()
  async processUpload(fileBase64: string, filename: string, mimeType: string) {
    const processor = await this.getProcessor();

    // Reconstruct File from base64
    const binaryString = atob(fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const file = new File([bytes], filename, { type: mimeType });

    const result = await processor.processPhotoReview(file);

    if (result.success && result.record) {
      const record = result.record as Record<string, unknown>;
      this.updateContext(
        record.id as string,
        {
          roomType: (record.room as string) || "unknown",
          keywords: JSON.parse((record.tags as string) || "[]"),
        },
        record.path as string,
      );
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // RPC: Semantic image search
  // -------------------------------------------------------------------------

  @callable()
  async searchImages(query: string, topK: number = 10) {
    const processor = await this.getProcessor();
    return await processor.searchImages(query, topK);
  }

  // -------------------------------------------------------------------------
  // RPC: Renovation consultation with full context
  // -------------------------------------------------------------------------

  @callable()
  async consult(query: string) {
    const provider = new WorkersAIProvider(this.env);
    const state = this.state;

    // Build context from analyzed images
    const imageContext = state.analyzedImages.length > 0
      ? state.analyzedImages
          .map((img) => `- ${img.roomType}: ${img.keywords.join(", ")}`)
          .join("\n")
      : "No images analyzed yet.";

    const systemPrompt =
    `
      You are an expert interior designer and renovation consultant.
      You have been analyzing the user's inspiration photos and have accumulated deep context about their aesthetic preferences.
      
      **Rooms observed:**
      ${state.roomsObserved.join(", ") || "none yet"}
      
      **Style themes identified:**
      ${state.styleThemes.join(", ") || "none yet"}
      
      **Image analysis history:**
      ${imageContext}
      
      **Provide specific, actionable renovation advice** based on the patterns you see in their inspiration photos.
      
      **Always respond with valid JSON** matching the provided schema.
    `;

    const structured = (await provider.invokeStructured(modelRegistry.extract, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      response_format: {
        type: "json_schema",
        json_schema: RENOVATION_ADVICE_SCHEMA,
      },
    })) as {
      summary: string;
      recommendations: Array<{ area: string; suggestion: string; priority: string }>;
      styleNotes: string[];
    };

    return structured;
  }

  // -------------------------------------------------------------------------
  // RPC: Get current agent context
  // -------------------------------------------------------------------------

  @callable()
  async getContext() {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // RPC: Health probe
  // -------------------------------------------------------------------------

  @callable()
  async healthProbe() {
    const start = Date.now();
    const issues: string[] = [];

    // Verify credentials are available
    try {
      const accountId = await this.env.CLOUDFLARE_ACCOUNT_ID.get();
      if (!accountId) issues.push("CLOUDFLARE_ACCOUNT_ID not set");
    } catch {
      issues.push("Failed to read CLOUDFLARE_ACCOUNT_ID");
    }

    try {
      const apiToken = await this.env.CLOUDFLARE_API_TOKEN.get();
      if (!apiToken) issues.push("CLOUDFLARE_API_TOKEN not set");
    } catch {
      issues.push("Failed to read CLOUDFLARE_API_TOKEN");
    }

    return {
      status: issues.length === 0 ? "ok" : "fail",
      latencyMs: Date.now() - start,
      error: issues.length > 0 ? issues.join("; ") : undefined,
      details: {
        analyzedImageCount: this.state.analyzedImages.length,
        roomsObserved: this.state.roomsObserved,
        styleThemeCount: this.state.styleThemes.length,
      },
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket handler
  // -------------------------------------------------------------------------

  async onMessage(connection: Connection, message: unknown) {
    let parsed: { action: string; [key: string]: unknown };

    if (typeof message === "string") {
      try {
        parsed = JSON.parse(message);
      } catch {
        connection.send(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
    } else if (typeof message === "object" && message !== null) {
      parsed = message as typeof parsed;
    } else {
      connection.send(JSON.stringify({ error: "Invalid message format" }));
      return;
    }

    try {
      switch (parsed.action) {
        case "analyze":
          if (typeof parsed.imageDataUrl === "string") {
            const analysis = await this.analyzeImage(parsed.imageDataUrl);
            connection.send(JSON.stringify({ type: "analysis", data: analysis }));
          } else {
            connection.send(JSON.stringify({ error: "Missing imageDataUrl" }));
          }
          break;

        case "search":
          if (typeof parsed.query === "string") {
            const results = await this.searchImages(parsed.query, (parsed.topK as number) || 10);
            connection.send(JSON.stringify({ type: "search_results", data: results }));
          } else {
            connection.send(JSON.stringify({ error: "Missing query" }));
          }
          break;

        case "consult":
          if (typeof parsed.query === "string") {
            const advice = await this.consult(parsed.query);
            connection.send(JSON.stringify({ type: "advice", data: advice }));
          } else {
            connection.send(JSON.stringify({ error: "Missing query" }));
          }
          break;

        case "context":
          connection.send(JSON.stringify({ type: "context", data: this.state }));
          break;

        default:
          connection.send(
            JSON.stringify({
              error: `Unknown action: ${parsed.action}. Supported: analyze, search, consult, context`,
            }),
          );
      }
    } catch (error) {
      connection.send(
        JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  }
}
