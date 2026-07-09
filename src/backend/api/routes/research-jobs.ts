/**
 * @fileoverview Research jobs API — `/api/research-jobs` (gated by
 * `requireAccessAuth`, see src/backend/api/index.ts).
 *
 * The research console's backend: list/inspect `research_jobs` rows (with
 * their `research_job_steps` timelines), initiate new research of any kind,
 * and register discovery candidates into the showroom / brand / product
 * registry.
 *
 * Endpoints:
 *   GET  /            List jobs newest-first (limit 100, optional ?status=).
 *   GET  /:id         One job + its ordered step timeline.
 *   POST /            Initiate research (7 kinds — see route description).
 *   POST /:id/intake  Register a discovery candidate into the registry.
 *
 * Conventions:
 *   - Hand-written Zod v4 schemas (drizzle-zod is banned — breaks the build).
 *   - `drizzle(c.env.DB)` per request — no global state.
 *   - Heavy work always runs on Workflows / the ShowroomResearchAgent queue;
 *     handlers only create rows and dispatch.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getAgentByName } from "agents";

import {
  researchJobs,
  researchJobSteps,
  type ResearchJob,
} from "@backend/db/schema/research/index";
import { showroomStores } from "@backend/db/schema/showroom/stores";
import { showroomStoreProducts } from "@backend/db/schema/showroom/store_products";
import { showroomProductMappings } from "@backend/db/schema/showroom/product_mappings";
import { brands } from "@backend/db/schema/brands/brands";
import { GoogleMapsService } from "@backend/services/google/maps";
import { enrichNewBrand } from "@backend/services/showroom/brand-enrichment";
import { createResearchJob } from "@backend/services/research-jobs";
import type { DiscoveryCandidate } from "@backend/services/deep-research-job-workflow";
import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";

export const researchJobsRouter = new OpenAPIHono<{ Bindings: Env }>();

const ErrorSchema = z.object({ error: z.string() });

/** Resolve the singleton ShowroomResearchAgent DO instance. */
async function getShowroomResearchAgent(env: Env) {
  return getAgentByName<Env, ShowroomResearchAgent>(
    env.SHOWROOM_RESEARCH_AGENT as any,
    "showroom-research",
  );
}

// ─── Shared schemas ──────────────────────────────────────────────────────────

const JOB_KINDS = [
  "showroom",
  "brand",
  "product",
  "discovery_showrooms",
  "discovery_brands",
  "discovery_products",
  "custom",
] as const;

const JOB_STATUSES = ["pending", "running", "complete", "failed"] as const;

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

const JobListItemSchema = z.object({
  id: z.number().int(),
  kind: z.enum(JOB_KINDS),
  title: z.string(),
  status: z.enum(JOB_STATUSES),
  progress: z.number().int(),
  currentStep: z.string().nullable(),
  entityType: z.enum(["showroom", "brand", "product"]).nullable(),
  entityId: z.number().int().nullable(),
  entityName: z.string().nullable(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  error: z.string().nullable(),
});

/** Unix-seconds serializer for the timestamp-mode Date columns. */
const toUnix = (d: Date | null | undefined): number | null =>
  d instanceof Date ? Math.floor(d.getTime() / 1000) : null;

// ─── GET / — list jobs ───────────────────────────────────────────────────────

researchJobsRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    operationId: "listResearchJobs",
    tags: ["Research Jobs"],
    summary: "List research jobs newest-first",
    request: {
      query: z.object({
        status: z.enum(JOB_STATUSES).optional(),
      }),
    },
    responses: {
      200: {
        description: "Up to 100 jobs, newest first, with resolved entity names.",
        content: {
          "application/json": {
            schema: z.object({ jobs: z.array(JobListItemSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { status } = c.req.valid("query");
    const db = drizzle(c.env.DB);

    const rows = await db
      .select({
        id: researchJobs.id,
        kind: researchJobs.kind,
        title: researchJobs.title,
        status: researchJobs.status,
        progress: researchJobs.progress,
        currentStep: researchJobs.currentStep,
        entityType: researchJobs.entityType,
        entityId: researchJobs.entityId,
        createdAt: researchJobs.createdAt,
        updatedAt: researchJobs.updatedAt,
        completedAt: researchJobs.completedAt,
        error: researchJobs.error,
      })
      .from(researchJobs)
      .where(status ? eq(researchJobs.status, status) : undefined)
      .orderBy(desc(researchJobs.id))
      .limit(100);

    // Bulk-resolve linked entity names per entity type.
    const idsFor = (type: "showroom" | "brand" | "product") => [
      ...new Set(
        rows
          .filter((r) => r.entityType === type && r.entityId != null)
          .map((r) => r.entityId as number),
      ),
    ];
    const [showroomIds, brandIds, productIds] = [
      idsFor("showroom"),
      idsFor("brand"),
      idsFor("product"),
    ];

    const [showroomRows, brandRows, productRows] = await Promise.all([
      showroomIds.length > 0
        ? db
            .select({ id: showroomStores.id, name: showroomStores.name })
            .from(showroomStores)
            .where(inArray(showroomStores.id, showroomIds))
        : Promise.resolve([]),
      brandIds.length > 0
        ? db
            .select({ id: brands.id, name: brands.name })
            .from(brands)
            .where(inArray(brands.id, brandIds))
        : Promise.resolve([]),
      productIds.length > 0
        ? db
            .select({ id: showroomStoreProducts.id, name: showroomStoreProducts.itemName })
            .from(showroomStoreProducts)
            .where(inArray(showroomStoreProducts.id, productIds))
        : Promise.resolve([]),
    ]);

    const nameMaps = {
      showroom: new Map(showroomRows.map((r) => [r.id, r.name])),
      brand: new Map(brandRows.map((r) => [r.id, r.name])),
      product: new Map(productRows.map((r) => [r.id, r.name])),
    } as const;

    const jobs = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      progress: r.progress,
      currentStep: r.currentStep,
      entityType: r.entityType,
      entityId: r.entityId,
      entityName:
        r.entityType && r.entityId != null
          ? (nameMaps[r.entityType].get(r.entityId) ?? null)
          : null,
      createdAt: toUnix(r.createdAt),
      updatedAt: toUnix(r.updatedAt),
      completedAt: toUnix(r.completedAt),
      error: r.error,
    }));

    return c.json({ jobs }, 200);
  },
);

// ─── GET /:id — job detail + step timeline ───────────────────────────────────

researchJobsRouter.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    operationId: "getResearchJob",
    tags: ["Research Jobs"],
    summary: "One research job with its ordered step timeline",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: "The full job row plus its steps (sortOrder asc, id asc).",
        content: {
          "application/json": {
            schema: z.object({
              job: z.record(z.string(), z.unknown()),
              steps: z.array(z.record(z.string(), z.unknown())),
            }),
          },
        },
      },
      404: {
        description: "Job not found.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);

    const [job] = await db
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.id, id))
      .limit(1);
    if (!job) {
      return c.json({ error: "Research job not found" }, 404);
    }

    const steps = await db
      .select()
      .from(researchJobSteps)
      .where(eq(researchJobSteps.jobId, id))
      .orderBy(asc(researchJobSteps.sortOrder), asc(researchJobSteps.id));

    return c.json(
      { job: job as Record<string, unknown>, steps: steps as Record<string, unknown>[] },
      200,
    );
  },
);

// ─── POST / — initiate research ──────────────────────────────────────────────

const InitiateBodySchema = z.object({
  kind: z.enum(JOB_KINDS),
  /** Custom kind: the research prompt (alias of `criteria`). */
  topic: z.string().min(1).optional(),
  /** Discovery kinds: the search criteria. Custom: the prompt. */
  criteria: z.string().min(1).optional(),
  /** Entity kinds: brandId / storeProductId / showroomId respectively. */
  entityId: z.number().int().positive().optional(),
  /** Reserved for product flows that need a store scope. */
  storeId: z.number().int().positive().optional(),
});

/** Step budgets per kind — drives the console progress estimate. */
const TOTAL_STEPS = {
  brand: 17,
  product: 15,
  showroom: 9,
  custom: 9,
  discovery: 11,
} as const;

researchJobsRouter.openapi(
  createRoute({
    method: "post",
    path: "/",
    operationId: "initiateResearchJob",
    tags: ["Research Jobs"],
    summary: "Initiate a research job",
    description:
      "Creates a research_jobs row and dispatches the matching engine: " +
      "brand/product → their enrichment Workflows; showroom → the " +
      "ShowroomResearchAgent deep-sweep (which creates its own job row); " +
      "discovery_*/custom → DeepResearchJobWorkflow.",
    request: {
      body: {
        content: { "application/json": { schema: InitiateBodySchema } },
      },
    },
    responses: {
      202: {
        description: "Job created and dispatched (showroom kind returns queued:true, no jobId).",
        content: {
          "application/json": {
            schema: z.object({
              jobId: z.number().int().optional(),
              queued: z.boolean().optional(),
            }),
          },
        },
      },
      400: {
        description: "Missing/invalid fields for the requested kind.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      404: {
        description: "Linked entity not found.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      500: {
        description: "Job creation or dispatch failed.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);

    // ── kind: brand ─────────────────────────────────────────────────────────
    if (body.kind === "brand") {
      if (!body.entityId) {
        return c.json({ error: "entityId (brand id) is required for kind 'brand'" }, 400);
      }
      const [brand] = await db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(eq(brands.id, body.entityId))
        .limit(1);
      if (!brand) return c.json({ error: "Brand not found" }, 404);

      const jobId = await createResearchJob(c.env, {
        kind: "brand",
        title: `Brand research — ${brand.name}`,
        entityType: "brand",
        entityId: brand.id,
        totalSteps: TOTAL_STEPS.brand,
      });
      if (!jobId) return c.json({ error: "Failed to create research job" }, 500);

      await c.env.BRAND_RESEARCH_WORKFLOW.create({
        params: { brandId: brand.id, researchJobId: jobId },
      });
      return c.json({ jobId }, 202);
    }

    // ── kind: product ───────────────────────────────────────────────────────
    if (body.kind === "product") {
      if (!body.entityId) {
        return c.json(
          { error: "entityId (store product id) is required for kind 'product'" },
          400,
        );
      }
      const [product] = await db
        .select({ id: showroomStoreProducts.id, itemName: showroomStoreProducts.itemName })
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, body.entityId))
        .limit(1);
      if (!product) return c.json({ error: "Product not found" }, 404);

      const jobId = await createResearchJob(c.env, {
        kind: "product",
        title: `Product research — ${product.itemName}`,
        entityType: "product",
        entityId: product.id,
        totalSteps: TOTAL_STEPS.product,
      });
      if (!jobId) return c.json({ error: "Failed to create research job" }, 500);

      await c.env.PRODUCT_RESEARCH_WORKFLOW.create({
        params: { storeProductId: product.id, researchJobId: jobId },
      });
      return c.json({ jobId }, 202);
    }

    // ── kind: showroom ──────────────────────────────────────────────────────
    if (body.kind === "showroom") {
      if (!body.entityId) {
        return c.json({ error: "entityId (showroom id) is required for kind 'showroom'" }, 400);
      }
      const [store] = await db
        .select({ id: showroomStores.id, name: showroomStores.name })
        .from(showroomStores)
        .where(eq(showroomStores.id, body.entityId))
        .limit(1);
      if (!store) return c.json({ error: "Showroom not found" }, 404);

      // NOTE: no job row is created here. The showroom deep-sweep
      // (ShowroomResearchAgent.researchStore) creates its OWN research_jobs
      // row internally — pre-creating one here would leave a duplicate. The
      // console list picks up the agent-created row within seconds.
      const showroomId = store.id;
      const agent = await getShowroomResearchAgent(c.env);
      c.executionCtx.waitUntil(
        agent.researchStore(showroomId).catch((err: unknown) => {
          console.error(
            `[research-jobs] showroom deep-sweep dispatch failed for #${showroomId}:`,
            err,
          );
        }),
      );
      return c.json({ queued: true }, 202);
    }

    // ── kinds: discovery_* + custom ─────────────────────────────────────────
    const criteria = (body.criteria ?? body.topic ?? "").trim();
    if (!criteria) {
      return c.json(
        {
          error:
            body.kind === "custom"
              ? "topic (or criteria) is required for kind 'custom'"
              : `criteria is required for kind '${body.kind}'`,
        },
        400,
      );
    }

    const isCustom = body.kind === "custom";
    const noun = body.kind.replace("discovery_", ""); // showrooms | brands | products
    const title = isCustom
      ? criteria.slice(0, 60)
      : `Find ${noun}: ${criteria.slice(0, 50)}`;

    const jobId = await createResearchJob(c.env, {
      kind: body.kind,
      title,
      topic: isCustom ? criteria : null,
      criteria,
      totalSteps: isCustom ? TOTAL_STEPS.custom : TOTAL_STEPS.discovery,
    });
    if (!jobId) return c.json({ error: "Failed to create research job" }, 500);

    await c.env.DEEP_RESEARCH_JOB_WORKFLOW.create({ params: { researchJobId: jobId } });
    return c.json({ jobId }, 202);
  },
);

// ─── POST /:id/intake — register a discovery candidate ──────────────────────

const IntakeBodySchema = z.object({
  candidateIndex: z.number().int().min(0),
  /** Required for discovery_products — the showroom the product belongs to. */
  storeId: z.number().int().positive().optional(),
});

const DISCOVERY_KINDS: ReadonlySet<ResearchJob["kind"]> = new Set([
  "discovery_showrooms",
  "discovery_brands",
  "discovery_products",
]);

researchJobsRouter.openapi(
  createRoute({
    method: "post",
    path: "/{id}/intake",
    operationId: "intakeResearchCandidate",
    tags: ["Research Jobs"],
    summary: "Register a discovery candidate into the registry",
    description:
      "Takes one candidate from a completed discovery job's result and inserts " +
      "it into the showroom / brand / product registry, then fires the matching " +
      "enrichment pipeline. The candidate's intakeStatus flips to 'registered' " +
      "(or 'failed') on the job row.",
    request: {
      params: idParamSchema,
      body: {
        content: { "application/json": { schema: IntakeBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Candidate registered.",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              entityId: z.number().int(),
              entityType: z.enum(["showroom", "brand", "product"]),
            }),
          },
        },
      },
      400: {
        description: "Not a discovery job / bad candidate index / missing storeId.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      404: {
        description: "Job (or target store) not found.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      409: {
        description: "Job not complete, or candidate is not intake-able.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      500: {
        description: "Registration failed (candidate marked 'failed').",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { candidateIndex, storeId } = c.req.valid("json");
    const db = drizzle(c.env.DB);

    const [job] = await db
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.id, id))
      .limit(1);
    if (!job) return c.json({ error: "Research job not found" }, 404);

    if (!DISCOVERY_KINDS.has(job.kind)) {
      return c.json({ error: `Intake is only available for discovery jobs (kind is '${job.kind}')` }, 400);
    }
    if (job.status !== "complete") {
      return c.json({ error: `Job is '${job.status}' — intake requires a complete job` }, 409);
    }

    const result = (job.result ?? null) as { candidates?: DiscoveryCandidate[] } | null;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : null;
    const candidate = candidates?.[candidateIndex];
    if (!candidates || !candidate) {
      return c.json({ error: `No candidate at index ${candidateIndex}` }, 400);
    }
    if (candidate.intakeStatus !== "new") {
      return c.json(
        { error: `Candidate is '${candidate.intakeStatus}' — only 'new' candidates can be registered` },
        409,
      );
    }

    /** Persist a mutation of this candidate back onto the job's result JSON. */
    const persistCandidate = async (patch: Partial<DiscoveryCandidate>) => {
      candidates[candidateIndex] = { ...candidate, ...patch };
      await db
        .update(researchJobs)
        .set({ result: { candidates }, updatedAt: new Date() })
        .where(eq(researchJobs.id, id));
    };

    try {
      let entityId: number;
      let entityType: "showroom" | "brand" | "product";

      if (job.kind === "discovery_showrooms") {
        entityType = "showroom";
        entityId = await intakeShowroom(c.env, candidate);
      } else if (job.kind === "discovery_brands") {
        entityType = "brand";

        // Double-check the registry — the cross-check snapshot may be stale.
        const lower = candidate.name.trim().toLowerCase();
        const [existing] = await db
          .select({ id: brands.id, name: brands.name })
          .from(brands)
          .where(sql`lower(${brands.name}) = ${lower}`)
          .limit(1);
        if (existing) {
          await persistCandidate({
            intakeStatus: "existing",
            matchedEntityId: existing.id,
            matchedEntityName: existing.name,
          });
          return c.json({ error: `Brand already exists (#${existing.id} ${existing.name})` }, 409);
        }

        const [inserted] = await db
          .insert(brands)
          .values({ name: candidate.name, websiteUrl: candidate.websiteUrl ?? null })
          .returning({ id: brands.id });
        entityId = inserted.id;

        // Fire-and-forget enrichment + the deep brand-research workflow.
        c.executionCtx.waitUntil(
          enrichNewBrand(c.env, entityId, candidate.name, candidate.summary ?? undefined).then(
            () => undefined,
            (err: unknown) =>
              console.error(`[research-jobs] brand enrichment failed for #${entityId}:`, err),
          ),
        );
        try {
          await c.env.BRAND_RESEARCH_WORKFLOW.create({ params: { brandId: entityId } });
        } catch (err) {
          console.error(`[research-jobs] brand workflow dispatch failed for #${entityId}:`, err);
        }
      } else {
        entityType = "product";
        if (!storeId) {
          return c.json({ error: "storeId is required to intake a product candidate" }, 400);
        }
        const [store] = await db
          .select({ id: showroomStores.id })
          .from(showroomStores)
          .where(eq(showroomStores.id, storeId))
          .limit(1);
        if (!store) return c.json({ error: "Target showroom not found" }, 404);

        // Resolve/create the candidate's brand, if it names one.
        let brandId: number | null = null;
        if (candidate.brand) {
          const lower = candidate.brand.trim().toLowerCase();
          const [existingBrand] = await db
            .select({ id: brands.id })
            .from(brands)
            .where(sql`lower(${brands.name}) = ${lower}`)
            .limit(1);
          if (existingBrand) {
            brandId = existingBrand.id;
          } else {
            const [newBrand] = await db
              .insert(brands)
              .values({ name: candidate.brand, websiteUrl: null })
              .returning({ id: brands.id });
            brandId = newBrand.id;
            const createdBrandId = newBrand.id;
            const brandName = candidate.brand;
            c.executionCtx.waitUntil(
              enrichNewBrand(c.env, createdBrandId, brandName).then(
                () => undefined,
                (err: unknown) =>
                  console.error(
                    `[research-jobs] brand enrichment failed for #${createdBrandId}:`,
                    err,
                  ),
              ),
            );
          }
        }

        // Products are global (no owning store) — insert the row, then
        // upsert a showroom_product_mappings link to the target showroom.
        const [product] = await db
          .insert(showroomStoreProducts)
          .values({
            itemName: candidate.name,
            description: candidate.summary ?? null,
            productType: candidate.category ?? null,
            brandId,
          })
          .returning({ id: showroomStoreProducts.id });
        entityId = product.id;

        await db
          .insert(showroomProductMappings)
          .values({ showroomId: storeId, productId: product.id })
          .onConflictDoNothing();

        try {
          await c.env.PRODUCT_RESEARCH_WORKFLOW.create({
            params: { storeProductId: entityId },
          });
        } catch (err) {
          console.error(`[research-jobs] product workflow dispatch failed for #${entityId}:`, err);
        }
      }

      await persistCandidate({ intakeStatus: "registered", intakeEntityId: entityId });
      return c.json({ success: true, entityId, entityType }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[research-jobs] intake failed for job ${id} candidate ${candidateIndex}:`, err);
      try {
        await persistCandidate({ intakeStatus: "failed" });
      } catch (persistErr) {
        console.error(`[research-jobs] failed to persist intake failure:`, persistErr);
      }
      return c.json({ error: message }, 500);
    }
  },
);

// ─── Showroom candidate intake ───────────────────────────────────────────────

/**
 * Insert a showroom row for a discovery candidate. Attempts a Google Places
 * text-search match first (best-effort) — when a place is found AND no
 * existing showroom owns its place_id, the row is created from the richer
 * Places card and the heavy enrichment is enqueued on the agent's durable
 * queue. Otherwise the row is created from the candidate's own fields.
 */
async function intakeShowroom(env: Env, candidate: DiscoveryCandidate): Promise<number> {
  const db = drizzle(env.DB);

  // Best-effort Places match — quota/API failures degrade to candidate fields.
  let match: Awaited<ReturnType<GoogleMapsService["placesTextSearch"]>> = null;
  try {
    const service = new GoogleMapsService(env);
    match = await service.placesTextSearch(
      [candidate.name, candidate.address].filter(Boolean).join(" "),
    );
  } catch (err) {
    console.error(`[research-jobs] places lookup failed for "${candidate.name}":`, err);
  }

  // Only link the place_id when no other showroom already owns it (the unique
  // index would otherwise reject the insert).
  let linkablePlaceId: string | null = null;
  if (match?.placeId) {
    const [conflict] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.placeId, match.placeId))
      .limit(1);
    if (!conflict) linkablePlaceId = match.placeId;
  }

  const [inserted] = await db
    .insert(showroomStores)
    .values(
      linkablePlaceId && match
        ? {
            name: candidate.name,
            websiteUrl: match.websiteUri ?? candidate.websiteUrl ?? null,
            locationAddress: match.formattedAddress ?? candidate.address ?? null,
            placeId: linkablePlaceId,
            phoneNumber: match.nationalPhoneNumber ?? null,
            googleRating: match.rating ?? null,
            userRatingCount: match.userRatingCount ?? null,
          }
        : {
            name: candidate.name,
            websiteUrl: candidate.websiteUrl ?? null,
            locationAddress: candidate.address ?? null,
          },
    )
    .returning({ id: showroomStores.id });
  const showroomId = inserted.id;

  // Best-effort heavy enrichment (Places prefill → Gemini → research → scrape)
  // on the agent's durable queue — requires a confirmed place_id.
  if (linkablePlaceId) {
    try {
      const agent = await getShowroomResearchAgent(env);
      await agent.enqueueBackfill([{ showroomId, placeId: linkablePlaceId }]);
    } catch (err) {
      console.error(`[research-jobs] backfill enqueue failed for showroom #${showroomId}:`, err);
    }
  }

  return showroomId;
}
