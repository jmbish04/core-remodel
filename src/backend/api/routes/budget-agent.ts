import { BudgetAgent } from "@backend/ai/agents/BudgetAgent";
import { type BudgetProposal } from "@backend/services/budget-model";
import { getAgentByName } from "agents";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { Hono } from "hono";

const budgetAgentRouter = new Hono<{ Bindings: Env }>();

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;

  if (typeof record.content === "string") return record.content;

  const parts = Array.isArray(record.parts) ? record.parts : Array.isArray(record.content) ? record.content : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const partRecord = part as Record<string, unknown>;
      return partRecord.type === "text" && typeof partRecord.text === "string" ? partRecord.text : "";
    })
    .join("\n")
    .trim();
}

budgetAgentRouter.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    messages?: unknown[];
  };
  const conversationId = body.id || "budget-dashboard";
  const latestUserMessage = [...(body.messages ?? [])]
    .reverse()
    .find((message) => Boolean(message && typeof message === "object" && (message as { role?: string }).role === "user"));
  const prompt = extractMessageText(latestUserMessage);

  if (!prompt) {
    return c.json({ error: "A user message is required." }, 400);
  }

  const agent = await getAgentByName<Env, BudgetAgent>(c.env.BUDGET_AGENT as any, "budget-dashboard");
  const result = await agent.chat({ conversationId, prompt });

  const stream = createUIMessageStream<UIMessage>({
    originalMessages: (body.messages ?? []) as UIMessage[],
    execute({ writer }) {
      const textId = crypto.randomUUID();
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: textId });
      writer.write({ type: "text-delta", id: textId, delta: result.text });
      writer.write({ type: "text-end", id: textId });

      for (const proposal of result.proposals) {
        writer.write({
          type: "data-budget_proposals",
          id: proposal.id,
          data: proposal,
          transient: false,
        } as any);
      }

      writer.write({ type: "finish", finishReason: "stop" });
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache",
    },
  });
});

budgetAgentRouter.post("/approve", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { proposal?: BudgetProposal };

  if (!body.proposal) {
    return c.json({ error: "A proposal is required." }, 400);
  }

  const agent = await getAgentByName<Env, BudgetAgent>(c.env.BUDGET_AGENT as any, "budget-dashboard");
  const result = await agent.applyProposal(body.proposal);

  return c.json(result);
});

export { budgetAgentRouter };
