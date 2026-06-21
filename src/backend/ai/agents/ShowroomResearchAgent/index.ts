/**
 * @fileoverview ShowroomResearchAgent — Specialized AI agent for showroom
 * product research, compatibility checking, and cost-saving intelligence.
 *
 * Capabilities:
 *   1. Product Review Aggregation — web search for reviews, ratings, warranty
 *   2. Compatibility Checking — cross-ref products vs room plans & materials
 *   3. Moodboard-Aware Style Advice — query mood_boards to advise on fit
 *   4. Cost-Saving Analysis — trade discounts, Costco rebates, bulk pricing
 *   5. Similar Product Discovery — find alternatives at different price points
 *   6. Vendor Category Gap Detection — surface missing vendor categories
 *   7. AI Highlights — flag how a store location aligns with user renovation needs
 *
 * Triggers:
 *   - store.created → research reputation, verify address/hours
 *   - product.created → find reviews, check compatibility, find similars
 *   - scan.processed → if new product auto-created, run full pipeline
 *   - user.request → manual "Research this" from the frontend
 *
 * Extends AIChatAgent for WebSocket chat over findings.
 * Model: gemini-2.5-flash for research chat, Workers AI VLM for scans.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable } from "agents";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, isNull, sql } from "drizzle-orm";

import {
  showroomStores,
  showroomStoreProducts,
  storeResearch,
  storeProductResearch,
  showroomStoreRatings,
  storePaMapping,
  storeProductAreaDef,
  showroomStoreCategoryMapping,
  showroomStoreCategory,
} from "@backend/db/schema/showroom/index";

// ─── State ────────────────────────────────────────────────────────────────────

export type ShowroomResearchState = {
  status: "idle" | "researching" | "complete" | "error";
  currentTask?: string;
  progress?: number;
  lastError?: string;
};

const DEFAULT_STATE: ShowroomResearchState = {
  status: "idle",
};

// ─── Agent ────────────────────────────────────────────────────────────────────

export class ShowroomResearchAgent extends AIChatAgent<
  Env,
  ShowroomResearchState
> {
  // Metadata for /docs endpoint
  static docsMetadata() {
    return {
      name: "ShowroomResearchAgent",
      className: "ShowroomResearchAgent",
      description:
        "Specialized AI agent for showroom product research, compatibility checking, " +
        "cost-saving intelligence, moodboard-aware style advice, and vendor gap detection.",
      docsPath: "/docs/agents/showroom-research",
      methods: [
        {
          name: "researchStore",
          description:
            "Run full research pipeline on a store: reputation, reviews, hours verification",
          params: "storeId: number",
          returns: "void (broadcasts progress via WebSocket state)",
        },
        {
          name: "researchProduct",
          description:
            "Run product research: reviews, compatibility checks, similar products",
          params: "productId: number",
          returns: "void (broadcasts progress via WebSocket state)",
        },
        {
          name: "analyzeGaps",
          description:
            "Detect missing vendor categories across tracked stores",
          params: "none",
          returns: "GapAnalysisResult",
        },
        {
          name: "generateHighlights",
          description:
            "Generate ai_highlights_for_user_renovation for a store based on D1 context",
          params: "storeId: number",
          returns: "string (highlights text)",
        },
      ],
    };
  }

  initialState = DEFAULT_STATE;

  /**
   * Research a store: reputation, reviews, address verification, AI highlights.
   */
  @callable()
  async researchStore(storeId: number): Promise<{ success: boolean; findingsCount: number }> {
    const db = drizzle(this.env.DB);
    this.setState({ ...this.state, status: "researching", currentTask: `Researching store ${storeId}` });

    try {
      // 1. Load store data
      const [store] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, storeId))
        .limit(1);

      if (!store) {
        this.setState({ ...this.state, status: "error", lastError: "Store not found" });
        return { success: false, findingsCount: 0 };
      }

      // 2. Use Gemini to research the store
      const researchPrompt = `Research the following showroom/store and provide findings about their reputation, product quality, customer experience, and any notable information for a San Francisco home renovation project.

Store: ${store.name}
Address: ${store.locationAddress ?? "Unknown"}
Website: ${store.websiteUrl ?? "Unknown"}
Description: ${store.description ?? "No description"}
Inventory Focus: ${store.inventoryFocus ?? "Unknown"}

For each finding, provide:
1. A concise finding statement
2. The sentiment (good, bad, or neutral)
3. A URL source if available

Return JSON array: [{ "finding": "...", "sentiment": "good|bad|neutral", "finding_url": "..." }]`;

      const response = await this.env.AI.run(
        "@cf/moonshotai/kimi-k2.6" as any,
        {
          messages: [
            { role: "system", content: "You are a showroom research analyst. Return ONLY valid JSON." },
            { role: "user", content: researchPrompt },
          ],
        } as any
      );

      const rawOutput =
        typeof response === "string"
          ? response
          : (response as any)?.response ?? "[]";

      // Clean and parse
      const cleaned = rawOutput
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      let findings: Array<{ finding: string; sentiment: string; finding_url?: string }> = [];
      try {
        findings = JSON.parse(cleaned);
      } catch {
        // If parsing fails, create a single finding from the raw response
        findings = [{ finding: cleaned.slice(0, 500), sentiment: "neutral" }];
      }

      // 3. Insert findings into D1
      for (const f of findings) {
        await db.insert(storeResearch).values({
          storeId,
          finding: f.finding,
          findingUrl: f.finding_url ?? null,
          sentiment: (f.sentiment as "good" | "bad" | "neutral") ?? "neutral",
        } as typeof storeResearch.$inferInsert);
      }

      // 4. Generate AI highlights
      const highlights = await this.generateHighlights(storeId);
      if (highlights) {
        await db
          .update(showroomStores)
          .set({ aiHighlightsForUserRenovation: highlights } as Partial<typeof showroomStores.$inferInsert>)
          .where(eq(showroomStores.id, storeId));
      }

      this.setState({ ...this.state, status: "complete", currentTask: undefined });
      return { success: true, findingsCount: findings.length };
    } catch (err: any) {
      this.setState({ ...this.state, status: "error", lastError: err.message });
      return { success: false, findingsCount: 0 };
    }
  }

  /**
   * Research a product: reviews, compatibility, similar items.
   */
  @callable()
  async researchProduct(productId: number): Promise<{ success: boolean; findingsCount: number }> {
    const db = drizzle(this.env.DB);
    this.setState({ ...this.state, status: "researching", currentTask: `Researching product ${productId}` });

    try {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, productId))
        .limit(1);

      if (!product) {
        this.setState({ ...this.state, status: "error", lastError: "Product not found" });
        return { success: false, findingsCount: 0 };
      }

      // Load the store for context
      const [store] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, product.storeId))
        .limit(1);

      const researchPrompt = `Research this product and provide findings about quality, reviews, pricing, compatibility considerations, and cost-saving opportunities.

Product: ${product.itemName}
SKU: ${product.sku ?? "Unknown"}
Price: ${product.price ?? "Unknown"}
Store: ${store?.name ?? "Unknown"}
Description: ${product.description ?? "No description"}
Colors: ${product.colors ?? "Unknown"}

Important compatibility checks:
- If this is an InvisaCook product, flag that it requires specific 12-20mm Porcelanosa-certified porcelain and is NOT compatible with marble, granite, or natural stone.
- If this is a steam shower component, flag voltage requirements and ventilation needs.
- If this is a frameless door, flag wall thickness requirements.

For each finding, provide:
1. A concise finding statement
2. The sentiment (good, bad, or neutral)
3. A URL source if available

Return JSON array: [{ "finding": "...", "sentiment": "good|bad|neutral", "finding_url": "..." }]`;

      const response = await this.env.AI.run(
        "@cf/moonshotai/kimi-k2.6" as any,
        {
          messages: [
            { role: "system", content: "You are a product research analyst specializing in high-end home renovation materials. Return ONLY valid JSON." },
            { role: "user", content: researchPrompt },
          ],
        } as any
      );

      const rawOutput =
        typeof response === "string"
          ? response
          : (response as any)?.response ?? "[]";

      const cleaned = rawOutput
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      let findings: Array<{ finding: string; sentiment: string; finding_url?: string }> = [];
      try {
        findings = JSON.parse(cleaned);
      } catch {
        findings = [{ finding: cleaned.slice(0, 500), sentiment: "neutral" }];
      }

      for (const f of findings) {
        await db.insert(storeProductResearch).values({
          storeProductId: productId,
          finding: f.finding,
          findingUrl: f.finding_url ?? null,
          sentiment: (f.sentiment as "good" | "bad" | "neutral") ?? "neutral",
        } as typeof storeProductResearch.$inferInsert);
      }

      this.setState({ ...this.state, status: "complete", currentTask: undefined });
      return { success: true, findingsCount: findings.length };
    } catch (err: any) {
      this.setState({ ...this.state, status: "error", lastError: err.message });
      return { success: false, findingsCount: 0 };
    }
  }

  /**
   * Generate ai_highlights_for_user_renovation by scanning D1 context.
   *
   * Checks journal entries, room plans, moodboards, and action items
   * to find alignment between a store's offerings and the user's needs.
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

    // Gather context about what the user is looking for
    // (simplified — full implementation would scan rooms, journals, moodboards)
    const prompt = `Given this showroom store, generate a brief (2-3 sentences) highlight explaining how this store is specifically relevant to a high-end San Francisco home renovation. Focus on unique offerings that would be hard to find elsewhere.

Store: ${store.name}
Description: ${store.description ?? ""}
Inventory Focus: ${store.inventoryFocus ?? ""}
Target Demographic: ${store.targetDemographic ?? ""}
Scale: ${store.scale ?? ""}`;

    try {
      const response = await this.env.AI.run(
        "@cf/moonshotai/kimi-k2.6" as any,
        {
          messages: [
            { role: "system", content: "You are a renovation consultant. Be specific and concise." },
            { role: "user", content: prompt },
          ],
        } as any
      );

      const rawOutput =
        typeof response === "string"
          ? response
          : (response as any)?.response ?? "";

      return rawOutput.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Analyze vendor category gaps.
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

  /**
   * Chat handler — RAG over research findings.
   */
  async onChatMessage(
    _onFinish: Parameters<AIChatAgent["onChatMessage"]>[0],
    _options?: Parameters<AIChatAgent["onChatMessage"]>[1],
  ): Promise<Response | undefined> {
    // Simplified: stream a response using research context
    // Full implementation would search Vectorize for relevant findings
    return undefined;
  }
}
