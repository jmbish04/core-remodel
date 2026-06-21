/**
 * @fileoverview Stateful Budget Analysis Agent
 * Powered by Cloudflare Agents SDK and Dynamic Worker Isolates.
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, tool } from "ai";
import { z } from "zod";
import { callable } from "agents";
import {
  applyBudgetProposal,
  loadBudgetSnapshot,
  type BudgetProposal,
} from "@backend/services/budget-model";

export class BudgetAgent extends AIChatAgent<Env> {
  async onChatMessage(onFinish: any) {
    const aiProvider = createWorkersAI({ binding: this.env.AI });
    const model = aiProvider("@cf/meta/llama-3.1-8b-instruct");

    return streamText({
      model,
      messages: await convertToModelMessages(this.messages),
      tools: {
        computeFinancialMatrix: tool({
          description: "Runs financial data modeling pipelines inside a Dynamic Worker isolate to compile normalized chart structures.",
          parameters: z.object({
            rawData: z.array(z.record(z.any())).description("The unformatted ledger data rows."),
            aggregationScript: z.string().description("JavaScript code statement executing clean array transformations.")
          }),
          execute: async ({ rawData, aggregationScript }) => {
            try {
              let processedPayload;
              if (this.env.LOADER) {
                const secureIsolate = await this.env.LOADER.load({
                  main: `
                    export default {
                      async fetch(req) {
                        const data = ${JSON.stringify(rawData)};
                        const transform = (items) => { ${aggregationScript} };
                        return new Response(JSON.stringify(transform(data)));
                      }
                    };
                  `
                });
                
                const res = await secureIsolate.fetch(new Request("http://sandbox.internal/"));
                processedPayload = await res.json();
              } else {
                // Security: never execute untrusted user-supplied scripts (`aggregationScript`)
                // in the main isolate — it has access to env bindings, secrets, and the DB (RCE).
                // Require the sandboxed Worker LOADER; refuse to run otherwise.
                throw new Error(
                  "Security Error: env.LOADER binding is not present. Execution of untrusted scripts is disabled.",
                );
              }
              
              return { success: true, payload: processedPayload };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          }
        }),
        generateBudgetChart: tool({
          description: "Evaluates timeframe, asset classes, and velocity vectors to compile chart visualization structures.",
          parameters: z.object({
            timeframe: z.string().description("The timeframe for the chart, e.g. '12m', '6m'."),
            assetClasses: z.array(z.string()).description("List of asset classes to evaluate."),
            velocityVectors: z.array(z.number()).description("Velocity vectors representing cost growth rate trends.")
          }),
          execute: async ({ timeframe, assetClasses, velocityVectors }) => {
            return {
              success: true,
              chartData: {
                timeframe,
                assetClasses,
                velocityVectors,
                series: assetClasses.map((ac, idx) => ({
                  name: ac,
                  data: [100, 120, 150].map(v => v * (velocityVectors[idx] || 1))
                }))
              }
            };
          }
        })
      },
      onFinish,
    });
  }

  @callable()
  async applyProposal(proposal: BudgetProposal) {
    const result = await applyBudgetProposal(this.env, proposal);
    return result;
  }

  @callable()
  async snapshot() {
    return loadBudgetSnapshot(this.env);
  }

  @callable()
  async chat(request: { conversationId: string; prompt: string }) {
    const prompt = request.prompt.trim();
    const aiProvider = createWorkersAI({ binding: this.env.AI });
    const model = aiProvider("@cf/meta/llama-3.1-8b-instruct");
    const res = await streamText({
      model,
      messages: [{ role: "user", content: prompt }],
    });
    const text = await res.text;
    return { text, proposals: [] };
  }
}
