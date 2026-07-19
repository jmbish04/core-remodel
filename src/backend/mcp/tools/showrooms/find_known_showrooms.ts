/**
 * @fileoverview MCP tool — find_known_showrooms (Showrooms domain).
 *
 * Directory dedupe. A discovery run's whole value is finding places the user
 * does NOT already know about, so every candidate is checked against the
 * registered directory before it can be recommended as new.
 *
 * Batched deliberately: a scout evaluates 20–40 candidates per run, and doing
 * that as one call per name burns agent turns and latency.
 */
import { showroomStores } from "@backend/db";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

/**
 * Normalize a business name for comparison.
 *
 * Drops punctuation, legal suffixes and generic trade words so
 * "Ferguson Bath, Kitchen & Lighting Gallery" matches "Ferguson Bath Kitchen
 * and Lighting". Intentionally aggressive — a false "already known" is cheap to
 * override (the user can ask to include known entries), while a false "new"
 * wastes a real drive to a showroom they have already visited.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(
      /\b(inc|llc|ltd|co|corp|company|the|gallery|showroom|showrooms|store|stores|supply|design|center|centre)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-overlap ratio against the shorter name — resists extra descriptors. */
function similarity(a: string, b: string): number {
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return shared / Math.min(at.size, bt.size);
}

export const findKnownShowrooms = defineTool({
  name: "find_known_showrooms",
  category: "showrooms",
  title: "Check which showrooms are already in the directory",
  description:
    "Batch directory dedupe. Pass the candidate showrooms you just discovered (name, and " +
    "`placeId`/`city` when known) and this returns, for each, whether it is ALREADY registered in " +
    "the core-remodel showroom directory. Match order: exact Google `placeId` first, then " +
    "normalized-name similarity scoped by city. Use this before recommending anything as a NEW " +
    "discovery — already-known showrooms must be excluded from new-discovery results unless the " +
    "user explicitly asked to include known entries. Returns { results: [{ query, known, " +
    "showroomStoreId, matchedName, matchedOn, confidence, url }] }.",
  inputShape: {
    candidates: z
      .array(
        looseObject({
          name: z.string().min(1).describe("Candidate showroom name as discovered"),
          placeId: z.string().optional().describe("Google Places id, when enrichment supplied one"),
          city: z.string().optional().describe("City — disambiguates same-name branches"),
        }),
      )
      .min(1)
      .max(50)
      .describe("Candidates to check (batch them — do not call once per name)"),
    minConfidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Name-similarity threshold to count as known (default 0.7)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    results: z.array(
      looseObject({
        query: z.string(),
        known: z.boolean(),
        showroomStoreId: z.number().int().nullable(),
        matchedName: z.string().nullable(),
        matchedOn: z.enum(["place_id", "name", "none"]),
        confidence: z.number(),
        url: z.string().nullable().describe("Directory page for the matched showroom, if known"),
      }),
    ),
    knownCount: z.number().int(),
    newCount: z.number().int(),
  },
  examples: [
    {
      title: "Dedupe a batch of freshly discovered stone yards",
      args: {
        candidates: [
          { name: "Da Vinci Marble", city: "Redwood City" },
          { name: "Cactus Stone & Tile", placeId: "ChIJexample" },
        ],
      },
    },
  ],
  handler: async (ctx, input) => {
    const threshold = input.minConfidence ?? 0.7;

    // One scan of the directory serves the whole batch. The table is in the
    // low thousands of rows; per-candidate queries would be far more expensive.
    const rows = await ctx.db
      .select({
        id: showroomStores.id,
        name: showroomStores.name,
        placeId: showroomStores.placeId,
        city: showroomStores.locationCity,
      })
      .from(showroomStores);

    const byPlaceId = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (r.placeId) byPlaceId.set(r.placeId, r);

    const indexed = rows.map((r) => ({ row: r, norm: normalizeName(r.name ?? "") }));

    const results = input.candidates.map((candidate) => {
      // 1. Exact placeId — the only truly authoritative match.
      if (candidate.placeId) {
        const hit = byPlaceId.get(candidate.placeId);
        if (hit) {
          return {
            query: candidate.name,
            known: true,
            showroomStoreId: hit.id,
            matchedName: hit.name,
            matchedOn: "place_id" as const,
            confidence: 1,
            url: showroomUrl(ctx.env, hit.id),
          };
        }
      }

      // 2. Normalized name, optionally scoped by city.
      const norm = normalizeName(candidate.name);
      const wantCity = candidate.city?.toLowerCase().trim();
      let best: { row: (typeof rows)[number]; score: number } | null = null;

      for (const { row, norm: rowNorm } of indexed) {
        if (wantCity && row.city && row.city.toLowerCase().trim() !== wantCity) continue;
        const score = similarity(norm, rowNorm);
        if (!best || score > best.score) best = { row, score };
      }

      if (best && best.score >= threshold) {
        return {
          query: candidate.name,
          known: true,
          showroomStoreId: best.row.id,
          matchedName: best.row.name,
          matchedOn: "name" as const,
          confidence: Number(best.score.toFixed(2)),
          url: showroomUrl(ctx.env, best.row.id),
        };
      }

      return {
        query: candidate.name,
        known: false,
        showroomStoreId: null,
        matchedName: null,
        matchedOn: "none" as const,
        confidence: best ? Number(best.score.toFixed(2)) : 0,
        url: null,
      };
    });

    return {
      results,
      knownCount: results.filter((r) => r.known).length,
      newCount: results.filter((r) => !r.known).length,
    };
  },
});
