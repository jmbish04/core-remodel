/**
 * @fileoverview Finder types (0032 D2d) — REST-shape mirrors for the discovery finder
 * (backed by /api/showroom-searches* + /api/showroom-exclusions*, the D2c-1 routes).
 */

export type SearchStatus = "running" | "ready" | "refining" | "final" | "error";

/** A row of GET /api/showroom-searches. */
export interface SearchSummary {
  id: number;
  slug: string;
  title: string | null;
  status: SearchStatus;
  currentRevision: number;
  resultCount: number;
  summary: string | null;
  origin: "mcp" | "ui" | null;
  createdAt: number | string;
  updatedAt: number | string;
}

/** A result row of GET /api/showroom-searches/:slug. */
export interface SearchResult {
  id: number;
  searchId: number;
  revisionId: number;
  placeId: string | null;
  name: string | null;
  fullAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  categoryGuess: string | null;
  primaryType: string | null;
  phone: string | null;
  website: string | null;
  googleRating: number | null;
  userRatingCount: number | null;
  openingHoursJson: string | null;
  source: "places" | "ai";
  aiRelevance: number | null;
  aiReasoning: string | null;
  distanceM: number | null;
  inDirectory: boolean;
  existingStoreId: number | null;
  isExcluded: boolean;
  matchedExclusionId: number | null;
  importedAt: number | string | null;
  rank: number | null;
}

export interface SearchDetail {
  search: SearchSummary & { paramsJson: string | null };
  results: SearchResult[];
}

export interface SearchRevision {
  id: number;
  revisionNumber: number;
  source: "places" | "ai" | "mixed";
  usedPlaces: boolean;
  changeNote: string | null;
  createdAt: number | string;
}

export interface Exclusion {
  id: number;
  placeId: string | null;
  name: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  reasonMarkdown: string | null;
  source: "manual" | "ai";
  createdAt: number | string;
}

export const STATUS_LABEL: Record<SearchStatus, string> = {
  running: "Running",
  ready: "Ready",
  refining: "Refining",
  final: "Final",
  error: "Error",
};
