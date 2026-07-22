/**
 * @fileoverview Post-add PRODUCT deep-research workflow.
 *
 * When a store product is created (or manually re-triggered), this Cloudflare
 * Workflow enriches it the way showrooms get enriched:
 *
 *   1. Deep-research the exact product (reviews, street prices, wholesale /
 *      retail / negotiated price estimates with rationales, sales strategies,
 *      California regulatory friction) via the deep-research engine.
 *   2. Structured Workers-AI extraction of the report into `store_product_intel`.
 *   3. Scrape the brand's website for the product page, archive markdown to R2,
 *      and pull product imagery into Cloudflare Images + `product_images`.
 *   4. Fill-blanks persistence onto `showroom_store_products` (description,
 *      productType, price) + `product_specs` inserts.
 *   5. Embed the research report into the RESEARCH_INDEX Vectorize corpus under
 *      the `product:research:<id>` namespace.
 *
 * Mirrors the error discipline of `showroom-scrape-workflow.ts`: each
 * `step.do(...)` is independently retryable; side-enrichment steps (scrape,
 * photos, embed) never throw; any unrecoverable failure flips
 * `store_product_intel.research_status` to "failed" before re-throwing.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";

import {
  productImages,
  productSpecs,
  showroomProductMappings,
  showroomStores,
  showroomStoreProducts,
  storeProductIntel,
} from "@backend/db/schema/showroom/index";
import { brands } from "@backend/db/schema/brands/index";
import { runDeepResearch } from "@backend/ai/deep-research";
import { normalizeCrawlUrl, scrapeUrl } from "@backend/ai/tools/browser-rendering";
import { chunkMarkdown } from "@backend/ai/agents/ResearchAgent/methods/chunk-markdown";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { parseStructuredResponse } from "@backend/utils/ai-json";
import { startRun } from "@backend/services/agent-runs";
import { ledgerSteps } from "@backend/services/agent-run-workflow";
import {
  beginStep,
  completeJob,
  completeStep,
  createResearchJob,
  enginePhaseRecorder,
  failJob,
  failStep,
  updateJob,
} from "@backend/services/research-jobs";

// ---------------------------------------------------------------------------
// Params + constants
// ---------------------------------------------------------------------------

export interface ProductResearchParams {
  storeProductId: number;
  /**
   * Pre-created research-console job id. The API may create the job row
   * before triggering the workflow so the UI can navigate to the live
   * viewport immediately; when present the workflow records into it instead
   * of creating its own.
   */
  researchJobId?: number;
}

/**
 * Research-console step count: the 8 workflow steps recorded below
 * (mark-running, deep-research, extract-structured, scrape-product-page,
 * photos, persist, embed, mark-complete) plus the ~7 deep-research engine
 * phases (plan, outline, research, evaluate-1, follow-ups-1, evaluate-2,
 * compose) streamed in via `enginePhaseRecorder`.
 */
const TOTAL_JOB_STEPS = 15;

/** Workers-AI embedding model — mirrors the showroom scrape pipeline. */
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/** Workers-AI instruct model used for structured extraction. */
/**
 * Extraction model.
 *
 * NOT a reasoning model. kimi-k2.6 was used here and returned `content: ""`
 * with `finish_reason: "length"` on every call — it spent the entire token
 * budget on `reasoning_content` and emitted nothing, taking ~59s to do it.
 * Measured 2026-07-18 against product 35's stored report: gpt-oss-120b returns
 * usable JSON in ~7-10s, llama-3.3-70b was faster still but produced a
 * malformed envelope on 2 of 3 calls.
 */
const EXTRACT_MODEL = "@cf/openai/gpt-oss-120b" as const;

/** Max brand-site pages scraped per run (homepage + best product-page match). */
const MAX_SCRAPE_PAGES = 2;

/** Max product photos uploaded to Cloudflare Images per run. */
const MAX_PHOTOS = 6;

/** Max extracted specs persisted per run. */
const MAX_SPECS = 12;

/**
 * Output budget for the intel extraction.
 *
 * The call previously set none. Truncation turned out NOT to be the cause of
 * the empty extractions — a live re-run proved the JSON parses fine and the
 * model simply returns null for every nullable field — but a 15-field object
 * carrying three price rationales, a sales-intel paragraph and up to 12 specs
 * still deserves an explicit budget. 4096 covers a full response.
 */
const EXTRACT_MAX_TOKENS = 4096;

/**
 * Report size above which a wholly empty extraction is treated as a failure
 * rather than a genuinely sparse product. Real reports run 15-25 KB; anything
 * this size that yields zero fields did not get extracted.
 */
const MIN_REPORT_FOR_INTEL = 2_000;

/** Deep-research result shape (per the deep-research engine contract). */
type DeepResearchResult = Awaited<ReturnType<typeof runDeepResearch>>;

/**
 * Defensive accessor for the deep-research source map — returns the source
 * URLs in map order. Structurally typed so a partial/older engine payload
 * can't take the workflow down.
 */
function researchSourceUrls(research: DeepResearchResult): string[] {
  const sources = ((research as { sources?: unknown })?.sources ??
    {}) as Record<string, { url?: unknown }>;
  return Object.values(sources)
    .map((s) => (typeof s?.url === "string" ? s.url : null))
    .filter((u): u is string => !!u);
}

/**
 * Product + brand + (representative) store context loaded in mark-running.
 *
 * A product has no owning store — it is global and may be carried by zero
 * or more showrooms via `showroom_product_mappings`. `storeId`/`storeName`
 * here are a representative carrying showroom (first mapping row, if any),
 * used only to ground the research prompt with real-world context.
 */
interface ProductContext {
  storeId: number | null;
  storeName: string;
  itemName: string;
  sku: string | null;
  brandId: number | null;
  brandName: string | null;
  brandWebsiteUrl: string | null;
}

/** Structured intel extracted from the deep-research report. */
interface IntelExtraction {
  reviewSummary: string | null;
  description: string | null;
  productType: string | null;
  priceRangeLow: string | null;
  priceRangeHigh: string | null;
  aiWholesalePrice: string | null;
  aiWholesaleRationale: string | null;
  aiRetailPrice: string | null;
  aiRetailRationale: string | null;
  aiNegotiatedPrice: string | null;
  aiNegotiatedRationale: string | null;
  salesIntel: string | null;
  caRegulatoryFlag: boolean;
  caRegulatoryNotes: string | null;
  specs: Array<{ key: string; value: string; unit: string | null }>;
}

/** JSON Schema constraining the intel extraction. */
const INTEL_JSON_SCHEMA = {
  type: "object",
  properties: {
    reviewSummary: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    productType: { type: ["string", "null"] },
    priceRangeLow: { type: ["string", "null"] },
    priceRangeHigh: { type: ["string", "null"] },
    aiWholesalePrice: { type: ["string", "null"] },
    aiWholesaleRationale: { type: ["string", "null"] },
    aiRetailPrice: { type: ["string", "null"] },
    aiRetailRationale: { type: ["string", "null"] },
    aiNegotiatedPrice: { type: ["string", "null"] },
    aiNegotiatedRationale: { type: ["string", "null"] },
    salesIntel: { type: ["string", "null"] },
    caRegulatoryFlag: { type: "boolean" },
    caRegulatoryNotes: { type: ["string", "null"] },
    specs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          unit: { type: ["string", "null"] },
        },
        required: ["key", "value"],
      },
    },
  },
  // NOTE: marking every key `required` does NOT fix the all-null extraction —
  // tried and measured on 2026-07-18. `required` forces the key to be emitted,
  // not a non-null value, so `"aiRetailPrice": null` still satisfies both
  // `required` and the `["string","null"]` union. kimi-k2.6 returns nulls for
  // every nullable field regardless. Left as-is pending a model/prompt fix.
  required: ["caRegulatoryFlag", "specs"],
} as const;

/**
 * Narrow, non-nullable schema for the pricing follow-up pass.
 *
 * On the wide schema every price field is optional and nullable, and models
 * reliably skip them — gpt-oss-120b returns solid specs and productType but
 * null prices from the same report that, asked these four questions alone,
 * yields "$1,500–$2,000" with a rationale. Fewer fields, none nullable, and an
 * explicit instruction to estimate is what gets a committed answer.
 */
const PRICE_JSON_SCHEMA = {
  type: "object",
  properties: {
    aiRetailPrice: { type: "string" },
    aiRetailRationale: { type: "string" },
    priceRangeLow: { type: "string" },
    priceRangeHigh: { type: "string" },
  },
  required: ["aiRetailPrice", "aiRetailRationale", "priceRangeLow", "priceRangeHigh"],
} as const;

/** JSON Schema constraining the product-page link pick. */
const PRODUCT_PAGE_PICK_SCHEMA = {
  type: "object",
  properties: {
    bestUrl: { type: ["string", "null"] },
  },
  required: ["bestUrl"],
} as const;

/** JSON Schema constraining the product-image extraction. */
const IMAGE_URLS_SCHEMA = {
  type: "object",
  properties: {
    imageUrls: { type: "array", items: { type: "string" } },
  },
  required: ["imageUrls"],
} as const;

/** One discovered product image + the page it was found on. */
interface DiscoveredImage {
  url: string;
  pageUrl: string;
}

/** Result of the never-throw brand-site scrape step. */
interface ScrapeStepResult {
  images: DiscoveredImage[];
  pageUrls: string[];
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export class ProductResearchWorkflow extends WorkflowEntrypoint<
  Env,
  ProductResearchParams
> {
  async run(event: WorkflowEvent<ProductResearchParams>, rawStep: WorkflowStep) {
    const { storeProductId } = event.payload;
    const env = this.env;
    const db = drizzle(env.DB);

    // Durable run record — see brand-research-workflow for the rationale. The
    // product pipeline is the more expensive of the two (deep research plus a
    // page scrape plus photo ingest), so an unattributed failure here is also
    // an unattributed bill.
    const run = await startRun(env, {
      agent: "product-research",
      operation: "research_product",
      targetType: "store_product",
      targetId: String(storeProductId),
      input: { storeProductId, researchJobId: event.payload.researchJobId ?? null },
      triggeredBy: "agent",
    });
    const step = ledgerSteps(rawStep, run);

    // Research-console job id — pre-created by the API when `researchJobId`
    // is supplied, otherwise created inside mark-running (job creation lives
    // inside the step.do so Workflow replays never mint duplicate job rows).
    let jobId: number | null = event.payload.researchJobId ?? null;

    const errText = (err: unknown): string =>
      err instanceof Error ? err.message : String(err);

    /**
     * begin/complete/fail-wrap one workflow step for the research console.
     * Recorder calls never throw, so this adds no failure modes — a work()
     * failure is re-thrown exactly as before once failStep records it.
     */
    const recorded = async <T>(
      key: string,
      label: string,
      sortOrder: number,
      work: () => Promise<T>,
      finalize?: (value: T) => { detail?: string | null; artifact?: unknown },
    ): Promise<T> => {
      await beginStep(env, jobId, key, label, sortOrder);
      try {
        const value = await work();
        await completeStep(env, jobId, key, finalize?.(value));
        return value;
      } catch (err) {
        await failStep(env, jobId, key, errText(err));
        throw err;
      }
    };

    try {
      // ── 1. mark-running ─────────────────────────────────────────────────
      // Upsert the 1:1 intel row → "running", load product/brand/store
      // context for the research topic, and resolve the console job.
      const marked = await step.do("mark-running", async () => {
        const loaded = await markRunning(env, storeProductId);

        // Resolve the research-console job: adopt the pre-created one when
        // the API passed it (so the UI could navigate immediately), else
        // create it now.
        let resolvedJobId = event.payload.researchJobId ?? null;
        if (resolvedJobId) {
          await updateJob(env, resolvedJobId, {
            workflowInstanceId: event.instanceId ?? null,
            totalSteps: TOTAL_JOB_STEPS,
          });
        } else {
          resolvedJobId = await createResearchJob(env, {
            kind: "product",
            title: `Product research — ${[loaded.brandName, loaded.itemName]
              .filter(Boolean)
              .join(" ")}`,
            topic: buildResearchTopic(loaded),
            entityType: "product",
            entityId: storeProductId,
            totalSteps: TOTAL_JOB_STEPS,
            workflowInstanceId: event.instanceId ?? null,
          });
        }
        await beginStep(
          env,
          resolvedJobId,
          "mark-running",
          "Loading product context & marking research running",
          0,
        );

        return { ctx: loaded, jobId: resolvedJobId };
      });
      const ctx = marked.ctx;
      jobId = marked.jobId ?? jobId;
      await completeStep(env, jobId, "mark-running", {
        detail: `Loaded "${productLabel(ctx)}" at ${ctx.storeName}`,
        artifact: {
          itemName: ctx.itemName,
          brandName: ctx.brandName,
          storeName: ctx.storeName,
        },
      });

      // ── 2. deep-research ────────────────────────────────────────────────
      const research = await recorded(
        "deep-research",
        "Running deep research",
        1,
        () =>
          step.do("deep-research", async () =>
            runDeepResearch(env, buildResearchTopic(ctx), {
              guidance: buildResearchGuidance(ctx),
              maxIterations: 2,
              onPhase: enginePhaseRecorder(env, jobId),
            }),
          ),
        (r) => ({
          detail: `${Object.keys(r.sources).length} sources across ${r.iterations} refinement pass(es)`,
          artifact: {
            sourceCount: Object.keys(r.sources).length,
            iterations: r.iterations,
            evaluationGrade: r.evaluation?.grade ?? null,
          },
        }),
      );
      // Mirror plan/outline onto the job row (enginePhaseRecorder streams
      // them live already; this is a cheap idempotent backstop).
      await updateJob(env, jobId, {
        plan: research.plan,
        outline: research.outline,
      });

      // ── 3. extract-structured ───────────────────────────────────────────
      const intel = await recorded(
        "extract-structured",
        "Extracting structured purchase intel",
        2,
        () =>
          step.do("extract-structured", async () =>
            extractIntel(env, ctx, research),
          ),
        (value) => ({
          detail: value.reviewSummary
            ? "Structured intel extracted"
            : "Extraction returned sparse data",
          artifact: value,
        }),
      );

      // ── 4. scrape-product-page ──────────────────────────────────────────
      // Locate + scrape the product page on the brand's own site (max 2
      // pages), archive markdown to R2, extract product imagery. Never throws.
      const scraped = await recorded(
        "scrape-product-page",
        "Scraping brand product page",
        3,
        () =>
          step.do("scrape-product-page", async () =>
            scrapeBrandProductPage(env, storeProductId, ctx, research),
          ),
        (value) => ({
          detail: `${value.pageUrls.length} page(s) scraped, ${value.images.length} image candidate(s)`,
          artifact: {
            pagesScraped: value.pageUrls.length,
            imageUrls: value.images.length,
          },
        }),
      );

      // ── 5. photos ───────────────────────────────────────────────────────
      // Upload up to MAX_PHOTOS discovered images to Cloudflare Images and
      // insert product_images rows (reviewStatus "pending"). Never throws.
      await recorded(
        "photos",
        "Uploading product photos",
        4,
        () =>
          step.do("photos", async () =>
            persistPhotos(env, storeProductId, scraped.images),
          ),
        (value) => ({
          detail: `${value.uploaded} photo(s) uploaded`,
          artifact: {
            uploaded: value.uploaded,
            deliveryUrls: value.deliveryUrls.slice(0, 6),
          },
        }),
      );

      // ── 6. persist ──────────────────────────────────────────────────────
      // Fill-blanks onto the product row, insert specs, and write every intel
      // column + the research report/sources.
      await recorded(
        "persist",
        "Persisting research to product tables",
        5,
        () =>
          step.do("persist", async () =>
            persistIntel(env, storeProductId, intel, research),
          ),
        (value) => ({
          detail: `${value.wrote.length} column(s)/table(s) written`,
          artifact: { wrote: value.wrote },
        }),
      );
      await updateJob(env, jobId, {
        report: research.report,
        sources: research.sources,
        result: intel,
      });

      // ── 7. embed ────────────────────────────────────────────────────────
      // Chunk + embed the report into RESEARCH_INDEX. Never throws — a
      // Vectorize hiccup must not flip an otherwise-complete run to "failed".
      await recorded(
        "embed",
        "Embedding research report",
        6,
        () =>
          step.do("embed", async () =>
            embedReport(env, storeProductId, research.report),
          ),
        (written) => ({
          detail: `${written} vector(s) written`,
          artifact: { vectorsWritten: written },
        }),
      );

      // ── 8. mark-complete ────────────────────────────────────────────────
      await recorded(
        "mark-complete",
        "Marking research complete",
        7,
        () =>
          step.do("mark-complete", async () => {
            await db
              .update(storeProductIntel)
              .set({ researchStatus: "complete", updatedAt: new Date() })
              .where(eq(storeProductIntel.storeProductId, storeProductId));
          }),
        () => ({ detail: `store_product_intel.research_status = "complete"` }),
      );

      await completeJob(env, jobId, {
        report: research.report,
        sources: research.sources,
        result: intel,
      });

      await run.succeed({
        storeProductId,
        sources: research.sources?.length ?? 0,
        reportChars: research.report?.length ?? 0,
      });
    } catch (error) {
      await run.fail(error);
      // Any unrecoverable failure flips status to "failed" then re-throws so
      // Workflows records the error for observability. The console job is
      // failed alongside (failJob never throws).
      await failJob(env, jobId, error);
      try {
        await db
          .update(storeProductIntel)
          .set({ researchStatus: "failed", updatedAt: new Date() })
          .where(eq(storeProductIntel.storeProductId, storeProductId));
      } catch (markErr) {
        console.error(
          `product-research: failed to mark product ${storeProductId} failed`,
          markErr,
        );
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1 — mark-running + context load
// ---------------------------------------------------------------------------

async function markRunning(
  env: Env,
  storeProductId: number,
): Promise<ProductContext> {
  const db = drizzle(env.DB);

  const [product] = await db
    .select()
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.id, storeProductId))
    .limit(1);

  if (!product) {
    throw new Error(`product-research: product ${storeProductId} not found`);
  }

  await db
    .insert(storeProductIntel)
    .values({ storeProductId, researchStatus: "running" })
    .onConflictDoUpdate({
      target: storeProductIntel.storeProductId,
      set: { researchStatus: "running", updatedAt: new Date() },
    });

  // A product has no owning store — resolve one representative carrying
  // showroom (if any) via showroom_product_mappings for prompt grounding.
  const [store] = await db
    .select({ id: showroomStores.id, name: showroomStores.name })
    .from(showroomProductMappings)
    .innerJoin(showroomStores, eq(showroomProductMappings.showroomId, showroomStores.id))
    .where(
      and(
        eq(showroomProductMappings.productId, storeProductId),
        eq(showroomStores.isActive, true),
      ),
    )
    .limit(1);

  let brandName: string | null = null;
  let brandWebsiteUrl: string | null = null;
  if (product.brandId != null) {
    const [brand] = await db
      .select({ name: brands.name, websiteUrl: brands.websiteUrl })
      .from(brands)
      .where(eq(brands.id, product.brandId))
      .limit(1);
    brandName = brand?.name ?? null;
    brandWebsiteUrl = brand?.websiteUrl ?? null;
  }

  return {
    storeId: store?.id ?? null,
    storeName: store?.name ?? "an unknown showroom",
    itemName: product.itemName,
    sku: product.sku ?? null,
    brandId: product.brandId ?? null,
    brandName,
    brandWebsiteUrl,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — deep-research topic + guidance
// ---------------------------------------------------------------------------

/** Human-readable product label: brand + item name + SKU when present. */
function productLabel(ctx: ProductContext): string {
  const parts = [ctx.brandName, ctx.itemName].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  const label = parts.join(" ");
  return ctx.sku ? `${label} (SKU ${ctx.sku})` : label;
}

function buildResearchTopic(ctx: ProductContext): string {
  return `Research the exact product "${productLabel(ctx)}" — carried by the showroom "${ctx.storeName}" — for a California (SF Bay Area) homeowner deciding whether and how to buy it: online reviews across retail sites, Reddit, and trade forums; real online street prices (low and high); typical showroom retail markup and wholesale/dealer cost signals for this product category; realistic negotiation targets a homeowner could reach with the showroom; current or seasonal sales and money-saving strategies (open-box, trade pass-through, price-match, bundle discounts); and California regulatory constraints (CEC, CARB, Title 20, Title 24, water-flow GPM limits for plumbing fixtures, energy standards for appliances) that could make acquiring or installing this product difficult.`;
}

function buildResearchGuidance(ctx: ProductContext): string {
  return `Deliverables — cover ALL of the following explicitly, citing sources for every factual claim:
1. REVIEW SUMMARY: a 2-3 sentence homeowner-facing synthesis of online reviews (retail sites, Reddit, forums) — what buyers love, what they complain about.
2. PRODUCT DETAILS: a concise description of what the product is (materials, finish, dimensions, notable features) and its product type/category (e.g. Flooring, Plumbing, Lighting, Appliances, Tile).
3. ONLINE PRICE RANGE: the real low and high street prices observed online, as dollar figures.
4. WHOLESALE ESTIMATE: the AI-estimated wholesale/dealer cost the showroom likely pays the brand, with the rationale (typical category margins, trade-pricing signals, dealer-cost multipliers).
5. RETAIL ESTIMATE: the AI-estimated retail price the showroom likely quotes a homeowner, with rationale.
6. NEGOTIATED ESTIMATE: a realistic price a homeowner could negotiate the showroom down to, with rationale (margin room, competitor price-matching leverage).
7. SALES & SAVINGS: known current/seasonal sales for this product and concrete money-saving strategies (open-box, floor models, trade pass-through, price-match policies, holiday sale cycles).
8. CALIFORNIA REGULATORY FRICTION: whether any California regulation (CEC, CARB, Title 20/24, GPM flow limits, energy standards) restricts sale, purchase, or installation of this product in California — name the specific rule and any compliant variant (e.g. a "-CA" model).
Product context: brand ${ctx.brandName ?? "unknown"}, item "${ctx.itemName}"${ctx.sku ? `, SKU ${ctx.sku}` : ""}, sold at showroom "${ctx.storeName}". Cite every source used.`;
}

// ---------------------------------------------------------------------------
// Step 3 — structured intel extraction
// ---------------------------------------------------------------------------

async function extractIntel(
  env: Env,
  ctx: ProductContext,
  research: DeepResearchResult,
): Promise<IntelExtraction> {
  const reportPreview =
    research.report.length > 16_000
      ? `${research.report.slice(0, 16_000)}\n\n[truncated]`
      : research.report;
  const findingsPreview =
    research.findings.length > 8_000
      ? `${research.findings.slice(0, 8_000)}\n\n[truncated]`
      : research.findings;

  const prompt = `You are extracting structured purchase intelligence about the product "${productLabel(ctx)}" from a deep-research report prepared for a California (SF Bay Area) homeowner.

Extract:
- reviewSummary: 2-3 sentence homeowner-facing summary of online reviews, or null if the report has no review signal.
- description: a concise product-detail paragraph (what it is, materials, finish, notable features), or null.
- productType: the coarse product category, e.g. "Flooring", "Plumbing", "Lighting", "Appliances", "Tile", or null.
- priceRangeLow / priceRangeHigh: the low and high online street prices as display strings like "$1,150", or null.
- aiWholesalePrice + aiWholesaleRationale: the estimated wholesale/dealer cost the showroom pays (display string like "$850") and WHY, or null.
- aiRetailPrice + aiRetailRationale: the estimated retail price the showroom charges (display string) and WHY, or null.
- aiNegotiatedPrice + aiNegotiatedRationale: a realistic negotiated price a homeowner could reach (display string) and WHY, or null.
- salesIntel: known sales + money-saving strategies (open-box, trade pass-through, price-match, seasonal cycles) as short markdown-safe prose, or null.
- caRegulatoryFlag: true ONLY if a California regulation (CEC, CARB, Title 20/24, GPM limits, energy standards) may complicate acquiring or installing this product.
- caRegulatoryNotes: detail on that regulatory friction naming the specific rule and any compliant variant, or null.
- specs: up to ${MAX_SPECS} structured specifications as {key, value, unit} (unit null when dimensionless). Only include specs stated in the report — do NOT invent.

Prices must be display strings like "$1,150" — never bare numbers. Use null for anything the report does not support.

Respond ONLY with valid JSON conforming to the supplied schema.

RESEARCH REPORT:
${reportPreview}

SUPPORTING FINDINGS:
${findingsPreview}`;

  const raw = (await env.AI.run(
    EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
    {
      messages: [
        {
          role: "system",
          content:
            "You are a precise structured-data extractor for home-renovation purchase intelligence. Respond only with JSON.",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: INTEL_JSON_SCHEMA,
      },
      max_tokens: EXTRACT_MAX_TOKENS,
      gateway: { id: env.AI_GATEWAY_ID },
    } as Parameters<typeof env.AI.run>[1],
  )) as { response?: unknown } & Partial<IntelExtraction>;

  // Workers-AI json_schema output arrives on `.response` — as a parsed object
  // for some models, a JSON string for others (kimi via the gateway). Handle
  // both; otherwise a string `.response` would fall through to the raw wrapper
  // and every extracted field would come back null.
  const source = parseStructuredResponse<IntelExtraction>(
    raw,
    "product structured intel",
  );

  if (!source || typeof source !== "object") {
    throw new Error("product-research: intel extraction returned no object");
  }

  const intel = normalizeIntel(source);

  // The wide pass reliably drops the optional price fields. When it has, ask
  // the four pricing questions on their own against a non-nullable schema.
  // Best-effort: pricing is valuable but must not fail the whole extraction.
  if (intel.aiRetailPrice === null) {
    try {
      Object.assign(intel, await extractPricing(env, ctx, reportPreview));
    } catch (err) {
      console.error("[product-research] pricing follow-up failed:", err);
    }
  }

  // A substantial report that yields nothing at all is an extraction failure,
  // not a sparse product. Only `caRegulatoryFlag` and `specs` are schema-
  // required, so a model that ignores the task still satisfies the schema and
  // returns exactly this — which is how a 21 KB report persisted an entirely
  // empty intel row while the step reported success. Throw so step.do() retries
  // rather than writing the blank.
  if (isEmptyExtraction(intel) && research.report.length >= MIN_REPORT_FOR_INTEL) {
    throw new Error(
      `product-research: intel extraction returned no fields from a ` +
        `${research.report.length}-char report (all null, ${intel.specs.length} specs)`,
    );
  }

  return intel;
}

/**
 * True when the extraction carries no signal whatsoever — every string field
 * null and no specs. `caRegulatoryFlag` is excluded deliberately: it defaults
 * to `false`, so it is indistinguishable from "not answered".
 */
function isEmptyExtraction(intel: IntelExtraction): boolean {
  return (
    intel.specs.length === 0 &&
    intel.reviewSummary === null &&
    intel.description === null &&
    intel.productType === null &&
    intel.priceRangeLow === null &&
    intel.priceRangeHigh === null &&
    intel.aiWholesalePrice === null &&
    intel.aiWholesaleRationale === null &&
    intel.aiRetailPrice === null &&
    intel.aiRetailRationale === null &&
    intel.aiNegotiatedPrice === null &&
    intel.aiNegotiatedRationale === null &&
    intel.salesIntel === null &&
    intel.caRegulatoryNotes === null
  );
}

/**
 * Pricing-only follow-up pass — see PRICE_JSON_SCHEMA for why this is separate.
 *
 * Returns only the fields it could fill, so the caller can Object.assign over
 * the wide-pass result without clobbering anything with nulls.
 */
async function extractPricing(
  env: Env,
  ctx: ProductContext,
  reportPreview: string,
): Promise<Partial<IntelExtraction>> {
  const prompt = `Estimate pricing for "${productLabel(ctx)}" from the deep-research report below, for a California (SF Bay Area) homeowner buying through a showroom.

- aiRetailPrice: the price a showroom would charge, as a display string like "$1,150".
- aiRetailRationale: why — cite what in the report supports it.
- priceRangeLow / priceRangeHigh: the low and high online street prices as display strings.

Give your best estimate for every field. If the report is not explicit, ESTIMATE from comparable products or brand positioning described in it and say so in the rationale. Never return an empty string.

Respond ONLY with valid JSON conforming to the supplied schema.

RESEARCH REPORT:
${reportPreview}`;

  const raw = (await env.AI.run(
    EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
    {
      messages: [
        {
          role: "system",
          content:
            "You are a pricing analyst for home-renovation purchases. Respond only with JSON.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_schema", json_schema: PRICE_JSON_SCHEMA },
      max_tokens: EXTRACT_MAX_TOKENS,
      gateway: { id: env.AI_GATEWAY_ID },
    } as Parameters<typeof env.AI.run>[1],
  )) as { response?: unknown } & Partial<IntelExtraction>;

  const source = parseStructuredResponse<IntelExtraction>(
    raw,
    "product pricing follow-up",
  );

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  // Drop nulls so Object.assign never overwrites a value the wide pass found.
  const picked: Partial<IntelExtraction> = {};
  for (const key of [
    "aiRetailPrice",
    "aiRetailRationale",
    "priceRangeLow",
    "priceRangeHigh",
  ] as const) {
    const value = str(source[key]);
    if (value !== null) picked[key] = value;
  }
  return picked;
}

/** Defensive normalization of the Workers-AI intel extraction. */
function normalizeIntel(source: Partial<IntelExtraction>): IntelExtraction {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  const rawSpecs: unknown[] = Array.isArray(source.specs) ? source.specs : [];
  const specs = rawSpecs
        .filter(
          (s): s is { key: string; value: string; unit?: string | null } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as { key?: unknown }).key === "string" &&
            typeof (s as { value?: unknown }).value === "string",
        )
        .map((s) => ({
          key: s.key.trim(),
          value: s.value.trim(),
          unit: str(s.unit),
        }))
        .filter((s) => s.key.length > 0 && s.value.length > 0)
        .slice(0, MAX_SPECS);

  return {
    reviewSummary: str(source.reviewSummary),
    description: str(source.description),
    productType: str(source.productType),
    priceRangeLow: str(source.priceRangeLow),
    priceRangeHigh: str(source.priceRangeHigh),
    aiWholesalePrice: str(source.aiWholesalePrice),
    aiWholesaleRationale: str(source.aiWholesaleRationale),
    aiRetailPrice: str(source.aiRetailPrice),
    aiRetailRationale: str(source.aiRetailRationale),
    aiNegotiatedPrice: str(source.aiNegotiatedPrice),
    aiNegotiatedRationale: str(source.aiNegotiatedRationale),
    salesIntel: str(source.salesIntel),
    caRegulatoryFlag: source.caRegulatoryFlag === true,
    caRegulatoryNotes: str(source.caRegulatoryNotes),
    specs,
  };
}

// ---------------------------------------------------------------------------
// Step 4 — brand-site product-page scrape (never throws)
// ---------------------------------------------------------------------------

async function scrapeBrandProductPage(
  env: Env,
  storeProductId: number,
  ctx: ProductContext,
  research: DeepResearchResult,
): Promise<ScrapeStepResult> {
  const result: ScrapeStepResult = { images: [], pageUrls: [] };

  try {
    if (!ctx.brandWebsiteUrl) return result;
    const brandHost = hostOf(ctx.brandWebsiteUrl);
    if (!brandHost) return result;

    // (a) Prefer a deep-research source already on the brand's domain.
    const brandDomainSource = researchSourceUrls(research).find((url) => {
      const host = hostOf(url);
      return host === brandHost || host?.endsWith(`.${brandHost}`) === true;
    });

    const pagesToScrape: string[] = [];
    let budget = MAX_SCRAPE_PAGES;

    if (brandDomainSource) {
      pagesToScrape.push(brandDomainSource);
    } else {
      // (b) Scrape the brand homepage and ask the extractor for the best
      //     candidate product-page link.
      const home = await scrapeUrl(env, ctx.brandWebsiteUrl);
      budget -= 1;
      const homeMarkdown = home.markdown ?? home.text ?? "";
      result.pageUrls.push(ctx.brandWebsiteUrl);
      await archiveScrapeMarkdown(
        env,
        storeProductId,
        ctx.brandWebsiteUrl,
        homeMarkdown,
      );

      const sameDomainLinks: Array<{ href: string; text?: string }> = [];
      const seen = new Set<string>();
      for (const link of home.links) {
        const normalized = normalizeUrl(link.href, ctx.brandWebsiteUrl);
        if (!normalized || seen.has(normalized)) continue;
        const host = hostOf(normalized);
        if (host !== brandHost && host?.endsWith(`.${brandHost}`) !== true) {
          continue;
        }
        seen.add(normalized);
        sameDomainLinks.push({ href: normalized, text: link.text });
        if (sameDomainLinks.length >= 80) break;
      }

      const best = await pickProductPage(env, ctx, sameDomainLinks);
      if (best) pagesToScrape.push(best);
    }

    // (c) Scrape the located product page(s) within budget, archive, and
    //     extract product imagery.
    for (const pageUrl of pagesToScrape.slice(0, Math.max(0, budget))) {
      try {
        const scraped = await scrapeUrl(env, pageUrl);
        const markdown = scraped.markdown ?? scraped.text ?? "";
        result.pageUrls.push(pageUrl);
        await archiveScrapeMarkdown(env, storeProductId, pageUrl, markdown);

        const imageUrls = await extractProductImageUrls(
          env,
          ctx,
          pageUrl,
          markdown,
        );
        for (const url of imageUrls) {
          if (!result.images.some((img) => img.url === url)) {
            result.images.push({ url, pageUrl });
          }
        }
      } catch (err) {
        console.error(
          `product-research: product-page scrape failed for ${pageUrl}`,
          err,
        );
      }
    }
  } catch (err) {
    console.error(
      `product-research: brand-site scrape failed for product ${storeProductId}`,
      err,
    );
  }

  return result;
}

/** Archive scraped page markdown to R2 under product-scrapes/<id>/. */
async function archiveScrapeMarkdown(
  env: Env,
  storeProductId: number,
  pageUrl: string,
  markdown: string,
): Promise<void> {
  if (markdown.trim().length === 0) return;
  const r2Key = `product-scrapes/${storeProductId}/${encodeURIComponent(pageUrl)}.md`;
  try {
    await env.ARTIFACTS_BUCKET.put(r2Key, markdown, {
      httpMetadata: { contentType: "text/markdown" },
      customMetadata: { storeProductId: String(storeProductId), pageUrl },
    });
  } catch (err) {
    console.error(`product-research: R2 put failed for ${pageUrl}`, err);
  }
}

/** Ask Workers AI to pick the best candidate product page from homepage links. */
async function pickProductPage(
  env: Env,
  ctx: ProductContext,
  links: Array<{ href: string; text?: string }>,
): Promise<string | null> {
  if (links.length === 0) return null;

  const linkList = links
    .map((l) => `- ${l.href}${l.text ? ` — "${l.text}"` : ""}`)
    .join("\n");

  const prompt = `You are locating the product page for "${productLabel(ctx)}" on the brand's own website.

From the candidate links below (all on the brand's domain), pick the ONE URL most likely to be the dedicated product page (or the closest product-line/collection page) for that exact product. Return null if none plausibly lead to it.

CANDIDATE LINKS:
${linkList}

Respond ONLY with valid JSON conforming to the supplied schema.`;

  try {
    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content:
              "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: PRODUCT_PAGE_PICK_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown; bestUrl?: unknown };

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as { bestUrl?: unknown })
        : raw;

    const bestUrl =
      typeof source?.bestUrl === "string" ? source.bestUrl.trim() : null;
    if (!bestUrl) return null;
    // Only accept a URL that was actually in the candidate list.
    return links.some((l) => l.href === bestUrl) ? bestUrl : null;
  } catch (err) {
    console.error("product-research: product-page pick failed", err);
    return null;
  }
}

/** Extract product-imagery URLs from a scraped product page via Workers AI. */
async function extractProductImageUrls(
  env: Env,
  ctx: ProductContext,
  pageUrl: string,
  markdown: string,
): Promise<string[]> {
  const preview =
    markdown.length > 8_000 ? `${markdown.slice(0, 8_000)}\n\n[truncated]` : markdown;

  const prompt = `You are extracting PRODUCT imagery URLs for "${productLabel(ctx)}" from a scraped brand-website page.

Page URL: ${pageUrl}

From the page content below, extract absolute image URLs that depict the product itself (product shots, finish/colorway shots, in-room lifestyle shots of THIS product). Exclude logos, icons, unrelated products, and tracking pixels. Return an empty array if none are present. Do NOT invent URLs.

Respond ONLY with valid JSON conforming to the supplied schema.

PAGE CONTENT:
${preview}`;

  try {
    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content:
              "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: IMAGE_URLS_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown; imageUrls?: unknown };

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as { imageUrls?: unknown })
        : raw;

    const urls = Array.isArray(source?.imageUrls)
      ? source.imageUrls.filter(
          (u): u is string => typeof u === "string" && u.startsWith("http"),
        )
      : [];
    if (urls.length > 0) return urls;
  } catch (err) {
    console.error(`product-research: image extraction failed for ${pageUrl}`, err);
  }

  // Fallback: markdown image syntax ![alt](url).
  const fallback: string[] = [];
  const imgRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(markdown)) !== null && fallback.length < MAX_PHOTOS) {
    if (!fallback.includes(match[1])) fallback.push(match[1]);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Step 5 — photos → Cloudflare Images + product_images (never throws)
// ---------------------------------------------------------------------------

async function persistPhotos(
  env: Env,
  storeProductId: number,
  images: DiscoveredImage[],
): Promise<{ uploaded: number; deliveryUrls: string[] }> {
  const outcome = { uploaded: 0, deliveryUrls: [] as string[] };
  try {
    const candidates = images.slice(0, MAX_PHOTOS);
    if (candidates.length === 0) return outcome;

    const db = drizzle(env.DB);

    // Respect the (storeProductId, sourceUrl) unique — pre-check what exists.
    const existing = await db
      .select({ sourceUrl: productImages.sourceUrl })
      .from(productImages)
      .where(eq(productImages.storeProductId, storeProductId));
    const seen = new Set(existing.map((row) => row.sourceUrl));

    const processor = await tryCreateProcessor(env);
    if (!processor) {
      console.error(
        `product-research: no CF Images credentials — skipping photos for product ${storeProductId}`,
      );
      return outcome;
    }

    for (let i = 0; i < candidates.length; i++) {
      const { url: sourceUrl, pageUrl } = candidates[i];
      if (seen.has(sourceUrl)) continue;

      try {
        const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) continue;
        const contentType = resp.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("image/")) continue;
        const blob = await resp.blob();

        const upload = await processor.uploadToCloudflareImages(
          blob,
          `product-photo-${storeProductId}-${i}`,
          `product-photo-${storeProductId}-${i}.jpg`,
        );
        const deliveryUrl = processor.getDeliveryUrl(upload, upload.result.id);

        await db
          .insert(productImages)
          .values({
            storeProductId,
            sourceUrl,
            sourcePageUrl: pageUrl,
            cfImageId: upload.result.id,
            deliveryUrl,
            mimeType: contentType.split(";")[0] || null,
            imageKind: "product",
            reviewStatus: "pending",
          })
          .onConflictDoNothing();
        seen.add(sourceUrl);
        outcome.uploaded += 1;
        outcome.deliveryUrls.push(deliveryUrl);
      } catch (err) {
        console.error(
          `product-research: photo upload failed for ${sourceUrl}`,
          err,
        );
      }
    }
  } catch (err) {
    console.error(
      `product-research: photos step failed for product ${storeProductId}`,
      err,
    );
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Step 6 — persist (fill-blanks product fields, specs, intel columns)
// ---------------------------------------------------------------------------

async function persistIntel(
  env: Env,
  storeProductId: number,
  intel: IntelExtraction,
  research: DeepResearchResult,
): Promise<{ wrote: string[] }> {
  const db = drizzle(env.DB);
  const wrote: string[] = [];

  // ── Fill-blanks onto showroom_store_products. ────────────────────────────
  const [product] = await db
    .select({
      description: showroomStoreProducts.description,
      productType: showroomStoreProducts.productType,
      price: showroomStoreProducts.price,
    })
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.id, storeProductId))
    .limit(1);

  if (product) {
    const updates: Partial<typeof showroomStoreProducts.$inferInsert> = {};
    if (!product.description?.trim() && intel.description) {
      updates.description = intel.description;
    }
    if (!product.productType?.trim() && intel.productType) {
      updates.productType = intel.productType;
    }
    if (!product.price?.trim() && intel.aiRetailPrice) {
      updates.price = intel.aiRetailPrice;
    }
    if (Object.keys(updates).length > 0) {
      wrote.push(
        ...Object.keys(updates).map((col) => `showroom_store_products.${col}`),
      );
      await db
        .update(showroomStoreProducts)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(showroomStoreProducts.id, storeProductId));
    }
  }

  // ── product_specs inserts. ───────────────────────────────────────────────
  // SQLite treats NULLs as distinct in unique indexes, so the
  // (storeProductId, specKey, sourceUrl) constraint won't dedupe null-source
  // rows — pre-check existing keys case-insensitively, then insert with
  // onConflictDoNothing as a belt-and-braces.
  let specsInserted = 0;
  if (intel.specs.length > 0) {
    const firstSourceUrl = researchSourceUrls(research)[0] ?? null;

    const existingSpecs = await db
      .select({ specKey: productSpecs.specKey })
      .from(productSpecs)
      .where(eq(productSpecs.storeProductId, storeProductId));
    const seenKeys = new Set(
      existingSpecs.map((row) => row.specKey.toLowerCase()),
    );

    for (const spec of intel.specs) {
      if (seenKeys.has(spec.key.toLowerCase())) continue;
      try {
        await db
          .insert(productSpecs)
          .values({
            storeProductId,
            specKey: spec.key,
            specValue: spec.value,
            unit: spec.unit,
            sourceUrl: firstSourceUrl,
            confidence: 60,
          })
          .onConflictDoNothing();
        seenKeys.add(spec.key.toLowerCase());
        specsInserted += 1;
      } catch (err) {
        console.error(
          `product-research: spec insert failed for "${spec.key}"`,
          err,
        );
      }
    }
  }
  if (specsInserted > 0) {
    wrote.push(`product_specs(+${specsInserted})`);
  }

  // ── store_product_intel — every intel column + report + sources. ─────────
  const intelSet = {
    reviewSummary: intel.reviewSummary,
    priceRangeLow: intel.priceRangeLow,
    priceRangeHigh: intel.priceRangeHigh,
    aiWholesalePrice: intel.aiWholesalePrice,
    aiWholesaleRationale: intel.aiWholesaleRationale,
    aiRetailPrice: intel.aiRetailPrice,
    aiRetailRationale: intel.aiRetailRationale,
    aiNegotiatedPrice: intel.aiNegotiatedPrice,
    aiNegotiatedRationale: intel.aiNegotiatedRationale,
    salesIntel: intel.salesIntel,
    caRegulatoryFlag: intel.caRegulatoryFlag,
    caRegulatoryNotes: intel.caRegulatoryNotes,
    researchReport: research.report,
    researchSources: research.sources,
  };
  await db
    .update(storeProductIntel)
    .set({ ...intelSet, updatedAt: new Date() })
    .where(eq(storeProductIntel.storeProductId, storeProductId));
  wrote.push(
    ...Object.entries(intelSet)
      .filter(([, value]) => value != null)
      .map(([col]) => `store_product_intel.${col}`),
  );

  return { wrote };
}

// ---------------------------------------------------------------------------
// Step 7 — embed report into RESEARCH_INDEX (never throws)
// ---------------------------------------------------------------------------

async function embedReport(
  env: Env,
  storeProductId: number,
  report: string,
): Promise<number> {
  try {
    const { chunks } = chunkMarkdown(report);
    if (chunks.length === 0) return 0;

    const namespace = `product:research:${storeProductId}`;
    const hash = await stableHash(namespace);
    let written = 0;

    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      const embeddingResult = (await env.AI.run(
        EMBED_MODEL,
        { text: batch },
        { gateway: { id: env.AI_GATEWAY_ID } },
      )) as { data: number[][] };

      const vectors = embeddingResult.data.map((values, offset) => {
        const chunkIndex = i + offset;
        return {
          id: `${namespace}:${hash}:${chunkIndex}`,
          values,
          namespace,
          metadata: {
            namespace,
            storeProductId,
            chunkIndex,
            textPreview: batch[offset].slice(0, 240),
          } as Record<string, string | number | boolean>,
        };
      });

      await env.RESEARCH_INDEX.upsert(vectors);
      written += vectors.length;
    }

    return written;
  } catch (err) {
    console.error(
      `product-research: embed failed for product ${storeProductId}`,
      err,
    );
    return 0;
  }
}

async function stableHash(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes.slice(0, 8)) {
    hex = `${hex}${byte.toString(16).padStart(2, "0")}`;
  }
  return hex;
}

// ---------------------------------------------------------------------------
// URL + Cloudflare Images helpers (mirrors showroom-scrape-workflow.ts)
// ---------------------------------------------------------------------------

/** Lowercased host with any leading "www." stripped. Null on junk. */
function hostOf(raw: string): string | null {
  try {
    return new URL(raw).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Canonical crawl key — shared with the showroom/brand crawlers. This file's copy
 * was the best of the three (it alone had the http(s) guard, now folded into the
 * shared helper) but still missed the trailing-slash collapse, so `/x` and `/x/`
 * were different `seen` keys and both got rendered.
 */
const normalizeUrl = normalizeCrawlUrl;

async function tryCreateProcessor(
  env: Env,
): Promise<ImageProcessorService | null> {
  try {
    const { accountId, apiTokens } =
      await resolveCloudflareImagesCredentials(env);
    const [primaryToken, ...fallbackApiTokens] = apiTokens;
    if (!accountId || !primaryToken) return null;
    return new ImageProcessorService(env, accountId, primaryToken, {
      fallbackApiTokens,
    });
  } catch {
    return null;
  }
}
