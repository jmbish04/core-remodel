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
  sourcingSweepSessions,
  storePaMapping,
  storeProductAreaDef,
} from "@backend/db/schema/showroom/index";
import {
  createSweepSession,
  deepSweepCategory as runDeepSweepCategory,
  deepSweepProduct as runDeepSweepProduct,
  deepSweepStore as runDeepSweepStore,
  draftSweepPlan,
  runApprovedSweep,
  fillBlanksFromPlacesAI,
  runBackfillPhotoPipeline,
  triggerBackfillScrape,
  hasExistingFindings,
  type DiscoverSweepPlanInput,
  type BackfillEnrichPayload,
} from "./methods";
import { faviconService } from "@backend/services/favicon";
import { getStoreWebsiteUrl } from "@backend/utils/showroom-links";
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

  // -------------------------------------------------------------------------
  // Plan-review gate (Phase 2): draft → annotate → approve → run
  // -------------------------------------------------------------------------

  /**
   * Start a plan-gated sweep: create a session, draft + annotate a plan in the
   * background, and pause at `awaiting_plan_approval`. Returns the session id
   * immediately so the caller can poll it.
   */
  @callable()
  async discoverSweepPlan(
    input: DiscoverSweepPlanInput,
  ): Promise<{ sessionId: number; status: "planning" }> {
    const sessionId = await createSweepSession(this.env, input);
    this.ctx.waitUntil(
      draftSweepPlan(this.env, sessionId, {
        onProgress: (message, progress) => this.reportProgress(message, progress),
      }),
    );
    return { sessionId, status: "planning" };
  }

  /** Approve the drafted plan and run the sweep in the background (gate c). */
  @callable()
  async approveSweepPlan(sessionId: number): Promise<{ success: boolean; status: string }> {
    const db = drizzle(this.env.DB);
    const [session] = await db
      .select()
      .from(sourcingSweepSessions)
      .where(eq(sourcingSweepSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Error(`Sweep session ${sessionId} not found`);
    if (session.status !== "awaiting_plan_approval") {
      throw new Error(`Sweep session ${sessionId} is not awaiting plan approval`);
    }

    await db
      .update(sourcingSweepSessions)
      .set({ status: "sweeping", planStatus: "approved", approvedAt: new Date() })
      .where(eq(sourcingSweepSessions.id, sessionId));

    this.ctx.waitUntil(
      runApprovedSweep(this.env, sessionId, (message, progress) =>
        this.reportProgress(message, progress),
      ),
    );
    return { success: true, status: "sweeping" };
  }

  /** Request changes — re-draft the plan with homeowner feedback (gate c loop). */
  @callable()
  async reviseSweepPlan(
    sessionId: number,
    feedback: string,
  ): Promise<{ success: boolean; status: string }> {
    const db = drizzle(this.env.DB);
    const [session] = await db
      .select()
      .from(sourcingSweepSessions)
      .where(eq(sourcingSweepSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Error(`Sweep session ${sessionId} not found`);
    if (session.status !== "awaiting_plan_approval") {
      throw new Error(`Sweep session ${sessionId} is not awaiting plan approval`);
    }
    const trimmed = typeof feedback === "string" ? feedback.trim() : "";
    if (!trimmed) throw new Error("Feedback is required to request plan changes");

    await db
      .update(sourcingSweepSessions)
      .set({ status: "planning", planStatus: "revising", planRevision: (session.planRevision ?? 0) + 1 })
      .where(eq(sourcingSweepSessions.id, sessionId));

    this.ctx.waitUntil(
      draftSweepPlan(this.env, sessionId, {
        feedback: trimmed,
        onProgress: (message, progress) => this.reportProgress(message, progress),
      }),
    );
    return { success: true, status: "planning" };
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

  // -------------------------------------------------------------------------
  // Bulk backfill (Manage flow): durable per-showroom enrichment queue
  // -------------------------------------------------------------------------

  /**
   * Enqueue one durable backfill task per showroom onto the Agent's built-in
   * FIFO queue. Each task is processed by {@link backfillEnrichShowroom} with
   * automatic retry. Processing serializes through this single agent instance,
   * which naturally throttles the downstream Gemini / Workers-AI / scrape load
   * (the wave-of-N throttle the batch image pipeline needs).
   *
   * @param items  One entry per showroom to enrich (id + confirmed place + photos).
   * @returns The queued task IDs.
   */
  @callable()
  async enqueueBackfill(
    items: BackfillEnrichPayload[],
  ): Promise<{ queued: number; taskIds: string[] }> {
    const taskIds: string[] = [];
    for (const item of items ?? []) {
      if (!item || typeof item.showroomId !== "number") continue;
      const id = await this.queue("backfillEnrichShowroom", item);
      taskIds.push(id);
    }
    return { queued: taskIds.length, taskIds };
  }

  /**
   * Queue callback: run the "remaining intake steps" for a single showroom,
   * fill-blanks only. Mirrors the background work `POST /api/showroom-stores`
   * fires on create, plus the Gemini review analysis that bulk-imported rows
   * never received. Order:
   *   1. Gemini review insight → AI columns + brands (if placeId + still blank).
   *   2. Deep-sweep research → findings + images (only when none exist yet).
   *   3. Favicon hydration (if website + no icon).
   *   4. Website scrape workflow (if website + not yet scraped).
   *   5. Places photo pipeline → CF Images + hero (if photos + none stored).
   *
   * Each step is independently guarded so a single failure never aborts the
   * others; a thrown error propagates to the queue for retry with backoff.
   *
   * NOT `@callable` — invoked only by the Agent queue via its method name.
   */
  async backfillEnrichShowroom(payload: BackfillEnrichPayload): Promise<void> {
    const { showroomId } = payload;
    this.reportProgress(`Backfilling showroom ${showroomId}`);

    const db = drizzle(this.env.DB);
    const [store] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, showroomId))
      .limit(1);
    if (!store) {
      this.markComplete();
      return;
    }

    const placeId = payload.placeId ?? store.placeId ?? null;

    // 1. Gemini review insight (fill-blanks) + brand mapping.
    if (placeId) {
      try {
        await fillBlanksFromPlacesAI(this.env, showroomId, placeId);
      } catch (err) {
        console.error(`[backfill] Gemini insight failed for store ${showroomId}:`, err);
      }
    }

    // 2. Deep-sweep research — only when the store has no findings yet.
    try {
      if (!(await hasExistingFindings(this.env, showroomId))) {
        await this.researchStore(showroomId);
      }
    } catch (err) {
      console.error(`[backfill] research failed for store ${showroomId}:`, err);
    }

    // 3 + 4. Favicon + website scrape (fill-blanks guarded inside helpers).
    const websiteUrl = (await getStoreWebsiteUrl(db, showroomId)) ?? "";
    if (websiteUrl) {
      if (!store.iconCfImagesUrl) {
        try {
          await faviconService.hydrateShowroomIcon(this.env, showroomId, websiteUrl);
        } catch (err) {
          console.error(`[backfill] favicon failed for store ${showroomId}:`, err);
        }
      }
      await triggerBackfillScrape(this.env, showroomId, websiteUrl);
    }

    // 5. Places photo pipeline → CF Images + hero.
    if (payload.photos?.length) {
      await runBackfillPhotoPipeline(this.env, showroomId, payload.photos);
    }

    this.markComplete();
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
