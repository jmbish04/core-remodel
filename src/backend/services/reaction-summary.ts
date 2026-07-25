// src/backend/services/reaction-summary.ts
/**
 * @fileoverview Distill a spoken/typed product reaction into a compact style
 * record (Phase D2). Feeds the per-candidate `reaction_summary` and, later, the
 * "Spotify wrapped" style profile (Phase F). Faithful to what was said — the
 * prompt forbids inventing preferences the person did not express.
 */
import { z } from "zod";

import { generateStructuredOutput } from "@backend/ai/providers/index";

export const REACTION_SUMMARY_SCHEMA = z.object({
  summary: z
    .string()
    .nullable()
    .optional()
    .catch(null)
    .describe("1-2 sentence distillation of the person's reaction to this product"),
  likes: z
    .array(z.string())
    .nullable()
    .optional()
    .catch(null)
    .describe("Specific aspects they liked (finish, material, shape, price, …)"),
  dislikes: z.array(z.string()).nullable().optional().catch(null).describe("Specific aspects they disliked"),
  sentiment: z
    .enum(["positive", "neutral", "negative"])
    .nullable()
    .optional()
    .catch("neutral")
    .describe("Overall sentiment toward the product"),
});

export type ReactionSummary = z.infer<typeof REACTION_SUMMARY_SCHEMA>;

export async function summarizeStyleReaction(
  env: Env,
  transcript: string,
  ctx?: { productName?: string | null; brandName?: string | null },
): Promise<ReactionSummary> {
  const label = [ctx?.brandName, ctx?.productName].filter(Boolean).join(" ").trim();
  return generateStructuredOutput(env, {
    messages: [
      {
        role: "system",
        content:
          "You distill a person's reaction to a home-remodeling product into a compact style-preference record. " +
          "Capture what they liked and disliked about the look, finish, materials, and price. Be faithful to what " +
          "they actually said — never invent a preference they did not express. If the reaction is empty or says " +
          "nothing about the product, return a null summary and empty lists.",
      },
      {
        role: "user",
        content: `Product: ${label || "(unknown)"}\n\nTheir reaction:\n"${transcript}"\n\nDistill it into the schema.`,
      },
    ],
    schema: REACTION_SUMMARY_SCHEMA,
    schemaName: "StyleReactionSummary",
  });
}
