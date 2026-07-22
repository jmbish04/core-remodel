/**
 * @fileoverview Brand-name reconciliation — decide create / skip / rename before
 * any brand row is written.
 *
 * WHY THIS EXISTS
 * `ensure_brand` matched on exact lowercase name, so every spelling variant of a
 * brand created a NEW row. The live table accumulated 9 duplicate pairs that way
 * — "Dornbracht" + "DORN BRACHT", "Wetstyle" + "WET STYLE", "Newport Brass" +
 * "NEWPORTBRASS" — and each pair actively splits `showroom_brand_mappings`, so
 * the directory shows one brand twice with half its showrooms each.
 *
 * Pure normalisation is not enough either. It catches "WET STYLE" but not
 * "Visual Comfort" vs "Visual Comfort & Co.", and any rule aggressive enough to
 * merge those will also merge things that genuinely differ ("Kohler" vs
 * "Kohler Signature Store"). That judgement is what the model is for.
 *
 * SHAPE OF THE PIPELINE — cheap and certain first, model only for the doubt:
 *   1. Deterministic pass. Exact + normalised-key match resolves most inputs
 *      with no tokens spent and no chance of a hallucinated id.
 *   2. Shortlist. Each remaining candidate gets the few most similar existing
 *      brands, so the prompt carries ~5 rows instead of all ~370. Smaller
 *      prompts are cheaper AND measurably more accurate here.
 *   3. Model pass, structured output.
 *   4. Validation. The model PROPOSES; this module VERIFIES. Every id must
 *      exist, every name must be one we asked about, every candidate must land
 *      in exactly one bucket, and no rename may collide with another brand.
 *      Anything that fails validation degrades to "create", which is the
 *      recoverable direction — a spurious duplicate can be merged later, a
 *      wrongly-skipped brand silently loses data.
 */

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { brands } from "@backend/db/schema/brands/brands";
import { generateStructured } from "@backend/services/structured-output";

/** Enough for a full decision set; short of this the JSON truncates mid-object. */
const MAX_TOKENS = 4096;

/** Cost-attribution label for the Gemini usage ledger. */
const FEATURE = "brand_reconcile";

/** Existing brands offered to the model per candidate. */
const SHORTLIST_SIZE = 6;

/** Candidates per model call — keeps prompts small and failures granular. */
const BATCH_SIZE = 12;

export interface BrandCandidate {
  name: string;
  /** Optional context that makes matching far more reliable when present. */
  websiteUrl?: string | null;
}

export interface ExistingBrand {
  id: number;
  /** Display name — the `is_primary` variation. */
  name: string;
  websiteUrl?: string | null;
  /**
   * Every other spelling this brand is known by, from `brand_name_variations`.
   *
   * These are lookup keys, and they are why the table exists: once "DORN
   * BRACHT" is recorded as an alias of Dornbracht, the next scrape that spells
   * it that way matches instead of forking a new brand. The set only improves.
   */
  aliases?: string[];
}

export interface SkippedBrand {
  name: string;
  matchedBrandId: number;
  matchedBrandName: string;
  /** How the decision was reached — "exact", "normalized", or the model's reason. */
  reason: string;
}

export interface BrandCleanup {
  brandId: number;
  existingBrandName: string;
  newCleanupBrandName: string;
  reason: string;
}

export interface BrandReconciliation {
  /** Names with no existing counterpart — safe to insert. */
  newBrandNamesToCreate: string[];
  /**
   * Names that already exist. Objects rather than bare strings: a skip is a
   * silent no-op at the call site, so it has to be auditable — which row it
   * matched and why.
   */
  newBrandNamesToSkip: SkippedBrand[];
  /**
   * Renames for existing rows whose stored name is a degraded form of the
   * candidate ("DORN BRACHT" -> "Dornbracht"). Applied by `applyBrandCleanups`.
   */
  existingBrandNamesToCleanup: BrandCleanup[];
  /** Decisions the model returned that failed validation, kept for debugging. */
  rejected: string[];
}

/**
 * Normalised match key: lowercase, drop parentheticals and corporate suffixes,
 * then strip every non-alphanumeric character.
 *
 * Catches "WET STYLE"/"Wetstyle", "DORN BRACHT"/"Dornbracht" and
 * "Water, Inc."/"Water Inc.". Deliberately does NOT try to catch
 * "Visual Comfort & Co."/"Visual Comfort" — stripping a trailing "co" also
 * mangles legitimate names, so that call is left to the model.
 */
export function brandNameKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(inc|llc|ltd|corp|company|usa|group|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Registrable domain, used as a strong match signal when both sides have one. */
export function brandDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const host = String(url)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();
  const parts = host.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : host || null;
}

/**
 * How well-formed a brand name is. Higher wins.
 *
 * Case dominates word-breaks, deliberately. An earlier version tested the two
 * traits independently and concluded that "DORN BRACHT" should replace
 * "Dornbracht" — because the candidate had a space and the stored name did not
 * — which would have degraded a good row instead of repairing a bad one. Case
 * is the stronger signal of a bulk-import artifact, so it is weighted an order
 * of magnitude above spacing.
 */
function nameQuality(name: string): number {
  const letters = name.replace(/[^A-Za-z]/g, "");
  let caseScore = 2; // mixed / title case
  if (letters.length > 1 && name === name.toUpperCase()) caseScore = 0; // ALL CAPS
  else if (letters.length > 1 && name === name.toLowerCase()) caseScore = 1; // all lower
  return caseScore * 10 + (/\s/.test(name.trim()) ? 1 : 0);
}

/**
 * True when `candidate` is a strictly better-formed spelling of the same brand
 * than `stored`, so the stored row is worth rewriting.
 *
 *   "NEWPORTBRASS"   -> "Newport Brass"    0 vs 21  rename
 *   "KravetContract" -> "Kravet Contract" 20 vs 21  rename
 *   "Dornbracht"     vs "DORN BRACHT"     20 vs  1  keep stored
 */
function isDegradedName(stored: string, candidate: string): boolean {
  if (stored === candidate) return false;
  return nameQuality(candidate) > nameQuality(stored);
}

/**
 * Rank existing brands by rough similarity to a candidate, so the model sees a
 * handful of plausible rows rather than the whole table.
 */
function shortlist(candidate: BrandCandidate, existing: ExistingBrand[]): ExistingBrand[] {
  const key = brandNameKey(candidate.name);
  const domain = brandDomain(candidate.websiteUrl);
  const tokens = new Set(
    candidate.name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
  );

  return existing
    .map((row) => {
      const rowKey = brandNameKey(row.name);
      let score = 0;
      // Substring either direction catches "visualcomfort" vs "visualcomfortco".
      if (rowKey && key && (rowKey.includes(key) || key.includes(rowKey))) score += 10;
      if (domain && brandDomain(row.websiteUrl) === domain) score += 8;
      for (const t of row.name.toLowerCase().split(/[^a-z0-9]+/)) {
        if (t.length > 2 && tokens.has(t)) score += 3;
      }
      // Shared prefix — "Kravet…" against "KravetContract".
      if (rowKey && key && rowKey.slice(0, 5) === key.slice(0, 5)) score += 2;
      return { row, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE)
    .map((r) => r.row);
}

const RECONCILE_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          candidateName: { type: "string" },
          verdict: { type: "string", enum: ["create", "skip"] },
          matchedBrandId: { type: ["number", "null"] },
          betterName: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: ["candidateName", "verdict", "matchedBrandId", "betterName", "reason"],
      },
    },
  },
  required: ["decisions"],
};

interface ModelDecision {
  candidateName?: unknown;
  verdict?: unknown;
  matchedBrandId?: unknown;
  betterName?: unknown;
  reason?: unknown;
}

function buildPrompt(batch: Array<{ candidate: BrandCandidate; options: ExistingBrand[] }>): string {
  const blocks = batch.map(({ candidate, options }, index) => {
    const rows = options.length
      ? options
          .map((o) => `      - id=${o.id} name="${o.name}"${o.websiteUrl ? ` site=${o.websiteUrl}` : ""}`)
          .join("\n")
      : "      (none)";
    return (
      `  ${index + 1}. candidate: "${candidate.name}"` +
      `${candidate.websiteUrl ? ` (site: ${candidate.websiteUrl})` : ""}\n` +
      `     existing brands that might be the same company:\n${rows}`
    );
  });

  return `You are de-duplicating a home-renovation brand registry. For each candidate brand name, decide whether it is the SAME COMPANY as one of the existing brands listed under it.

Rules:
- verdict "skip" means the candidate already exists; set matchedBrandId to that brand's id.
- verdict "create" means it is a genuinely different company; matchedBrandId must be null.
- Same company despite different spelling => skip. Examples: "DORN BRACHT" and "Dornbracht"; "Visual Comfort & Co." and "Visual Comfort"; "Water, Inc." and "Water Inc."
- Different companies that merely share words => create. Examples: "Kohler" vs "Kohler Signature Store"; "Newport Brass" vs "Newport Lighting"; a parent brand vs a distinct sub-brand sold separately.
- betterName: when the EXISTING stored name is a degraded form (ALL CAPS, missing spaces, misspelled) and the candidate is the cleaner spelling of the same company, set betterName to the cleaner name. Otherwise null.
- Only ever reference an id from the list shown for that candidate. Never invent one.
- Return exactly one decision per candidate, using the candidate name verbatim.

Candidates:
${blocks.join("\n")}

Respond ONLY with JSON matching the schema.`;
}

/**
 * Ask the model to resolve the ambiguous candidates.
 *
 * Never throws: a model failure degrades every candidate in the batch to
 * "create", which is the recoverable direction.
 */
async function askModel(
  env: Env,
  batch: Array<{ candidate: BrandCandidate; options: ExistingBrand[] }>,
): Promise<ModelDecision[]> {
  const { data } = await generateStructured<{ decisions?: ModelDecision[] }>(env, {
    feature: FEATURE,
    system:
      "You reconcile brand registries. You are precise about company identity and respond only with JSON.",
    prompt: buildPrompt(batch),
    schema: RECONCILE_SCHEMA,
    maxTokens: MAX_TOKENS,
  });

  return Array.isArray(data.decisions) ? data.decisions : [];
}

/**
 * Decide what to do with a set of candidate brand names.
 *
 * Read-only: computes the plan, writes nothing. Callers apply it — see
 * `applyBrandCleanups` for the rename half.
 */
export async function reconcileBrandNames(
  env: Env,
  existing: ExistingBrand[],
  candidates: BrandCandidate[],
): Promise<BrandReconciliation> {
  const out: BrandReconciliation = {
    newBrandNamesToCreate: [],
    newBrandNamesToSkip: [],
    existingBrandNamesToCleanup: [],
    rejected: [],
  };

  const byId = new Map(existing.map((b) => [b.id, b]));
  // Index the display name AND every recorded alias, so a candidate spelled the
  // way some other source spells it resolves without ever reaching the model.
  const byKey = new Map<string, ExistingBrand>();
  for (const row of existing) {
    for (const name of [row.name, ...(row.aliases ?? [])]) {
      const key = brandNameKey(name);
      if (key && !byKey.has(key)) byKey.set(key, row);
    }
  }

  // Dedupe the input itself — a roster can list the same brand twice, and two
  // candidates resolving to one create would insert a fresh duplicate.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = brandNameKey(c.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── 1. Deterministic pass ────────────────────────────────────────────────
  const unresolved: BrandCandidate[] = [];
  for (const candidate of unique) {
    const hit = byKey.get(brandNameKey(candidate.name));
    if (!hit) {
      unresolved.push(candidate);
      continue;
    }
    out.newBrandNamesToSkip.push({
      name: candidate.name,
      matchedBrandId: hit.id,
      matchedBrandName: hit.name,
      reason: hit.name === candidate.name ? "exact" : "normalized",
    });
    if (isDegradedName(hit.name, candidate.name)) {
      out.existingBrandNamesToCleanup.push({
        brandId: hit.id,
        existingBrandName: hit.name,
        newCleanupBrandName: candidate.name,
        reason: "stored name is a degraded form of the candidate",
      });
    }
  }

  // ── 2/3. Shortlist + model, in batches ───────────────────────────────────
  const withOptions = unresolved.map((candidate) => ({
    candidate,
    options: shortlist(candidate, existing),
  }));

  // Nothing plausible to compare against — no point spending a call.
  for (const item of withOptions.filter((i) => i.options.length === 0)) {
    out.newBrandNamesToCreate.push(item.candidate.name);
  }
  const needModel = withOptions.filter((i) => i.options.length > 0);

  for (let start = 0; start < needModel.length; start += BATCH_SIZE) {
    const batch = needModel.slice(start, start + BATCH_SIZE);
    let decisions: ModelDecision[] = [];
    try {
      decisions = await askModel(env, batch);
    } catch (err) {
      out.rejected.push(
        `model call failed for batch at ${start}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const byName = new Map<string, ModelDecision>();
    for (const d of decisions) {
      if (typeof d?.candidateName === "string") byName.set(d.candidateName.trim(), d);
    }

    // ── 4. Validation ──────────────────────────────────────────────────────
    for (const { candidate, options } of batch) {
      const decision = byName.get(candidate.name.trim());
      const allowed = new Set(options.map((o) => o.id));

      // No decision returned, or a create verdict — both mean insert.
      if (!decision || decision.verdict !== "skip") {
        if (decision && decision.verdict !== "create") {
          out.rejected.push(`${candidate.name}: unknown verdict ${String(decision.verdict)}`);
        }
        out.newBrandNamesToCreate.push(candidate.name);
        continue;
      }

      const matchedId = Number(decision.matchedBrandId);
      // A skip pointing at an id we never offered is a hallucination; a skip is
      // also the unrecoverable direction, so fall back to create.
      if (!Number.isInteger(matchedId) || !allowed.has(matchedId)) {
        out.rejected.push(
          `${candidate.name}: skip referenced brand ${String(decision.matchedBrandId)} not in its shortlist`,
        );
        out.newBrandNamesToCreate.push(candidate.name);
        continue;
      }

      const matched = byId.get(matchedId)!;
      out.newBrandNamesToSkip.push({
        name: candidate.name,
        matchedBrandId: matchedId,
        matchedBrandName: matched.name,
        reason: typeof decision.reason === "string" ? decision.reason : "model match",
      });

      const better =
        typeof decision.betterName === "string" ? decision.betterName.trim() : "";
      if (better && better !== matched.name) {
        // Model-proposed renames go through the SAME quality gate as the
        // deterministic path. Gemini, asked about "Visual Comfort & Co.",
        // proposed renaming the existing "Visual Comfort" to it — a fine name
        // rewritten for no gain. A rename is only worth it when the stored form
        // is genuinely degraded (ALL CAPS, squashed), never merely different.
        // Rejections are recorded rather than dropped: a silent no-op is the
        // failure mode this module exists to eliminate.
        if (isDegradedName(matched.name, better)) {
          out.existingBrandNamesToCleanup.push({
            brandId: matchedId,
            existingBrandName: matched.name,
            newCleanupBrandName: better,
            reason: typeof decision.reason === "string" ? decision.reason : "model rename",
          });
        } else {
          out.rejected.push(
            `rename #${matchedId} "${matched.name}" -> "${better}" is not an improvement`,
          );
        }
      }
    }
  }

  // ── Rename safety ────────────────────────────────────────────────────────
  // A rename that lands on another brand's key would manufacture the very
  // duplicate this module exists to prevent.
  const keyOwner = new Map<string, number>();
  for (const row of existing) {
    const key = brandNameKey(row.name);
    if (key && !keyOwner.has(key)) keyOwner.set(key, row.id);
  }
  out.existingBrandNamesToCleanup = out.existingBrandNamesToCleanup.filter((c) => {
    const owner = keyOwner.get(brandNameKey(c.newCleanupBrandName));
    if (owner !== undefined && owner !== c.brandId) {
      out.rejected.push(
        `rename #${c.brandId} "${c.existingBrandName}" -> "${c.newCleanupBrandName}" ` +
          `would collide with brand #${owner}`,
      );
      return false;
    }
    return true;
  });

  return out;
}

/**
 * Apply the rename half of a reconciliation.
 *
 * Separate from `reconcileBrandNames` so the plan can be reviewed — or printed
 * by a `--plan` flag — before anything is written.
 */
export async function applyBrandCleanups(
  // Schema-agnostic: MCP tools hand in a `Record<string, unknown>`-typed db
  // while other callers use the bare one, and this only touches `brands`.
  db: DrizzleD1Database<Record<string, never>> | DrizzleD1Database<Record<string, unknown>>,
  cleanups: BrandCleanup[],
): Promise<number> {
  let applied = 0;
  for (const cleanup of cleanups) {
    await db
      .update(brands)
      .set({ name: cleanup.newCleanupBrandName, updatedAt: new Date() })
      .where(eq(brands.id, cleanup.brandId));
    applied += 1;
  }
  return applied;
}
