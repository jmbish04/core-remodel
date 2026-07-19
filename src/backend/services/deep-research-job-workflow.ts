/**
 * @fileoverview Deep-research JOB workflow — runs the deep-research engine for
 * the research console's "custom prompt" and "discovery" job kinds.
 *
 * The API (`POST /api/research-jobs`) creates the `research_jobs` row up front
 * (carrying kind / topic / criteria), then launches this Workflow with just the
 * job id. The workflow:
 *
 *   1. load-job            — read the job row; mark it running.
 *   2. deep-research       — run the engine (phases stream into the job's step
 *                            timeline via `enginePhaseRecorder`).
 *   3. extract-candidates  — (discovery kinds only) kimi structured pass over
 *                            report+findings → candidate list.
 *   4. cross-check         — (discovery kinds only) match candidates against
 *                            the existing registry → intakeStatus new|existing.
 *   5. finalize            — persist report/sources/result + seal the job.
 *
 * Discovery results land in `research_jobs.result` as `{ candidates: [...] }`;
 * `POST /api/research-jobs/:id/intake` registers a "new" candidate into the
 * showroom / brand / product registry.
 *
 * Any unrecoverable failure marks the job failed then re-throws so Workflows
 * records the error for observability.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";

import { researchJobs, type ResearchJob } from "@backend/db/schema/research/index";
import { showroomStores } from "@backend/db/schema/showroom/stores";
import { showroomStoreProducts } from "@backend/db/schema/showroom/store_products";
import { brands } from "@backend/db/schema/brands/brands";
import { runDeepResearch, type DeepResearchSource } from "@backend/ai/deep-research";
import { parseStructuredResponse } from "@backend/utils/ai-json";
import {
  beginStep,
  completeJob,
  completeStep,
  enginePhaseRecorder,
  failJob,
  updateJob,
} from "@backend/services/research-jobs";

// ---------------------------------------------------------------------------
// Params + types
// ---------------------------------------------------------------------------

export interface DeepResearchJobParams {
  /** The pre-created `research_jobs` row (carries kind / topic / criteria). */
  researchJobId: number;
}

/** The three discovery kinds this workflow post-processes into candidates. */
type DiscoveryKind = "discovery_showrooms" | "discovery_brands" | "discovery_products";

/** One intake candidate produced by a discovery run. */
export interface DiscoveryCandidate {
  name: string;
  websiteUrl: string | null;
  address: string | null;
  /** Manufacturer/brand name — populated for product discovery candidates. */
  brand: string | null;
  category: string | null;
  pricePoint: string | null;
  summary: string | null;
  /** Registry cross-check outcome. Intake flips "new" → "registered"/"failed". */
  intakeStatus: "new" | "existing" | "registered" | "failed";
  matchedEntityId?: number;
  matchedEntityName?: string;
  intakeEntityId?: number;
}

/** Workers-AI instruct model used for candidate extraction (via AI Gateway). */
const EXTRACT_MODEL = "@cf/moonshotai/kimi-k2.6" as const;

/** Hard cap on extracted candidates per discovery run. */
const MAX_CANDIDATES = 20;

/** Char budgets for the extraction prompt (report is the primary source). */
const REPORT_CHAR_BUDGET = 20_000;
const FINDINGS_CHAR_BUDGET = 12_000;

/** Step timeline sort orders. Engine phases occupy 100+ (recorder default). */
const SORT = {
  deepResearch: 1,
  extractCandidates: 201,
  crossCheck: 202,
  finalize: 203,
} as const;

/** JSON Schema constraining the kimi candidate extraction. */
const CANDIDATES_JSON_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          websiteUrl: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          brand: { type: ["string", "null"] },
          category: { type: ["string", "null"] },
          pricePoint: { type: ["string", "null"] },
          summary: { type: ["string", "null"] },
        },
        required: ["name"],
      },
    },
  },
  required: ["candidates"],
} as const;

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export class DeepResearchJobWorkflow extends WorkflowEntrypoint<
  Env,
  DeepResearchJobParams
> {
  async run(event: WorkflowEvent<DeepResearchJobParams>, step: WorkflowStep) {
    const jobId = event.payload.researchJobId;
    const env = this.env;

    // ── 1. load-job ─────────────────────────────────────────────────────────
    const job = await step.do("load-job", async () => {
      const db = drizzle(env.DB);
      const [row] = await db
        .select({
          id: researchJobs.id,
          kind: researchJobs.kind,
          topic: researchJobs.topic,
          criteria: researchJobs.criteria,
        })
        .from(researchJobs)
        .where(eq(researchJobs.id, jobId))
        .limit(1);
      return row ?? null;
    });
    if (!job) {
      console.error(`[deep-research-job] job ${jobId} not found — aborting`);
      return;
    }

    await updateJob(env, jobId, {
      status: "running",
      workflowInstanceId: event.instanceId ?? null,
    });

    try {
      const { topic, guidance } = buildTopicAndGuidance(job);
      const isDiscovery = isDiscoveryKind(job.kind);

      // ── 2. deep-research ──────────────────────────────────────────────────
      // Engine phases (plan → outline → research → evaluate/follow-ups →
      // compose) stream into the step timeline via enginePhaseRecorder.
      const research = await step.do("deep-research", async () => {
        await beginStep(env, jobId, "deep-research", "Running deep research", SORT.deepResearch);
        const result = await runDeepResearch(env, topic, {
          guidance,
          onPhase: enginePhaseRecorder(env, jobId),
        });
        const sourceCount = Object.keys(result.sources).length;
        await completeStep(env, jobId, "deep-research", {
          detail: `${sourceCount} sources across ${result.iterations + 1} research pass(es)`,
          artifact: { sourceCount, iterations: result.iterations },
        });
        return {
          report: result.report,
          findings: result.findings,
          sources: result.sources,
        };
      });

      let candidates: DiscoveryCandidate[] | null = null;

      if (isDiscovery) {
        // ── 3. extract-candidates (discovery only) ──────────────────────────
        candidates = await step.do("extract-candidates", async () => {
          await beginStep(
            env,
            jobId,
            "extract-candidates",
            "Extracting intake candidates",
            SORT.extractCandidates,
          );
          const extracted = await extractCandidates(env, job.kind as DiscoveryKind, research);
          await completeStep(env, jobId, "extract-candidates", {
            detail: `${extracted.length} candidate(s) extracted`,
            artifact: { candidates: extracted },
          });
          return extracted;
        });

        // ── 4. cross-check (discovery only) ─────────────────────────────────
        candidates = await step.do("cross-check", async () => {
          await beginStep(
            env,
            jobId,
            "cross-check",
            "Cross-checking candidates against the registry",
            SORT.crossCheck,
          );
          const checked: DiscoveryCandidate[] = [];
          for (const candidate of candidates ?? []) {
            const match = await findRegistryMatch(env, job.kind as DiscoveryKind, candidate.name);
            checked.push(
              match
                ? {
                    ...candidate,
                    intakeStatus: "existing",
                    matchedEntityId: match.id,
                    matchedEntityName: match.name,
                  }
                : { ...candidate, intakeStatus: "new" },
            );
          }
          const newCount = checked.filter((c) => c.intakeStatus === "new").length;
          await completeStep(env, jobId, "cross-check", {
            detail: `${newCount} new, ${checked.length - newCount} already in the registry`,
            artifact: { newCount, existingCount: checked.length - newCount },
          });
          return checked;
        });
      }

      // ── 5. finalize ─────────────────────────────────────────────────────
      await step.do("finalize", async () => {
        await beginStep(env, jobId, "finalize", "Finalizing report", SORT.finalize);
        const finals = {
          report: research.report,
          sources: research.sources as Record<string, DeepResearchSource>,
          result: candidates ? { candidates } : null,
        };
        await updateJob(env, jobId, finals);
        await completeStep(env, jobId, "finalize", {
          detail: candidates ? `${candidates.length} candidate(s) ready for intake` : "Report ready",
        });
        await completeJob(env, jobId, finals);
      });
    } catch (error) {
      await failJob(env, jobId, error);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Topic + guidance per kind
// ---------------------------------------------------------------------------

/** Job fields needed to build the engine topic (subset of the row). */
type JobSeed = Pick<ResearchJob, "kind" | "topic" | "criteria">;

function isDiscoveryKind(kind: ResearchJob["kind"]): kind is DiscoveryKind {
  return (
    kind === "discovery_showrooms" ||
    kind === "discovery_brands" ||
    kind === "discovery_products"
  );
}

/** Shared homeowner-renovation research context woven into every run. */
const BASE_GUIDANCE =
  "Context: this research supports a homeowner renovating a house in San Francisco " +
  "(SF Bay Area). Prefer current, verifiable information and cite sources for every claim.";

function buildTopicAndGuidance(job: JobSeed): { topic: string; guidance: string } {
  const criteria = (job.criteria ?? job.topic ?? "").trim();

  switch (job.kind) {
    case "discovery_showrooms":
      return {
        topic: `Find showrooms matching: ${criteria}`,
        guidance:
          `${BASE_GUIDANCE} Identify REAL, currently-operating SF Bay Area showrooms ` +
          "matching the criteria. For each showroom report: the exact business name, " +
          "city/address, website URL, what they sell, and why they match the criteria. " +
          "Aim for 5-15 candidates. Do NOT invent businesses.",
      };
    case "discovery_brands":
      return {
        topic: `Find brands matching: ${criteria}`,
        guidance:
          `${BASE_GUIDANCE} Identify REAL manufacturer/brand companies matching the ` +
          "criteria. For each brand report: the exact brand name, website URL, product " +
          "category, price tier ($–$$$$), and why it matches the criteria. " +
          "Aim for 5-15 candidates. Do NOT invent brands.",
      };
    case "discovery_products":
      return {
        topic: `Find products matching: ${criteria}`,
        guidance:
          `${BASE_GUIDANCE} Identify REAL, currently-purchasable specific products ` +
          "matching the criteria. For each product report: the exact product name, its " +
          "brand/manufacturer, product category, approximate price, and why it matches " +
          "the criteria. Aim for 5-15 candidates. Do NOT invent products.",
      };
    default:
      // custom — the user's prompt verbatim.
      return {
        topic: criteria,
        guidance: BASE_GUIDANCE,
      };
  }
}

// ---------------------------------------------------------------------------
// Candidate extraction (kimi json_schema over report + findings)
// ---------------------------------------------------------------------------

const KIND_NOUN: Record<DiscoveryKind, string> = {
  discovery_showrooms: "showrooms",
  discovery_brands: "brands",
  discovery_products: "products",
};

async function extractCandidates(
  env: Env,
  kind: DiscoveryKind,
  research: { report: string; findings: string },
): Promise<DiscoveryCandidate[]> {
  const noun = KIND_NOUN[kind];
  const report =
    research.report.length > REPORT_CHAR_BUDGET
      ? `${research.report.slice(0, REPORT_CHAR_BUDGET)}\n[truncated]`
      : research.report;
  const findings =
    research.findings.length > FINDINGS_CHAR_BUDGET
      ? `${research.findings.slice(0, FINDINGS_CHAR_BUDGET)}\n[truncated]`
      : research.findings;

  const prompt = `You are extracting a structured list of ${noun} from a completed research report.

Extract every distinct ${noun.replace(/s$/, "")} candidate the report identifies (max ${MAX_CANDIDATES}). For each:
- name: the exact ${noun.replace(/s$/, "")} name (required).
- websiteUrl: its website URL, or null.
- address: its street address or city, or null.
- brand: the manufacturer/brand name (products only — null otherwise).
- category: what it sells / its product category, or null.
- pricePoint: its price tier or approximate price, or null.
- summary: one sentence on why it matched the research criteria, or null.

Only extract candidates the report actually names — do NOT invent entries. Respond ONLY with valid JSON conforming to the supplied schema.

RESEARCH REPORT:
${report}

SUPPORTING FINDINGS:
${findings}`;

  try {
    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content: "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: CANDIDATES_JSON_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown; candidates?: unknown };

    // `.response` may be a parsed object or a JSON string (kimi via gateway);
    // handle both, else a string response yields zero discovery candidates.
    const source = parseStructuredResponse<{ candidates?: unknown }>(
      raw,
      "discovery candidates",
    );

    return normalizeCandidates(source?.candidates);
  } catch (err) {
    console.error("[deep-research-job] candidate extraction failed:", err);
    return [];
  }
}

/** Defensive normalization of the model's candidate array. */
function normalizeCandidates(value: unknown): DiscoveryCandidate[] {
  if (!Array.isArray(value)) return [];

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  const out: DiscoveryCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = str(record.name);
    if (!name) continue;
    out.push({
      name,
      websiteUrl: str(record.websiteUrl),
      address: str(record.address),
      brand: str(record.brand),
      category: str(record.category),
      pricePoint: str(record.pricePoint),
      summary: str(record.summary),
      intakeStatus: "new",
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry cross-check
// ---------------------------------------------------------------------------

/**
 * Case-insensitive registry lookup per discovery kind. Showrooms additionally
 * try a substring LIKE match (business names often carry suffixes like
 * "— San Francisco"); brands/products match on exact lowered name only.
 */
async function findRegistryMatch(
  env: Env,
  kind: DiscoveryKind,
  candidateName: string,
): Promise<{ id: number; name: string } | null> {
  const db = drizzle(env.DB);
  const lower = candidateName.trim().toLowerCase();
  if (!lower) return null;

  try {
    if (kind === "discovery_showrooms") {
      const [exact] = await db
        .select({ id: showroomStores.id, name: showroomStores.name })
        .from(showroomStores)
        .where(
          and(
            sql`lower(${showroomStores.name}) = ${lower}`,
            eq(showroomStores.isActive, true),
          ),
        )
        .limit(1);
      if (exact) return exact;
      const [fuzzy] = await db
        .select({ id: showroomStores.id, name: showroomStores.name })
        .from(showroomStores)
        .where(
          and(
            sql`lower(${showroomStores.name}) LIKE ${`%${lower}%`}`,
            eq(showroomStores.isActive, true),
          ),
        )
        .limit(1);
      return fuzzy ?? null;
    }

    if (kind === "discovery_brands") {
      const [match] = await db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(sql`lower(${brands.name}) = ${lower}`)
        .limit(1);
      return match ?? null;
    }

    const [match] = await db
      .select({ id: showroomStoreProducts.id, name: showroomStoreProducts.itemName })
      .from(showroomStoreProducts)
      .where(sql`lower(${showroomStoreProducts.itemName}) = ${lower}`)
      .limit(1);
    return match ?? null;
  } catch (err) {
    console.error(`[deep-research-job] cross-check lookup failed for "${candidateName}":`, err);
    return null;
  }
}
