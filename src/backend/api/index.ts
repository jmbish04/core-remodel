/**
 * @fileoverview Main Hono API router
 *
 * This file sets up the main Hono application with all API routes and middleware.
 *
 * ROUTERS ARE MOUNTED LAZILY, ON PURPOSE. A Worker must parse and execute its
 * global scope inside a 1-second CPU budget; eagerly importing all 109 routers
 * here built 231 module-scope `z.object()` schemas and 116 `createRoute()` calls
 * before a single request was served, and the deploy started failing validation
 * with `Script startup exceeded CPU time limit [code: 10021]`. Measured against
 * the bundle's sourcemap, this module alone accounted for 46.5% of startup CPU
 * samples (zod schema construction plus the garbage collection it provokes).
 *
 * So `MOUNTS` below holds a DYNAMIC `import()` per router instead of a static
 * one. esbuild wraps a module that is only dynamically imported in a lazy
 * `__esm()` initialiser, so its schemas are built on the first request that
 * touches its prefix and never at startup. Keep it that way: a static
 * `import { xRouter } from "./routes/x"` anywhere in this file drags that
 * router — and everything it imports — back onto the startup path.
 *
 * Routing semantics are unchanged. See `lazyDispatcher` for how the 404 sentinel
 * reproduces Hono's fall-through between routers sharing a prefix.
 */

import type { Context, ErrorHandler } from "hono";

import { requireAccessAuth } from "@backend/utils/access";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { PASCAL_API_MOUNT_PATH } from "./routes/pascal-paths";

export type Variables = {
  userId?: number;
  user?: {
    id: number;
    email: string;
    name: string;
  };
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Error responses must never be cached at the edge. A cached 5xx masks an
// incident and keeps serving the failure after a fix deploys — observed on
// GET /api/rooms/catalog, where a 500 stayed cached until its key expired while
// the fix was already live. Stamp `no-store` on every 4xx/5xx that a route
// RETURNS; thrown errors are handled by app.onError below.
app.use("*", async (c, next) => {
  await next();
  if (c.res.status >= 400) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

// A thrown/unhandled error bypasses the middleware above, so guarantee the same
// no-store on the 500 it produces (and give a JSON body instead of Hono's plain
// text default). Shared with every lazily-mounted sub-router, which handles its
// own errors and would otherwise fall back to Hono's plain-text default.
const apiOnError: ErrorHandler<{ Bindings: Env; Variables: Variables }> = (err, c) => {
  console.error("Unhandled API error:", err);
  c.header("Cache-Control", "no-store");
  return c.json({ error: "Internal server error" }, 500);
};
app.onError(apiOnError);
app.use("/api/admin/*", requireAccessAuth);
// ClickUp task mirror (0009): admin-only — API token + task mutations behind auth.
app.use("/api/clickup", requireAccessAuth);
app.use("/api/clickup/*", requireAccessAuth);
app.use("/api/images/upload", requireAccessAuth);
app.use("/api/images/upload-urls", requireAccessAuth);
app.use("/api/images/inspiration/scoped", requireAccessAuth);
app.use("/api/images/:id/inspiration-category", requireAccessAuth);
app.use("/api/images/:id/suggest-category", requireAccessAuth);
app.use("/api/pmo", requireAccessAuth);
app.use("/api/pmo/*", requireAccessAuth);
app.use("/api/planning", requireAccessAuth);
app.use("/api/planning/*", requireAccessAuth);
app.use("/api/truth-table", requireAccessAuth);
app.use("/api/truth-table/*", requireAccessAuth);
app.use("/api/budget-tracker", requireAccessAuth);
app.use("/api/budget-tracker/*", requireAccessAuth);
app.use("/api/budget", requireAccessAuth);
app.use("/api/budget/*", requireAccessAuth);
app.use("/api/budget-data", requireAccessAuth);
app.use("/api/budget-data/*", requireAccessAuth);
app.use("/api/shopping-journal", requireAccessAuth);
app.use("/api/shopping-journal/*", requireAccessAuth);
app.use("/api/showroom-stores", requireAccessAuth);
app.use("/api/showroom-stores/*", requireAccessAuth);
// Google Photos Picker (0019) — admin-only. The OAuth callback is a top-level
// browser redirect from Google that carries the visitor cookie, so it passes
// this same guard.
app.use("/api/google-photos", requireAccessAuth);
app.use("/api/google-photos/*", requireAccessAuth);
app.use("/api/research-jobs", requireAccessAuth);
app.use("/api/research-jobs/*", requireAccessAuth);
app.use("/api/showroom-scout", requireAccessAuth);
app.use("/api/showroom-scout/*", requireAccessAuth);
app.use("/api/showroom-sales", requireAccessAuth);
app.use("/api/showroom-sales/*", requireAccessAuth);
app.use("/api/system", requireAccessAuth);
app.use("/api/system/*", requireAccessAuth);
app.use("/api/system/health", requireAccessAuth);
app.use("/api/system/health/*", requireAccessAuth);
app.use("/api/showroom-products", requireAccessAuth);
app.use("/api/showroom-products/*", requireAccessAuth);
app.use("/api/product-photos", requireAccessAuth);
app.use("/api/product-photos/*", requireAccessAuth);
app.use("/api/intake", requireAccessAuth);
app.use("/api/intake/*", requireAccessAuth);
// Products catalog page (0020 subsystem B) — same admin-only posture as
// showroom-products, which this mirrors.
app.use("/api/products", requireAccessAuth);
app.use("/api/products/*", requireAccessAuth);
// Config-driven vocabularies (0020-C2: categories/subcategories/colors + mappings).
app.use("/api/config", requireAccessAuth);
app.use("/api/config/*", requireAccessAuth);
app.use("/api/brands", requireAccessAuth);
app.use("/api/brands/*", requireAccessAuth);
app.use("/api/materials", requireAccessAuth);
app.use("/api/materials/*", requireAccessAuth);
app.use("/api/services", requireAccessAuth);
app.use("/api/services/*", requireAccessAuth);
app.use("/api/wishlist", requireAccessAuth);
app.use("/api/wishlist/*", requireAccessAuth);
app.use("/api/worker-emails", requireAccessAuth);
app.use("/api/worker-emails/*", requireAccessAuth);
app.use("/api/email", requireAccessAuth);
app.use("/api/email/*", requireAccessAuth);
app.use("/api/places", requireAccessAuth);
app.use("/api/places/*", requireAccessAuth);
// Company CRM (notes + todos, 0013 roadmap P3-03/P3-04) — admin-only, no public read.
app.use("/api/companies", requireAccessAuth);
app.use("/api/companies/*", requireAccessAuth);
// Shared note-editor utilities (AI title generation) — admin-only.
app.use("/api/notes", requireAccessAuth);
app.use("/api/notes/*", requireAccessAuth);
// Feature-proposal bundles. The rest of /api/changelog stays open (it is the
// public release record), but proposals are gated on both sides: the write path
// accepts an arbitrarily large body and puts it into R2, and the read path hands
// back a RAW conversation transcript, which routinely contains material never
// meant to be public.
app.use("/api/changelog/proposals", requireAccessAuth);
app.use("/api/changelog/proposals/*", requireAccessAuth);
// Gmail comms hub (0013 roadmap P3-07) — admin-only, sends mail as justin@126colby.com.
app.use("/api/gmail", requireAccessAuth);
app.use("/api/gmail/*", requireAccessAuth);
// AI Photo Design Workshop (0014 Slice 1) — admin-only canvas/piles/clippings/recipes.
app.use("/api/workshop", requireAccessAuth);
app.use("/api/workshop/*", requireAccessAuth);
app.use("/api/floorplan-regions", requireAccessAuth);
app.use("/api/floorplan-regions/*", requireAccessAuth);
// Pascal scene store (0043) — the editor's server calls these with WORKER_API_KEY.
app.use(PASCAL_API_MOUNT_PATH, requireAccessAuth);
app.use(`${PASCAL_API_MOUNT_PATH}/*`, requireAccessAuth);
app.use("/api/bid-portfolios/*", async (c, next) => {
  // Public routes do not require auth
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/bid-portfolios/public")) {
    return next();
  }
  return requireAccessAuth(c as any, next);
});

// Health check
app.get("/api/ping", (c) => c.json({ status: "ok", timestamp: Date.now() }));

/** Any router mountable under this app — plain Hono or an OpenAPIHono. */
// biome-ignore lint: routers are constructed with varying Env/Variables generics.
type MountableRouter = Hono<any, any, any>;
type RouterLoader = () => Promise<MountableRouter>;
type Mounts = ReadonlyArray<readonly [string, RouterLoader]>;

/**
 * Marks a response as "no router under this prefix claimed the path", so the
 * dispatcher can fall through to the next matching handler instead of ending
 * the request with a 404. It never reaches a client: `lazyDispatcher` consumes
 * the response and calls `next()`, leaving the final 404 to the parent app —
 * which is exactly what eager `app.route()` mounting did.
 */
const LAZY_MISS_HEADER = "x-lazy-mount-miss";

/** Distinct prefixes, in first-declaration order. */
function orderedPrefixes(mounts: Mounts): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [prefix] of mounts) {
    if (!seen.has(prefix)) {
      seen.add(prefix);
      out.push(prefix);
    }
  }
  return out;
}

/** `c.executionCtx` throws when there is no execution context (e.g. in tests). */
function executionCtxOf(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

const loaded = new Map<string, Promise<MountableRouter>>();

/**
 * Loads every router declared at `prefix` and merges them into one Hono — in
 * declaration order, and mounted at the SAME absolute prefix they used before.
 *
 * Mounting at the full prefix, rather than stripping it and dispatching a
 * rewritten request (what Hono's own `mount()` does), is deliberate: handlers
 * see the absolute path exactly as they did under eager `app.route()`. Several
 * read it directly — `routes/artifacts.ts` derives its R2 key with
 * `c.req.path.replace(/^\/api\/artifacts\//, "")` — and a stripped path
 * silently turned that route's 404 into a 400. Do not "optimise" this back
 * into a prefix-stripping rewrite.
 *
 * Cached per isolate, so only the first request to a prefix pays for the import.
 */
function loadPrefix(prefix: string, mounts: Mounts): Promise<MountableRouter> {
  let pending = loaded.get(prefix);
  if (pending) return pending;

  pending = (async () => {
    const routers = await Promise.all(
      mounts.filter(([p]) => p === prefix).map(([, load]) => load()),
    );
    const merged = new Hono<{ Bindings: Env; Variables: Variables }>();
    merged.onError(apiOnError);
    merged.notFound(
      () => new Response(null, { status: 404, headers: { [LAZY_MISS_HEADER]: "1" } }),
    );
    for (const router of routers) {
      merged.route(prefix, router);
    }
    return merged;
  })().catch((err: unknown) => {
    // Evict on failure, or a single transient import error would be cached as a
    // permanently rejected promise and that prefix would 500 for the rest of the
    // isolate's life. The rejection still propagates to this request (the parent
    // app's onError turns it into the usual 500); the next one retries the import.
    loaded.delete(prefix);
    throw err;
  });

  loaded.set(prefix, pending);
  return pending;
}

/**
 * Runs the untouched request against the merged router for `prefix`. A miss
 * falls through to the next matching handler, so nested prefixes (/api/admin,
 * then /api/admin/permits) resolve in declaration order and an unrecognised
 * path ends at the parent app's 404 rather than this group's.
 */
function lazyDispatcher(prefix: string, mounts: Mounts) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: () => Promise<void>) => {
    const router = await loadPrefix(prefix, mounts);
    const res = await router.fetch(c.req.raw, c.env, executionCtxOf(c));
    if (res.status === 404 && res.headers.get(LAZY_MISS_HEADER)) {
      await next();
      return;
    }
    return res;
  };
}

// Mount routers
//
// Declaration order is load-bearing and matches the previous eager
// `app.route(...)` order exactly: where two routers share a prefix (/api/budget
// has five, /api/showroom-stores six) or one prefix nests inside another
// (/api/admin and /api/admin/permits), Hono runs the matching handlers in
// registration order and the first one with a route for the path wins.
const MOUNTS: ReadonlyArray<readonly [string, RouterLoader]> = [
  ["/api/auth", async () => (await import("./routes/auth")).authRouter],
  ["/api/access", async () => (await import("./routes/access")).accessRouter],
  ["/api/admin", async () => (await import("./routes/admin")).adminRouter],
  ["/api/admin/permits", async () => (await import("./routes/admin-permits")).adminPermitsRouter],
  [
    "/api/admin/workflows",
    async () => (await import("./routes/admin-workflows")).adminWorkflowsRouter,
  ],
  ["/api/admin/config", async () => (await import("./routes/admin-config")).adminConfigRouter],
  [
    "/api/admin/drive-auth-probe",
    async () => (await import("./routes/admin-drive-auth-probe")).driveAuthProbeRouter,
  ],
  ["/api/admin/drive", async () => (await import("./routes/admin-drive-ingest")).driveIngestRouter],
  [
    "/api/admin/properties",
    async () => (await import("./routes/admin-properties")).adminPropertiesRouter,
  ],
  ["/api/admin/research", async () => (await import("./routes/research")).researchRouter],
  ["/api/admin/dialer", async () => (await import("./routes/dialer")).dialerRouter],
  ["/api/dashboard", async () => (await import("./routes/dashboard")).dashboardRouter],
  ["/api/threads", async () => (await import("./routes/threads")).threadsRouter],
  ["/api/health", async () => (await import("./routes/health")).healthRouter],
  ["/api/system/health", async () => (await import("./routes/system-health")).systemHealthRouter],
  [
    "/api/system",
    async () => (await import("./routes/system-observability")).systemObservabilityRouter,
  ],
  ["/api/notifications", async () => (await import("./routes/notifications")).notificationsRouter],
  ["/api/alerts", async () => (await import("./routes/alerts")).alertsRouter],
  ["/api/ai", async () => (await import("./routes/ai")).aiRouter],
  ["/api/documents", async () => (await import("./routes/documents")).documentsRouter],
  ["/api/images", async () => (await import("./routes/images")).imagesRouter],
  ["/api/google-photos", async () => (await import("./routes/google-photos")).googlePhotosRouter],
  ["/api/moodboards", async () => (await import("./routes/moodboards")).moodBoardsRouter],
  [
    "/api/listing-photos",
    async () => (await import("./routes/listing-photos")).listingPhotosRouter,
  ],
  ["/api/photo-reviews", async () => (await import("./routes/photo-reviews")).photoReviewsRouter],
  ["/api/images", async () => (await import("./routes/photo-viewer-notes")).photoViewerNotesRouter],
  ["/api/photo-edits", async () => (await import("./routes/photo-edits")).photoEditsRouter],
  ["/api/render", async () => (await import("./routes/render")).default],
  ["/api/mood-board", async () => (await import("./routes/mood-board")).default],
  ["/api/mcp", async () => (await import("./routes/mcp")).default],
  // Public MCP tool catalog (no auth) — feeds the /mcp/tools docs page.
  ["/api/mcp-docs", async () => (await import("./routes/mcp-catalog")).default],
  ["/api/mcp-ops", async () => (await import("./routes/mcp-ops")).default],
  ["/api/studio", async () => (await import("./routes/studio")).default],
  ["/api/drive-lists", async () => (await import("./routes/drive-lists")).default],
  ["/api/showroom-visit-logs", async () => (await import("./routes/showroom-visit-logs")).default],
  ["/api/showroom-hitl-queue", async () => (await import("./routes/showroom-hitl-queue")).default],
  ["/api/showroom-searches", async () => (await import("./routes/showroom-searches")).default],
  ["/api/showroom-exclusions", async () => (await import("./routes/showroom-exclusions")).default],
  // Tesla/Tessie: /status + /navigate are admin-gated inside the router; /webhook
  // is public but secret-verified (Tessie can't send the admin cookie).
  ["/api/tesla", async () => (await import("./routes/tesla")).default],
  ["/api/portal", async () => (await import("./routes/portal")).portalRouter],
  ["/api/guest", async () => (await import("./routes/guest")).guestRouter],
  ["/api/planning", async () => (await import("./routes/planning")).planningRouter],
  [
    "/api/planning",
    async () => (await import("./routes/planning-extended")).planningExtendedRouter,
  ],
  // rooms-extended mounts BEFORE roomsRouter so /:roomId/budget-items and
  // /code/:roomCode/options-summary take priority over the broader /:id catch-all.
  ["/api/rooms", async () => (await import("./routes/rooms-extended")).roomsExtendedRouter],
  ["/api/rooms", async () => (await import("./routes/rooms")).roomsRouter],
  [
    "/api/floorplan-regions",
    async () => (await import("./routes/floorplan-regions")).floorplanRegionsRouter,
  ],
  [PASCAL_API_MOUNT_PATH, async () => (await import("./routes/pascal")).default],
  ["/api/measurements", async () => (await import("./routes/measurements")).measurementsRouter],
  [
    "/api/estimate-statuses",
    async () => (await import("./routes/estimate-statuses")).estimateStatusesRouter,
  ],
  [
    "/api/estimate-companies",
    async () => (await import("./routes/estimate-companies")).estimateCompaniesRouter,
  ],
  [
    "/api/estimate-contacts",
    async () => (await import("./routes/estimate-contacts")).estimateContactsRouter,
  ],
  ["/api/estimates", async () => (await import("./routes/estimates")).estimatesRouter],
  ["/api/contracts", async () => (await import("./routes/contracts")).contractsRouter],
  [
    "/api/construction-checklist",
    async () => (await import("./routes/construction-checklist")).constructionChecklistRouter,
  ],
  ["/api/budget-agent", async () => (await import("./routes/budget-agent")).budgetAgentRouter],
  [
    "/api/budget-tracker",
    async () => (await import("./routes/budget-tracker")).budgetTrackerRouter,
  ],
  ["/api/budget", async () => (await import("./routes/budget-grid")).budgetGridRouter],
  ["/api/budget", async () => (await import("./routes/budget-workbench")).budgetWorkbenchRouter],
  [
    "/api/budget",
    async () => (await import("./routes/budget-reconciliation")).budgetReconciliationRouter,
  ],
  [
    "/api/budget",
    async () => (await import("./routes/budget-reallocations")).budgetReallocationsRouter,
  ],
  ["/api/budget", async () => (await import("./routes/budget-compliance")).budgetComplianceRouter],
  ["/api/budget-data", async () => (await import("./routes/budget-data")).budgetDataRouter],
  [
    "/api/budget-scenarios",
    async () => (await import("./routes/budget-scenarios")).budgetScenariosRouter,
  ],
  [
    "/api/budget-assumptions",
    async () => (await import("./routes/budget-assumptions")).budgetAssumptionsRouter,
  ],
  [
    "/api/budget-snapshot",
    async () => (await import("./routes/budget-snapshot")).budgetSnapshotRouter,
  ],
  ["/api/sync", async () => (await import("./routes/sync")).syncRouter],
  ["/api/artifacts", async () => (await import("./routes/artifacts")).artifactsRouter],
  [
    "/api/supporting-documents",
    async () => (await import("./routes/supporting-documents")).supportingDocumentsRouter,
  ],
  // Mounted at a distinct top-level path (not /api/documents/views) because
  // /api/documents is already taken by the unrelated PlateJS notes router
  // (documentsRouter, mounted above). Write routes (POST/PATCH/DELETE) are
  // individually guarded with requireAccessAuth via each route's `middleware`
  // option in document-views.ts; GET routes are intentionally open (mirroring
  // supporting-documents' public-read posture) with per-request visibility
  // filtering applied inside the handlers.
  [
    "/api/document-views",
    async () => (await import("./routes/document-views")).documentViewsRouter,
  ],
  ["/api/vision-nodes", async () => (await import("./routes/vision-nodes")).visionNodesRouter],
  [
    "/api/bid-portfolios/public",
    async () => (await import("./routes/bid-portfolio-public")).bidPortfolioPublicRouter,
  ],
  [
    "/api/bid-portfolios",
    async () => (await import("./routes/bid-portfolios")).bidPortfoliosRouter,
  ],
  ["/api/analytics", async () => (await import("./routes/analytics")).analyticsRouter],
  ["/api/truth-table", async () => (await import("./routes/truth-table")).truthTableRouter],
  [
    "/api/shopping-journal",
    async () => (await import("./routes/shopping-journal")).shoppingJournalRouter,
  ],
  [
    "/api/showroom-stores",
    async () => (await import("./routes/showroom-stores")).showroomStoresRouter,
  ],
  [
    "/api/showroom-products",
    async () => (await import("./routes/showroom-products")).showroomProductsRouter,
  ],
  [
    "/api/showroom-sales",
    async () => (await import("./routes/showroom-sales")).showroomSalesRouter,
  ],
  ["/api/config/tax", async () => (await import("./routes/config-tax")).configTaxRouter],
  [
    "/api/showroom-scout",
    async () => (await import("./routes/showroom-scout")).showroomScoutRouter,
  ],
  [
    "/api/product-photos",
    async () => (await import("./routes/product-photos")).productPhotosRouter,
  ],
  ["/api/intake", async () => (await import("./routes/intake")).intakeRouter],
  ["/api/products", async () => (await import("./routes/products-catalog")).productsCatalogRouter],
  ["/api/config", async () => (await import("./routes/config")).configRouter],
  ["/api/brands", async () => (await import("./routes/brands")).brandsRouter],
  ["/api/showroom-stores", async () => (await import("./routes/showroom-seed")).showroomSeedRouter],
  ["/api/showroom-stores", async () => (await import("./routes/showroom-gaps")).showroomGapsRouter],
  [
    "/api/showroom-stores",
    async () => (await import("./routes/showroom-catalog")).showroomCatalogRouter,
  ],
  ["/api/showroom-stores", async () => (await import("./routes/showroom-scan")).showroomScanRouter],
  [
    "/api/showroom-stores",
    async () => (await import("./routes/showroom-backfill")).showroomBackfillRouter,
  ],
  [
    "/api/showroom-contacts",
    async () => (await import("./routes/showroom-contacts")).showroomContactsRouter,
  ],
  ["/api/research-jobs", async () => (await import("./routes/research-jobs")).researchJobsRouter],
  ["/api/materials", async () => (await import("./routes/materials")).materialsRouter],
  ["/api/services", async () => (await import("./routes/services")).servicesRouter],
  ["/api/wishlist", async () => (await import("./routes/wishlist")).wishlistRouter],
  // Worker-email HITL inbox API (invoices / contracts / receipts / staged
  // companies). Mounting this is what makes /admin/inbox show emails.
  ["/api/worker-emails", async () => (await import("./routes/worker-emails")).workerEmailsRouter],
  ["/api/email", async () => (await import("./routes/email")).emailRouter],
  ["/api/changelog", async () => (await import("./routes/changelog")).changelogRouter],
  ["/api/places", async () => (await import("./routes/places")).placesRouter],
  // adminIntegrationsRouter mounts under /api/admin/integrations — already covered
  // by the /api/admin/* requireAccessAuth middleware above.
  [
    "/api/admin/integrations",
    async () => (await import("./routes/admin-integrations")).adminIntegrationsRouter,
  ],
  ["/api/admin/plans", async () => (await import("./routes/admin-plans")).adminPlansRouter],
  ["/api/pmo", async () => (await import("./routes/pmo")).pmoRouter],
  // Agent Ops — the first readers of the agent_runs ledger. Inherits
  // requireAccessAuth from the /api/admin/* middleware registered above.
  ["/api/admin/agents", async () => (await import("./routes/admin-agents")).adminAgentsRouter],
  ["/api/clickup", async () => (await import("./routes/clickup")).clickupRouter],
  ["/api/companies", async () => (await import("./routes/company-crm")).companyCrmRouter],
  ["/api/notes", async () => (await import("./routes/notes-shared")).notesSharedRouter],
  ["/api/gmail", async () => (await import("./routes/gmail")).gmailRouter],
  ["/api/workshop", async () => (await import("./routes/workshop")).workshopRouter],
];

for (const prefix of orderedPrefixes(MOUNTS)) {
  const dispatch = lazyDispatcher(prefix, MOUNTS);
  // Both forms are needed: `/api/clickup/*` does not match the bare
  // `/api/clickup`, which several routers serve as their `/` route.
  app.all(prefix, dispatch);
  app.all(`${prefix}/*`, dispatch);
}

// The docs router mounts at "/" and would swallow every path as a wildcard, so
// its handful of absolute paths are registered individually. `/docs` is listed
// for parity with the old `app.route("/", openapiRouter)` even though
// `src/_worker.ts` only forwards the other four to this app.
for (const path of ["/openapi.json", "/swagger", "/scalar", "/docs", "/context"] as const) {
  app.get(path, async (c) => {
    const { openapiRouter } = await import("./routes/openapi");
    return openapiRouter.fetch(c.req.raw, c.env, executionCtxOf(c));
  });
}

export { app };
