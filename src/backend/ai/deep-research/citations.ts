/**
 * @fileoverview Grounding-source collection + citation resolution.
 *
 * Ports of the two ADK deep-research callbacks:
 *
 * - `collect_research_sources_callback` → {@link collectGroundingSources}:
 *   after every grounded Gemini call, walk
 *   `candidate.groundingMetadata.groundingChunks` (chunk.web.uri/title/domain)
 *   assigning stable short ids `src-1`, `src-2`, … via the `urlToShortId`
 *   map, and `groundingSupports` (`segment.text`, `confidenceScores`,
 *   `groundingChunkIndices`) into each source's `supportedClaims`. Sources
 *   accumulate across calls in {@link DeepResearchState}.
 *
 * - `citation_replacement_callback` → {@link resolveCitations}: replace
 *   `<cite source="src-N"/>` tags with ` [title](url)` markdown links, drop
 *   invalid tags with a `console.warn`, then fix whitespace left before
 *   punctuation.
 */

import type { DeepResearchSource, DeepResearchState } from "./types";

/**
 * The exact tag grammar the report composer is instructed to emit.
 * Tolerates optional quotes and stray whitespace, mirroring the ADK regex.
 */
export const CITE_TAG_REGEX =
  /<cite\s+source\s*=\s*["']?\s*(src-\d+)\s*["']?\s*\/>/g;

/** Best-effort hostname extraction for grounding chunks missing a domain. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Merge the grounding metadata of one Gemini response into the pipeline
 * state (mutates `state.sources` / `state.urlToShortId` in place — callers
 * that need step-level immutability clone the state before calling).
 *
 * @param response Raw Gemini `generateContent` response (any shape; walked
 *                 defensively — missing metadata is simply a no-op).
 * @param state    Accumulating deep-research state.
 * @returns The number of NEW sources registered by this call.
 */
export function collectGroundingSources(
  response: unknown,
  state: DeepResearchState,
): number {
  let added = 0;
  const candidates = (response as any)?.candidates ?? [];

  for (const candidate of candidates) {
    const meta = candidate?.groundingMetadata;
    const chunks: any[] = meta?.groundingChunks ?? [];

    // Map this candidate's chunk index → stable short id.
    const chunkShortIds: Array<string | null> = chunks.map((chunk) => {
      const uri = chunk?.web?.uri;
      if (typeof uri !== "string" || !uri.startsWith("http")) return null;

      let shortId = state.urlToShortId[uri];
      if (!shortId) {
        shortId = `src-${Object.keys(state.urlToShortId).length + 1}`;
        state.urlToShortId[uri] = shortId;
        added += 1;
      }
      if (!state.sources[shortId]) {
        const title = chunk?.web?.title;
        const domain = chunk?.web?.domain;
        state.sources[shortId] = {
          shortId,
          title:
            typeof title === "string" && title.trim() ? title : domainOf(uri),
          url: uri,
          domain:
            typeof domain === "string" && domain.trim()
              ? domain
              : domainOf(uri),
          supportedClaims: [],
        };
      }
      return shortId;
    });

    // groundingSupports: claim text segments ↔ chunk indices ↔ confidences.
    for (const support of meta?.groundingSupports ?? []) {
      const textSegment = support?.segment?.text;
      if (typeof textSegment !== "string" || !textSegment.trim()) continue;

      const indices: number[] = Array.isArray(support?.groundingChunkIndices)
        ? support.groundingChunkIndices
        : [];
      const scores: number[] = Array.isArray(support?.confidenceScores)
        ? support.confidenceScores
        : [];

      indices.forEach((chunkIndex, i) => {
        const shortId = chunkShortIds[chunkIndex];
        if (!shortId) return;
        const source = state.sources[shortId];
        if (!source) return;
        const confidence =
          typeof scores[i] === "number" && Number.isFinite(scores[i])
            ? scores[i]
            : 0.5;
        source.supportedClaims.push({ textSegment, confidence });
      });
    }
  }

  return added;
}

/**
 * Render the accumulated sources as `src-N: title (url)` lines for the
 * report-composer prompt. Built with the loop-template-literal pattern
 * (house rule: no `.join("\n")`).
 */
export function renderSourceList(
  sources: Record<string, DeepResearchSource>,
): string {
  const ordered = Object.values(sources).sort((a, b) => {
    const na = Number(a.shortId.slice(4));
    const nb = Number(b.shortId.slice(4));
    return na - nb;
  });
  if (ordered.length === 0) return "(no sources collected)";

  let output = "";
  for (const source of ordered) {
    output = `${output}${source.shortId}: ${source.title} (${source.url})
`;
  }
  return output.trimEnd();
}

/**
 * Resolve `<cite source="src-N"/>` tags to ` [title](url)` markdown links.
 * Invalid / unknown tags are dropped with a `console.warn`, and whitespace
 * left dangling before punctuation is collapsed (`"claim ."` → `"claim."`).
 */
export function resolveCitations(
  markdown: string,
  sources: Record<string, DeepResearchSource>,
): string {
  const replaced = markdown.replace(
    CITE_TAG_REGEX,
    (match, shortId: string) => {
      const source = sources[shortId];
      if (!source) {
        console.warn(
          `[deep-research] Dropping invalid citation tag (unknown source): ${match}`,
        );
        return "";
      }
      return ` [${source.title}](${source.url})`;
    },
  );
  // Fix spacing artifacts left by tag removal before punctuation.
  return replaced.replace(/\s+([.,;:])/g, "$1");
}
