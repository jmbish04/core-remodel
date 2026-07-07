/**
 * @fileoverview AdminChatAgent — General-purpose admin chat assistant
 *
 * Extends AIChatAgent from @cloudflare/ai-chat for the Cloudflare Agents SDK.
 * Provides general conversation using Workers AI models with runtime model
 * selection. Supports Kimi K2.6, Llama 4 Scout, and Llama 3.3 70B.
 *
 * Chat sessions are persisted via the DO's SQLite storage.
 */

import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages } from "ai";

/** Available models for the admin chat, ordered by default preference. */
const MODELS: Record<string, string> = {
  "kimi-k2.6": "@cf/moonshotai/kimi-k2.6",
  "llama-4-scout": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "llama-3.3-70b": "@cf/meta/llama-3.3-70b-instruct-fp8-loftq",
};

const DEFAULT_MODEL_KEY = "kimi-k2.6";

const SYSTEM_PROMPT = `You are the admin assistant for The Monolith — a Cloudflare Workers + Astro platform that manages a luxury home renovation project in San Francisco.

You are knowledgeable about:
- Home remodeling, interior design, and luxury fixtures
- Bay Area showrooms and sourcing (plumbing, tile, lighting, closets, etc.)
- Budget management and contractor coordination
- Permit processes and city inspection workflows
- The Cloudflare Workers ecosystem (D1, R2, Durable Objects, Workers AI, Vectorize)

You respond concisely but thoroughly. You use markdown formatting when helpful.
When asked about data in the system, suggest relevant admin pages or API endpoints.
Always be direct and practical.`;

export class AdminChatAgent extends AIChatAgent<Env> {
  async onChatMessage(onFinish: any, options?: OnChatMessageOptions) {
    const aiProvider = createWorkersAI({ binding: this.env.AI });

    // Resolve model from the client's custom body ({ body: { model } } on
    // useAgentChat — the 0.7.1 channel for client params) or fall back.
    const bodyModel = options?.body?.model;
    const requestedModel =
      typeof bodyModel === "string" ? bodyModel : DEFAULT_MODEL_KEY;
    const modelId = MODELS[requestedModel] ?? MODELS[DEFAULT_MODEL_KEY];
    const model = aiProvider(modelId);

    return streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      onFinish,
    });
  }
}
