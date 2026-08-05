/**
 * @fileoverview Main Hono API router
 *
 * This file sets up the main Hono application with all API routes and middleware.
 */

import { requireAccessAuth } from "@backend/utils/access";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { accessRouter } from "./routes/access";
import { adminRouter } from "./routes/admin";
import { adminAgentsRouter } from "./routes/admin-agents";
import { adminConfigRouter } from "./routes/admin-config";
import { adminIntegrationsRouter } from "./routes/admin-integrations";
import { adminPermitsRouter } from "./routes/admin-permits";
import { adminPlansRouter } from "./routes/admin-plans";
import { adminPropertiesRouter } from "./routes/admin-properties";
import { adminWorkflowsRouter } from "./routes/admin-workflows";
import { aiRouter } from "./routes/ai";
import { alertsRouter } from "./routes/alerts";
import { analyticsRouter } from "./routes/analytics";
import { artifactsRouter } from "./routes/artifacts";
import { authRouter } from "./routes/auth";
import { bidPortfolioPublicRouter } from "./routes/bid-portfolio-public";
import { bidPortfoliosRouter } from "./routes/bid-portfolios";
import { brandsRouter } from "./routes/brands";
import { budgetAgentRouter } from "./routes/budget-agent";
import { budgetAssumptionsRouter } from "./routes/budget-assumptions";
import { budgetDataRouter } from "./routes/budget-data";
import { budgetGridRouter } from "./routes/budget-grid";
import { budgetScenariosRouter } from "./routes/budget-scenarios";
import { budgetSnapshotRouter } from "./routes/budget-snapshot";
import { budgetTrackerRouter } from "./routes/budget-tracker";
import { changelogRouter } from "./routes/changelog";
import { clickupRouter } from "./routes/clickup";
import { companyCrmRouter } from "./routes/company-crm";
import { configRouter } from "./routes/config";
import { configTaxRouter } from "./routes/config-tax";
import { constructionChecklistRouter } from "./routes/construction-checklist";
import { contractsRouter } from "./routes/contracts";
import { dashboardRouter } from "./routes/dashboard";
import { dialerRouter } from "./routes/dialer";
import { documentViewsRouter } from "./routes/document-views";
import { documentsRouter } from "./routes/documents";
import driveListsRouter from "./routes/drive-lists";
import { estimateCompaniesRouter } from "./routes/estimate-companies";
import { estimateContactsRouter } from "./routes/estimate-contacts";
import { estimateStatusesRouter } from "./routes/estimate-statuses";
import { estimatesRouter } from "./routes/estimates";
import { floorplanRegionsRouter } from "./routes/floorplan-regions";
import { gmailRouter } from "./routes/gmail";
import { googlePhotosRouter } from "./routes/google-photos";
import { guestRouter } from "./routes/guest";
import { healthRouter } from "./routes/health";
import { imagesRouter } from "./routes/images";
import { intakeRouter } from "./routes/intake";
import { listingPhotosRouter } from "./routes/listing-photos";
import { materialsRouter } from "./routes/materials";
import mcpRouter from "./routes/mcp";
import mcpCatalogRouter from "./routes/mcp-catalog";
import mcpOpsRouter from "./routes/mcp-ops";
import { measurementsRouter } from "./routes/measurements";
import moodBoardRouter from "./routes/mood-board";
import { moodBoardsRouter } from "./routes/moodboards";
import { notesSharedRouter } from "./routes/notes-shared";
import { notificationsRouter } from "./routes/notifications";
import { openapiRouter } from "./routes/openapi";
import pascalRouter from "./routes/pascal";
import { PASCAL_API_MOUNT_PATH } from "./routes/pascal-paths";
import { photoEditsRouter } from "./routes/photo-edits";
import { photoReviewsRouter } from "./routes/photo-reviews";
import { photoViewerNotesRouter } from "./routes/photo-viewer-notes";
import { placesRouter } from "./routes/places";
import { planningRouter } from "./routes/planning";
import { planningExtendedRouter } from "./routes/planning-extended";
import { pmoRouter } from "./routes/pmo";
import { portalRouter } from "./routes/portal";
import { productPhotosRouter } from "./routes/product-photos";
import { productsCatalogRouter } from "./routes/products-catalog";
import renderRouter from "./routes/render";
import { researchRouter } from "./routes/research";
import { researchJobsRouter } from "./routes/research-jobs";
import { roomsRouter } from "./routes/rooms";
import { roomsExtendedRouter } from "./routes/rooms-extended";
import { servicesRouter } from "./routes/services";
import { shoppingJournalRouter } from "./routes/shopping-journal";
import { showroomBackfillRouter } from "./routes/showroom-backfill";
import { showroomCatalogRouter } from "./routes/showroom-catalog";
import { showroomContactsRouter } from "./routes/showroom-contacts";
import showroomExclusionsRouter from "./routes/showroom-exclusions";
import { showroomGapsRouter } from "./routes/showroom-gaps";
import showroomHitlQueueRouter from "./routes/showroom-hitl-queue";
import { showroomProductsRouter } from "./routes/showroom-products";
import { showroomSalesRouter } from "./routes/showroom-sales";
import { showroomScanRouter } from "./routes/showroom-scan";
import { showroomScoutRouter } from "./routes/showroom-scout";
import showroomSearchesRouter from "./routes/showroom-searches";
import { showroomSeedRouter } from "./routes/showroom-seed";
import { showroomStoresRouter } from "./routes/showroom-stores";
import showroomVisitLogsRouter from "./routes/showroom-visit-logs";
import studioRouter from "./routes/studio";
import { supportingDocumentsRouter } from "./routes/supporting-documents";
import { syncRouter } from "./routes/sync";
import { systemHealthRouter } from "./routes/system-health";
import { systemObservabilityRouter } from "./routes/system-observability";
import teslaRouter from "./routes/tesla";
import { threadsRouter } from "./routes/threads";
import { truthTableRouter } from "./routes/truth-table";
import { visionNodesRouter } from "./routes/vision-nodes";
import { wishlistRouter } from "./routes/wishlist";
import { workerEmailsRouter } from "./routes/worker-emails";
import { workshopRouter } from "./routes/workshop";

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
// text default).
app.onError((err, c) => {
  console.error("Unhandled API error:", err);
  c.header("Cache-Control", "no-store");
  return c.json({ error: "Internal server error" }, 500);
});
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

// Mount routers
app.route("/api/auth", authRouter);
app.route("/api/access", accessRouter);
app.route("/api/admin", adminRouter);
app.route("/api/admin/permits", adminPermitsRouter);
app.route("/api/admin/workflows", adminWorkflowsRouter);
app.route("/api/admin/config", adminConfigRouter);
app.route("/api/admin/properties", adminPropertiesRouter);
app.route("/api/admin/research", researchRouter);
app.route("/api/admin/dialer", dialerRouter);
app.route("/api/dashboard", dashboardRouter);
app.route("/api/threads", threadsRouter);
app.route("/api/health", healthRouter);
app.route("/api/system/health", systemHealthRouter);
app.route("/api/system", systemObservabilityRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/alerts", alertsRouter);
app.route("/api/ai", aiRouter);
app.route("/api/documents", documentsRouter);
app.route("/api/images", imagesRouter);
app.route("/api/google-photos", googlePhotosRouter);
app.route("/api/moodboards", moodBoardsRouter);
app.route("/api/listing-photos", listingPhotosRouter);
app.route("/api/photo-reviews", photoReviewsRouter);
app.route("/api/images", photoViewerNotesRouter);
app.route("/api/photo-edits", photoEditsRouter);
app.route("/api/render", renderRouter);
app.route("/api/mood-board", moodBoardRouter);
app.route("/api/mcp", mcpRouter);
// Public MCP tool catalog (no auth) — feeds the /mcp/tools docs page.
app.route("/api/mcp-docs", mcpCatalogRouter);
app.route("/api/mcp-ops", mcpOpsRouter);
app.route("/api/studio", studioRouter);
app.route("/api/drive-lists", driveListsRouter);
app.route("/api/showroom-visit-logs", showroomVisitLogsRouter);
app.route("/api/showroom-hitl-queue", showroomHitlQueueRouter);
app.route("/api/showroom-searches", showroomSearchesRouter);
app.route("/api/showroom-exclusions", showroomExclusionsRouter);
// Tesla/Tessie: /status + /navigate are admin-gated inside the router; /webhook
// is public but secret-verified (Tessie can't send the admin cookie).
app.route("/api/tesla", teslaRouter);
app.route("/api/portal", portalRouter);
app.route("/api/guest", guestRouter);
app.route("/api/planning", planningRouter);
app.route("/api/planning", planningExtendedRouter);
// rooms-extended mounts BEFORE roomsRouter so /:roomId/budget-items and
// /code/:roomCode/options-summary take priority over the broader /:id catch-all.
app.route("/api/rooms", roomsExtendedRouter);
app.route("/api/rooms", roomsRouter);
app.route("/api/floorplan-regions", floorplanRegionsRouter);
app.route(PASCAL_API_MOUNT_PATH, pascalRouter);
app.route("/api/measurements", measurementsRouter);
app.route("/api/estimate-statuses", estimateStatusesRouter);
app.route("/api/estimate-companies", estimateCompaniesRouter);
app.route("/api/estimate-contacts", estimateContactsRouter);
app.route("/api/estimates", estimatesRouter);
app.route("/api/contracts", contractsRouter);
app.route("/api/construction-checklist", constructionChecklistRouter);
app.route("/api/budget-agent", budgetAgentRouter);
app.route("/api/budget-tracker", budgetTrackerRouter);
app.route("/api/budget", budgetGridRouter);
app.route("/api/budget-data", budgetDataRouter);
app.route("/api/budget-scenarios", budgetScenariosRouter);
app.route("/api/budget-assumptions", budgetAssumptionsRouter);
app.route("/api/budget-snapshot", budgetSnapshotRouter);
app.route("/api/sync", syncRouter);
app.route("/api/artifacts", artifactsRouter);
app.route("/api/supporting-documents", supportingDocumentsRouter);
// Mounted at a distinct top-level path (not /api/documents/views) because
// /api/documents is already taken by the unrelated PlateJS notes router
// (documentsRouter, mounted above). Write routes (POST/PATCH/DELETE) are
// individually guarded with requireAccessAuth via each route's `middleware`
// option in document-views.ts; GET routes are intentionally open (mirroring
// supporting-documents' public-read posture) with per-request visibility
// filtering applied inside the handlers.
app.route("/api/document-views", documentViewsRouter);
app.route("/api/vision-nodes", visionNodesRouter);
app.route("/api/bid-portfolios/public", bidPortfolioPublicRouter);
app.route("/api/bid-portfolios", bidPortfoliosRouter);
app.route("/api/analytics", analyticsRouter);
app.route("/api/truth-table", truthTableRouter);
app.route("/api/shopping-journal", shoppingJournalRouter);
app.route("/api/showroom-stores", showroomStoresRouter);
app.route("/api/showroom-products", showroomProductsRouter);
app.route("/api/showroom-sales", showroomSalesRouter);
app.route("/api/config/tax", configTaxRouter);
app.route("/api/showroom-scout", showroomScoutRouter);
app.route("/api/product-photos", productPhotosRouter);
app.route("/api/intake", intakeRouter);
app.route("/api/products", productsCatalogRouter);
app.route("/api/config", configRouter);
app.route("/api/brands", brandsRouter);
app.route("/api/showroom-stores", showroomSeedRouter);
app.route("/api/showroom-stores", showroomGapsRouter);
app.route("/api/showroom-stores", showroomCatalogRouter);
app.route("/api/showroom-stores", showroomScanRouter);
app.route("/api/showroom-stores", showroomBackfillRouter);
app.route("/api/showroom-contacts", showroomContactsRouter);
app.route("/api/research-jobs", researchJobsRouter);
app.route("/api/materials", materialsRouter);
app.route("/api/services", servicesRouter);
app.route("/api/wishlist", wishlistRouter);
// Worker-email HITL inbox API (invoices / contracts / receipts / staged
// companies). Mounting this is what makes /admin/inbox show emails.
app.route("/api/worker-emails", workerEmailsRouter);
app.route("/api/changelog", changelogRouter);
app.route("/api/places", placesRouter);
// adminIntegrationsRouter mounts under /api/admin/integrations — already covered
// by the /api/admin/* requireAccessAuth middleware above.
app.route("/api/admin/integrations", adminIntegrationsRouter);
app.route("/api/admin/plans", adminPlansRouter);
app.route("/api/pmo", pmoRouter);
// Agent Ops — the first readers of the agent_runs ledger. Inherits
// requireAccessAuth from the /api/admin/* middleware registered above.
app.route("/api/admin/agents", adminAgentsRouter);
app.route("/api/clickup", clickupRouter);
app.route("/api/companies", companyCrmRouter);
app.route("/api/notes", notesSharedRouter);
app.route("/api/gmail", gmailRouter);
app.route("/api/workshop", workshopRouter);
app.route("/", openapiRouter);

export { app };
