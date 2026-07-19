/**
 * @fileoverview Showroom Scout — Layer 1 discovery: grounded web search.
 *
 * This is the agent's default search engine, and it is deliberately an isolated
 * call rather than grounding bolted onto the main loop's model.
 *
 * WHY THE SPLIT (this is a correctness constraint, not a style choice):
 * Google supports combining a built-in tool (Google Search grounding) with
 * custom function declarations only on Gemini 3. On Gemini 2.5 the request does
 * not cleanly fail — it silently misbehaves, commonly emitting a fabricated
 * functionCall instead of actually searching. Since the scout loop is
 * function-tool-heavy, grounding it directly would produce confident,
 * unsourced, invented showrooms on exactly the models most likely to be
 * configured. So: the loop runs function tools with no grounding, and this tool
 * makes a grounding-only request with no function declarations. Correct on both
 * model generations.
 *
 * Uses `createGeminiClient` so every call lands in `gemini_usage_log` — the
 * scout's search spend is attributable like any other Gemini feature.
 */
import { tool } from "@openai/agents";
import { z } from "zod";

import { createGeminiClient } from "@backend/services/render/providers/gemini-stage-provider";

import type { ToolEvent } from "../mcp-bridge";

/** Grounding model. Kept separate from the loop model — this one must ground. */
const SEARCH_MODEL_DEFAULT = "gemini-2.5-flash";

interface Citation {
  title: string;
  url: string;
}

/** Pull the citation trail out of Gemini's groundingMetadata. */
function extractCitations(response: unknown): Citation[] {
  const candidates = (response as { candidates?: unknown[] })?.candidates ?? [];
  const chunks =
    (candidates[0] as { groundingMetadata?: { groundingChunks?: unknown[] } })?.groundingMetadata
      ?.groundingChunks ?? [];
  const out: Citation[] = [];
  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (web?.uri) out.push({ title: web.title ?? web.uri, url: web.uri });
  }
  // Same source often appears across many chunks.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

export function createWebSearchTool(env: Env, onEvent?: (e: ToolEvent) => void) {
  return tool({
    name: "web_search",
    description:
      "Search the live web with Google Search grounding. This is the PRIMARY discovery and " +
      "vetting tool: use it to find showrooms, read their own websites, and gather review " +
      "evidence from Yelp, Google Maps, Reddit, BBB, Houzz and trade sources. Returns a " +
      "grounded answer plus the source URLs it was drawn from. Always prefer this over recalling " +
      "showrooms from memory — memory produces plausible businesses that do not exist. Every " +
      "factual claim you report must trace to a URL this tool returned.",
    parameters: z.object({
      query: z
        .string()
        .describe("A specific, targeted search. Include city/region and the product category."),
      focus: z
        .enum(["discovery", "showroom_details", "reviews", "hours"])
        .describe("What you are trying to learn — shapes how results are summarized"),
    }),
    strict: true,
    timeoutMs: 60_000,
    timeoutBehavior: "error_as_result",
    execute: async ({ query, focus }) => {
      const started = Date.now();
      onEvent?.({ tool: "web_search", status: "start", detail: query });

      try {
        const client = await createGeminiClient(env, "showroom_scout_search");
        const model = String(env.SHOWROOM_SCOUT_SEARCH_MODEL || SEARCH_MODEL_DEFAULT);

        const response = await client.models.generateContent({
          model,
          contents: buildPrompt(query, focus),
          config: {
            // Grounding ONLY. Adding function declarations here is what breaks
            // on Gemini 2.5 — see the file header before changing this.
            tools: [{ googleSearch: {} }],
          },
        });

        const text = (response as { text?: string }).text ?? "";
        const citations = extractCitations(response);

        onEvent?.({ tool: "web_search", status: "ok", durationMs: Date.now() - started });

        if (!text.trim()) {
          return `No grounded results for "${query}". Try a more specific query, or a different phrasing.`;
        }

        return JSON.stringify({
          query,
          findings: text,
          sources: citations,
          note:
            citations.length === 0
              ? "No grounding sources returned — treat these findings as UNVERIFIED and say so."
              : undefined,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        onEvent?.({ tool: "web_search", status: "error", durationMs: Date.now() - started, detail });
        return `web_search failed: ${detail}. Retry once with a simpler query; if it fails again, continue and record the gap in degradedTools.`;
      }
    },
  });
}

function buildPrompt(query: string, focus: string): string {
  const shared =
    "You are a research retrieval step for a home-remodel showroom scout. Search the web and " +
    "report ONLY what the sources actually say. Never invent a business, address, phone number, " +
    "or set of hours. If something is not found, say so plainly.";

  const byFocus: Record<string, string> = {
    discovery:
      "List real, currently-operating showrooms matching the query. For each: name, city, what " +
      "they sell, and whether they read as locally owned, bespoke, corporate, wholesale, " +
      "clearance, contractor-affiliated, or big-box. Exclude big-box chains unless the query asks " +
      "for them. Prefer specialists over general retailers.",
    showroom_details:
      "Report the showroom's own published details: website, phone, address, hours, social " +
      "profiles, brands carried, what is physically on display, appointment policy, trade/designer " +
      "positioning, and any virtual tour. Quote the site over third-party aggregators.",
    reviews:
      "Gather review evidence across Yelp, Google Maps, Reddit, BBB, and Houzz. Report recurring " +
      "positive themes and recurring negative themes separately. Include negatives even when the " +
      "overall rating is high. Note service quality, pricing transparency, and whether it reads as " +
      "inspirational, transactional, design-forward, contractor-oriented, or disorganized.",
    hours:
      "Report current published opening hours per day, especially Saturday and Sunday, plus " +
      "whether visits are appointment-only. Flag any notice of temporary or holiday closure. " +
      "State the date the hours were published if visible.",
  };

  return `${shared}\n\n${byFocus[focus] ?? byFocus.discovery}\n\nQuery: ${query}`;
}
