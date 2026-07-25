// src/backend/services/bucket-intake-workflow.ts
/**
 * @fileoverview Bucket Intake Workflow (Phase C).
 *
 * Replaces the inline `POST /buckets/:id/process` single-product path with a
 * durable Cloudflare Workflow that yields **0-N candidate matches** into
 * `bucket_product_candidates` for later human review (HITL, Phase D/E).
 *
 * Steps: mark-running → describe-photos → extract-candidates → persist → done.
 * It records into a research-console job (research_jobs) so the intake UI can
 * poll `GET /api/research-jobs/{id}` for live status, and into an agent-run so
 * the AI spend is attributed.
 *
 * ponytail: C1 produces candidates from the bucket photos + grouping hints
 * only — it does NOT crawl the web for imagery yet. The `image_source_urls` /
 * `pdf_source_urls` columns stay null until Phase B lands the sitemap table
 * that a per-brand product-page scrape depends on; wiring the scrape here first
 * would mean re-deriving brand sitemaps per run with nowhere to cache them.
 */
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  bucketProductCandidates,
  productPhotoBuckets,
  productShowroomPhotos,
} from "@backend/db/schema/showroom/index";
import { brands } from "@backend/db/schema/brands/index";
import { ImageProcessorService } from "@backend/services/image-processor";
import {
  extractShowroomProductCandidates,
  type CandidateHints,
  type ProductCandidate,
} from "@backend/services/image-processor/product-extraction";
import { loadExtractionVocab } from "@backend/services/image-processor/intake-helpers";
import {
  enrichCandidateAssets,
  type CandidateEnrichResult,
} from "@backend/services/scraping/candidate-enrich";
import { startRun } from "@backend/services/agent-runs";
import { ledgerSteps } from "@backend/services/agent-run-workflow";
import {
  beginStep,
  completeJob,
  completeStep,
  createResearchJob,
  failJob,
  failStep,
  updateJob,
} from "@backend/services/research-jobs";

export interface BucketIntakeParams {
  bucketId: number;
  /** Pre-created research-console job id — adopted when the API minted one so
   *  the UI could navigate immediately; else created inside mark-running. */
  researchJobId?: number;
}

/** mark-running, describe-photos, extract-candidates, enrich, persist, mark-complete. */
const TOTAL_JOB_STEPS = 6;

/** Top-ranked candidates to web-scrape for staged assets (bounds fetch fan-out). */
const MAX_ENRICH_CANDIDATES = 3;

export class BucketIntakeWorkflow extends WorkflowEntrypoint<
  Env,
  BucketIntakeParams
> {
  async run(event: WorkflowEvent<BucketIntakeParams>, rawStep: WorkflowStep) {
    const { bucketId } = event.payload;
    const env = this.env;
    // NB: do NOT hoist a `drizzle(env.DB)` here and use it inside step.do —
    // a D1 client captured in the outer run() scope goes stale across a
    // Workflow step boundary and every query throws "The RPC receiver does not
    // implement the method 'bind'". Create the client fresh inside each step
    // (mirrors ProductResearchWorkflow).

    const run = await startRun(env, {
      agent: "bucket-intake",
      operation: "match_bucket_candidates",
      targetType: "product_photo_bucket",
      targetId: String(bucketId),
      input: { bucketId, researchJobId: event.payload.researchJobId ?? null },
      triggeredBy: "agent",
    });
    const step = ledgerSteps(rawStep, run);

    let jobId: number | null = event.payload.researchJobId ?? null;
    const errText = (err: unknown): string =>
      err instanceof Error ? err.message : String(err);

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
      const marked = await step.do("mark-running", async () => {
        const db = drizzle(env.DB);
        const [bucket] = await db
          .select()
          .from(productPhotoBuckets)
          .where(eq(productPhotoBuckets.id, bucketId))
          .limit(1);
        if (!bucket) throw new Error(`bucket ${bucketId} not found`);

        const photos = await db
          .select()
          .from(productShowroomPhotos)
          .where(eq(productShowroomPhotos.bucketId, bucketId));
        if (photos.length === 0) throw new Error(`bucket ${bucketId} has no photos`);

        await db
          .update(productPhotoBuckets)
          .set({ status: "processing" })
          .where(eq(productPhotoBuckets.id, bucketId));

        // Clear any prior candidates so a re-run is idempotent (keep-forever
        // applies to reviewed candidates; un-reviewed re-runs start clean).
        await db
          .delete(bucketProductCandidates)
          .where(eq(bucketProductCandidates.bucketId, bucketId));

        let resolvedJobId = event.payload.researchJobId ?? null;
        if (resolvedJobId) {
          await updateJob(env, resolvedJobId, {
            workflowInstanceId: event.instanceId ?? null,
            totalSteps: TOTAL_JOB_STEPS,
          });
        } else {
          resolvedJobId = await createResearchJob(env, {
            kind: "product",
            title: `Bucket intake — ${bucket.label ?? `#${bucketId}`}`,
            topic: bucket.productName ?? bucket.brandNameRaw ?? bucket.label ?? null,
            entityId: bucketId,
            totalSteps: TOTAL_JOB_STEPS,
            workflowInstanceId: event.instanceId ?? null,
          });
        }
        await beginStep(
          env,
          resolvedJobId,
          "mark-running",
          "Loading bucket photos & hints",
          0,
        );

        const imageUrls = photos
          .map((p) => p.imageUrl)
          .filter((u): u is string => !!u);

        const hints: CandidateHints = {
          brandName: bucket.brandNameRaw,
          productName: bucket.productName,
          modelNumber: bucket.modelNumber,
          sku: bucket.sku,
          productUrl: bucket.productUrl,
        };

        return { imageUrls, hints, brandId: bucket.brandId, jobId: resolvedJobId };
      });
      jobId = marked.jobId ?? jobId;
      await completeStep(env, jobId, "mark-running", {
        detail: `${marked.imageUrls.length} photo(s) to describe`,
      });

      // ── 2. describe-photos ──────────────────────────────────────────────
      const descriptions = await recorded(
        "describe-photos",
        "Describing bucket photos",
        1,
        () =>
          step.do("describe-photos", async () => {
            const service = new ImageProcessorService(env, "", "");
            return Promise.all(marked.imageUrls.map((u) => service.describeImage(u)));
          }),
        (d) => ({ detail: `${d.length} photo(s) described` }),
      );

      // ── 3. extract-candidates ───────────────────────────────────────────
      const candidates = await recorded(
        "extract-candidates",
        "Extracting product candidates",
        2,
        () =>
          step.do("extract-candidates", async () => {
            const db = drizzle(env.DB);
            const vocab = await loadExtractionVocab(db);
            return extractShowroomProductCandidates(
              env,
              descriptions,
              marked.hints,
              vocab,
            );
          }),
        (cands) => ({
          detail: `${cands.length} candidate(s)`,
          artifact: { count: cands.length },
        }),
      );

      // ── 4. enrich-candidates ────────────────────────────────────────────
      // Stage each top candidate's product-page image/PDF SOURCE urls (no
      // download — held until HITL confirm). Best-effort; never fails the run.
      const enrichments = await recorded(
        "enrich-candidates",
        "Staging product-page assets",
        3,
        () =>
          step.do("enrich-candidates", async () =>
            Promise.all(
              candidates.map((cand, i) =>
                i < MAX_ENRICH_CANDIDATES
                  ? enrichCandidateAssets(env, {
                      productUrl: cand.productUrl,
                      hintProductUrl: marked.hints.productUrl,
                      brandId: marked.brandId,
                      itemName: cand.itemName,
                      modelNumber: cand.modelNumber,
                    }).catch(() => EMPTY_ENRICHMENT)
                  : Promise.resolve(EMPTY_ENRICHMENT),
              ),
            ),
          ),
        (res) => ({
          detail: `${res.filter((r) => r.imageSourceUrls.length || r.pdfSourceUrls.length).length} candidate(s) enriched`,
        }),
      );

      // ── 5. persist-candidates ───────────────────────────────────────────
      const persisted = await recorded(
        "persist-candidates",
        "Saving candidates for review",
        4,
        () =>
          step.do("persist-candidates", async () =>
            persistCandidates(drizzle(env.DB), bucketId, marked.brandId, candidates, enrichments),
          ),
        (n) => ({ detail: `${n} candidate row(s) written` }),
      );

      // ── 6. mark-complete ────────────────────────────────────────────────
      await recorded(
        "mark-complete",
        "Marking bucket processed",
        5,
        () =>
          step.do("mark-complete", async () => {
            await drizzle(env.DB)
              .update(productPhotoBuckets)
              .set({ status: "processed" })
              .where(eq(productPhotoBuckets.id, bucketId));
          }),
        () => ({ detail: `bucket ${bucketId} → processed` }),
      );

      await completeJob(env, jobId, {
        result: { bucketId, candidates: persisted },
      });
      await run.succeed({ bucketId, candidates: persisted });
    } catch (error) {
      await run.fail(error);
      await failJob(env, jobId, error);
      // Never leave the bucket stuck in 'processing' — revert to 'draft' so
      // the wizard can retry (mirrors the inline handler's recovery).
      try {
        await drizzle(env.DB)
          .update(productPhotoBuckets)
          .set({ status: "draft" })
          .where(eq(productPhotoBuckets.id, bucketId));
      } catch (markErr) {
        console.error(`bucket-intake: failed to revert bucket ${bucketId}`, markErr);
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// persist — insert one row per candidate
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof drizzle>;

/** Placeholder for candidates not enriched (beyond the top-N, or a miss). */
const EMPTY_ENRICHMENT: CandidateEnrichResult = {
  productUrl: null,
  imageSourceUrls: [],
  pdfSourceUrls: [],
};

async function persistCandidates(
  db: Db,
  bucketId: number,
  hintBrandId: number | null,
  candidates: ProductCandidate[],
  enrichments: CandidateEnrichResult[] = [],
): Promise<number> {
  if (candidates.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const enrich = enrichments[i] ?? EMPTY_ENRICHMENT;
    // Resolve the brand to an existing id by exact name (case-insensitive);
    // fall back to the bucket's hint brand. No new brand is created here —
    // that happens only on HITL confirm.
    const brandId = await resolveBrandId(db, cand.brand) ?? hintBrandId ?? null;

    await db.insert(bucketProductCandidates).values({
      bucketId,
      rank: i,
      confidence: cand.confidence ?? null,
      brandId,
      brandNameRaw: cand.brand ?? null,
      productName: cand.itemName ?? null,
      modelNumber: cand.modelNumber ?? null,
      // Prefer the page the assets were scraped from, else the extracted url.
      productUrl: enrich.productUrl ?? cand.productUrl ?? null,
      category: cand.category ?? null,
      style: cand.style ?? null,
      priceText: cand.price ?? null,
      salePriceText: cand.salePrice ?? null,
      discountText: cand.discountInfo ?? null,
      colors: cand.colors ? JSON.stringify(cand.colors) : null,
      imageSourceUrls: enrich.imageSourceUrls.length ? JSON.stringify(enrich.imageSourceUrls) : null,
      pdfSourceUrls: enrich.pdfSourceUrls.length ? JSON.stringify(enrich.pdfSourceUrls) : null,
      rationale: cand.rationale ?? null,
      rawExtraction: JSON.stringify(cand),
      status: "pending",
    });
    written++;
  }
  return written;
}

/** Exact case-insensitive brand-name match to an existing id, or null. */
async function resolveBrandId(db: Db, name?: string | null): Promise<number | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  const [row] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.name, trimmed))
    .limit(1);
  return row?.id ?? null;
}
