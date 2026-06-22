/**
 * @fileoverview ShowroomResearchAgent — Specialized AI agent for showroom
 * product research, compatibility checking, image sourcing, and category gap
 * monitoring.
 *
 * The agent extends AIChatAgent for future WebSocket chat over showroom
 * findings, but long-running research is exposed as native Agents SDK RPC
 * methods. Worker routes and cron jobs must call these methods through
 * `getAgentByName(env.SHOWROOM_RESEARCH_AGENT, "showroom-research")`.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable } from "agents";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  showroomStores,
  storePaMapping,
  storeProductAreaDef,
} from "@backend/db/schema/showroom/index";
import {
  deepSweepCategory as runDeepSweepCategory,
  deepSweepProduct as runDeepSweepProduct,
  deepSweepStore as runDeepSweepStore,
} from "./methods";
import type {
  DeepSweepCategoryInput,
  DeepSweepProductInput,
  DeepSweepStoreInput,
  ShowroomSweepResult,
} from "./types";

export type ShowroomResearchState = {
  status: "idle" | "researching" | "complete" | "error";
  currentTask?: string;
  progress?: number;
  lastError?: string;
};

const DEFAULT_STATE: ShowroomResearchState = {
  status: "idle",
};

function failedResult(
  targetType: "product" | "store" | "category",
  targetId: number,
  error: unknown,
): ShowroomSweepResult {
  return {
    success: false,
    targetType,
    targetId,
    citationsFound: 0,
    sourcesProcessed: 0,
    findingsWritten: 0,
    imagesWritten: 0,
    specsWritten: 0,
    vectorsWritten: 0,
    warnings: [error instanceof Error ? error.message : String(error)],
  };
}

export class ShowroomResearchAgent extends AIChatAgent<
  Env,
  ShowroomResearchState
> {
  static docsMetadata() {
    return {
      name: "ShowroomResearchAgent",
      className: "ShowroomResearchAgent",
      description:
        "Specialized AI agent for showroom product research, compatibility checking, " +
        "cost-saving intelligence, image sourcing, Vectorize RAG, and vendor gap detection.",
      docsPath: "/docs/agents/showroom-research",
      methods: [
        {
          name: "deepSweepProduct",
          description:
            "Run citation-backed product sourcing research, scrape semantic images, persist specs/findings, and embed into RESEARCH_INDEX.",
          params: "DeepSweepProductInput",
          returns: "ShowroomSweepResult",
        },
        {
          name: "deepSweepStore",
          description:
            "Run citation-backed showroom research, scrape storefront/showroom images, persist findings/ratings, and embed into RESEARCH_INDEX.",
          params: "DeepSweepStoreInput",
          returns: "ShowroomSweepResult",
        },
        {
          name: "deepSweepCategory",
          description:
            "Research category coverage gaps with homeowner rejection constraints and embed source evidence into RESEARCH_INDEX.",
          params: "DeepSweepCategoryInput",
          returns: "ShowroomSweepResult",
        },
        {
          name: "researchStore",
          description:
            "Compatibility wrapper for existing store-created/manual triggers.",
          params: "storeId: number",
          returns: "{ success: boolean; findingsCount: number }",
        },
        {
          name: "researchProduct",
          description:
            "Compatibility wrapper for existing product-created/manual triggers.",
          params: "productId: number",
          returns: "{ success: boolean; findingsCount: number }",
        },
        {
          name: "generateHighlights",
          description:
            "Generate ai_highlights_for_user_renovation for a store based on D1 context.",
          params: "storeId: number",
          returns: "string | null",
        },
      ],
    };
  }

  initialState = DEFAULT_STATE;

  private reportProgress(message: string, progress?: number) {
    this.setState({
      ...this.state,
      status: "researching",
      currentTask: message,
      progress,
      lastError: undefined,
    });
  }

  private markComplete() {
    this.setState({
      ...this.state,
      status: "complete",
      currentTask: undefined,
      progress: 100,
      lastError: undefined,
    });
  }

  private markError(error: unknown) {
    this.setState({
      ...this.state,
      status: "error",
      currentTask: undefined,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  @callable()
  async deepSweepProduct(input: DeepSweepProductInput): Promise<ShowroomSweepResult> {
    try {
      const result = await runDeepSweepProduct(this.env, input, (message, progress) =>
        this.reportProgress(message, progress),
      );
      this.markComplete();
      return result;
    } catch (error) {
      this.markError(error);
      return failedResult("product", input.productId, error);
    }
  }

  @callable()
  async deepSweepStore(input: DeepSweepStoreInput): Promise<ShowroomSweepResult> {
    try {
      const result = await runDeepSweepStore(this.env, input, (message, progress) =>
        this.reportProgress(message, progress),
      );
      this.markComplete();
      return result;
    } catch (error) {
      this.markError(error);
      return failedResult("store", input.storeId, error);
    }
  }

  @callable()
  async deepSweepCategory(input: DeepSweepCategoryInput): Promise<ShowroomSweepResult> {
    try {
      const result = await runDeepSweepCategory(this.env, input, (message, progress) =>
        this.reportProgress(message, progress),
      );
      this.markComplete();
      return result;
    } catch (error) {
      this.markError(error);
      return failedResult("category", input.categoryId, error);
    }
  }

  /**
   * Compatibility method retained for existing `store.created` style triggers.
   */
  @callable()
  async researchStore(storeId: number): Promise<{ success: boolean; findingsCount: number }> {
    const result = await this.deepSweepStore({
      storeId,
      maxSources: 5,
      triggerSource: "store-created",
    });
    return { success: result.success, findingsCount: result.findingsWritten };
  }

  /**
   * Compatibility method retained for existing `product.created` style triggers.
   */
  @callable()
  async researchProduct(productId: number): Promise<{ success: boolean; findingsCount: number }> {
    const result = await this.deepSweepProduct({
      productId,
      maxSources: 5,
      triggerSource: "product-created",
    });
    return { success: result.success, findingsCount: result.findingsWritten };
  }

  /**
   * Generate ai_highlights_for_user_renovation by scanning D1 store context.
   */
  @callable()
  async generateHighlights(storeId: number): Promise<string | null> {
    const db = drizzle(this.env.DB);

    const [store] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1);

    if (!store) return null;

    const prompt = `Given this showroom store, generate a brief 2-3 sentence highlight explaining how this store is specifically relevant to a high-end San Francisco home renovation. Focus on unique offerings that would be hard to find elsewhere.

Store: ${store.name}
Description: ${store.description ?? ""}
Inventory Focus: ${store.inventoryFocus ?? ""}
Target Demographic: ${store.targetDemographic ?? ""}
Scale: ${store.scale ?? ""}`;

    try {
      const response = (await this.env.AI.run(
        "@cf/moonshotai/kimi-k2.6" as any,
        {
          messages: [
            {
              role: "system",
              content: `You are a renovation consultant. Be specific and concise.`,
            },
            { role: "user", content: prompt },
          ],
        } as any,
        { gateway: { id: this.env.AI_GATEWAY_ID } },
      )) as string | { response?: string };

      const rawOutput =
        typeof response === "string" ? response : response.response ?? "";

      return rawOutput.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Analyze vendor category gaps across product-area definitions.
   */
  @callable()
  async analyzeGaps(): Promise<{
    totalAreas: number;
    coveredCount: number;
    gaps: Array<{ roomName: string; name: string; suggestion: string }>;
  }> {
    const db = drizzle(this.env.DB);

    const allAreas = await db
      .select()
      .from(storeProductAreaDef)
      .where(eq(storeProductAreaDef.isActive, true));

    const covered = await db
      .select({ productAreaId: storePaMapping.productAreaId })
      .from(storePaMapping);

    const coveredIds = new Set(covered.map((r) => r.productAreaId));

    const gaps = allAreas
      .filter((area) => !coveredIds.has(area.id))
      .map((area) => ({
        roomName: area.roomName,
        name: area.name,
        suggestion: `Search for ${area.name} vendors in the San Francisco Bay Area`,
      }));

    return {
      totalAreas: allAreas.length,
      coveredCount: coveredIds.size,
      gaps,
    };
  }

  async onChatMessage(
    _onFinish: Parameters<AIChatAgent["onChatMessage"]>[0],
    _options?: Parameters<AIChatAgent["onChatMessage"]>[1],
  ): Promise<Response | undefined> {
    return undefined;
  }
}
