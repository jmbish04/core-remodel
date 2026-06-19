import { Agent, callable } from "agents";

import {
  bidPortfolioChatMessages,
  bidPortfolios,
  bidPortfolioRoomConfigs,
  contacts,
  rooms,
} from "@backend/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

type BidPortfolioAgentState = {
  portfolioToken?: string;
  contactBusinessType?: string;
  showBudgetRanges?: boolean;
  roomScope?: number[];
};

type InitializeConfig = {
  portfolioToken: string;
  contactBusinessType: string;
  showBudgetRanges: boolean;
  roomScope: number[];
};

type ChatRequest = {
  conversationId: string;
  prompt: string;
};

type ChatResponse = {
  text: string;
};

const DEFAULT_STATE: BidPortfolioAgentState = {};

export class BidPortfolioAgent extends Agent<Env, BidPortfolioAgentState> {
  initialState = DEFAULT_STATE;

  @callable()
  async initialize(config: InitializeConfig): Promise<{ ok: boolean }> {
    this.setState({
      portfolioToken: config.portfolioToken,
      contactBusinessType: config.contactBusinessType,
      showBudgetRanges: config.showBudgetRanges,
      roomScope: config.roomScope,
    });
    return { ok: true };
  }

  @callable()
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const prompt = request.prompt.trim();
    const conversationId = request.conversationId || "bid-portfolio-chat";

    const state = this.state;
    const systemPrompt = await this.buildSystemPrompt(state);
    const text = await this.generateResponse(prompt, systemPrompt);

    await this.persistMessages(state, conversationId, prompt, text);

    return { text };
  }

  private async buildSystemPrompt(state: BidPortfolioAgentState): Promise<string> {
    const db = drizzle(this.env.DB);

    let roomNames: string[] = [];
    if (state.roomScope && state.roomScope.length > 0) {
      const allRooms = await db.select().from(rooms).all();
      roomNames = allRooms
        .filter((r) => state.roomScope!.includes(r.id))
        .map((r) => r.name);
    }

    const scopeDescription =
      roomNames.length > 0
        ? `The renovation project includes these rooms: ${roomNames.join(", ")}.`
        : "This renovation project covers the full home.";

    const roleGuidance = this.getRoleGuidance(state.contactBusinessType);

    const budgetGuidance = state.showBudgetRanges
      ? "The homeowner has chosen to share budget ranges. You may discuss general min/avg/max cost ranges for rooms or the overall project, but do NOT reveal exact line-item costs or detailed breakdowns."
      : "CRITICAL PRIVACY RULE: The homeowner has NOT authorized sharing budget information. You MUST NOT reveal any dollar amounts, cost ranges, budget figures, or financial details under any circumstances. If asked about budget, costs, pricing, or money, respond with: \"I'd recommend discussing budget specifics directly with the homeowner. I can help you with project scope, design details, timelines, and specifications instead.\" Do NOT hint at, approximate, or imply any financial figures.";

    return [
      "You are a renovation project assistant for a bid portfolio. You help professionals understand the renovation scope and provide relevant project details.",
      "",
      scopeDescription,
      "",
      roleGuidance,
      "",
      budgetGuidance,
      "",
      "Guidelines:",
      "- Be professional and concise.",
      "- Focus on renovation scope, specifications, timelines, and project details.",
      "- Tailor your language and emphasis to the professional's business type.",
      "- If you don't have specific information, say so honestly rather than guessing.",
    ].join("\n");
  }

  private getRoleGuidance(businessType?: string): string {
    switch (businessType) {
      case "contractor":
        return "You are speaking with a contractor. Emphasize construction specifications, material requirements, labor scope, timelines, permitting needs, and sequencing of work. Use trade-specific terminology they will expect.";
      case "architect":
        return "You are speaking with an architect. Emphasize design intent, aesthetic goals, spatial relationships, material finishes, and how rooms relate to each other. Discuss design language, proportions, and style coherence.";
      case "civil_engineer":
        return "You are speaking with a civil engineer. Emphasize structural considerations, load-bearing elements, foundation work, drainage, utility routing, and code compliance. Focus on engineering specifications and technical requirements.";
      default:
        return "You are speaking with a professional involved in this renovation. Provide clear, detailed information about the project scope and specifications.";
    }
  }

  private async generateResponse(prompt: string, systemPrompt: string): Promise<string> {
    const fallback = "Thank you for your question. I can help you understand the renovation project scope, room details, and specifications. What specific aspect would you like to know more about?";

    try {
      const response = await this.env.AI.run("@cf/openai/gpt-oss-120b", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });

      const generated =
        typeof response === "string"
          ? response
          : typeof response === "object" && response && "response" in response
            ? String(response.response)
            : "";

      return generated.trim() || fallback;
    } catch (error) {
      console.warn("BidPortfolioAgent AI response failed; using fallback.", error);
      return fallback;
    }
  }

  private async persistMessages(
    state: BidPortfolioAgentState,
    conversationId: string,
    userPrompt: string,
    assistantText: string,
  ): Promise<void> {
    if (!state.portfolioToken) return;

    const db = drizzle(this.env.DB);

    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.token, state.portfolioToken))
      .get();

    if (!portfolio) {
      console.warn(`BidPortfolioAgent: no portfolio found for token "${state.portfolioToken}"`);
      return;
    }

    await db
      .insert(bidPortfolioChatMessages)
      .values({
        portfolioId: portfolio.id,
        role: "user",
        content: userPrompt,
        metadata: JSON.stringify({ conversationId }),
      })
      .run();

    await db
      .insert(bidPortfolioChatMessages)
      .values({
        portfolioId: portfolio.id,
        role: "assistant",
        content: assistantText,
        metadata: JSON.stringify({ conversationId }),
      })
      .run();
  }
}
