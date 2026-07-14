/**
 * @fileoverview Main Hono API router
 *
 * This file sets up the main Hono application with all API routes and middleware.
 */



import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { aiRouter } from "./routes/ai";
import { accessRouter } from "./routes/access";
import { adminRouter } from "./routes/admin";
import { adminPermitsRouter } from "./routes/admin-permits";
import { adminWorkflowsRouter } from "./routes/admin-workflows";
import { authRouter } from "./routes/auth";
import { artifactsRouter } from "./routes/artifacts";
import { budgetAgentRouter } from "./routes/budget-agent";
import { budgetTrackerRouter } from "./routes/budget-tracker";
import { budgetDataRouter } from "./routes/budget-data";
import { budgetScenariosRouter } from "./routes/budget-scenarios";
import { budgetAssumptionsRouter } from "./routes/budget-assumptions";
import { budgetSnapshotRouter } from "./routes/budget-snapshot";
import { constructionChecklistRouter } from "./routes/construction-checklist";
import { contractsRouter } from "./routes/contracts";
import { dashboardRouter } from "./routes/dashboard";
import { documentsRouter } from "./routes/documents";
import { estimateCompaniesRouter } from "./routes/estimate-companies";
import { estimateContactsRouter } from "./routes/estimate-contacts";
import { estimateStatusesRouter } from "./routes/estimate-statuses";
import { estimatesRouter } from "./routes/estimates";
import { healthRouter } from "./routes/health";
import { imagesRouter } from "./routes/images";
import { listingPhotosRouter } from "./routes/listing-photos";
import { measurementsRouter } from "./routes/measurements";
import { moodBoardsRouter } from "./routes/moodboards";
import { notificationsRouter } from "./routes/notifications";
import { openapiRouter } from "./routes/openapi";
import { photoEditsRouter } from "./routes/photo-edits";
import { photoReviewsRouter } from "./routes/photo-reviews";
import { photoViewerNotesRouter } from "./routes/photo-viewer-notes";
import renderRouter from "./routes/render";
import moodBoardRouter from "./routes/mood-board";
import mcpRouter from "./routes/mcp";
import { portalRouter } from "./routes/portal";
import { planningRouter } from "./routes/planning";
import { planningExtendedRouter } from "./routes/planning-extended";
import { roomsRouter } from "./routes/rooms";
import { roomsExtendedRouter } from "./routes/rooms-extended";
import { syncRouter } from "./routes/sync";
import { threadsRouter } from "./routes/threads";
import { supportingDocumentsRouter } from "./routes/supporting-documents";
import { documentViewsRouter } from "./routes/document-views";
import { visionNodesRouter } from "./routes/vision-nodes";
import { bidPortfoliosRouter } from "./routes/bid-portfolios";
import { bidPortfolioPublicRouter } from "./routes/bid-portfolio-public";
import { analyticsRouter } from "./routes/analytics";
import { researchRouter } from "./routes/research";
import { truthTableRouter } from "./routes/truth-table";
import { shoppingJournalRouter } from "./routes/shopping-journal";
import { adminConfigRouter } from "./routes/admin-config";
import { dialerRouter } from "./routes/dialer";
import { showroomStoresRouter } from "./routes/showroom-stores";
import { showroomProductsRouter } from "./routes/showroom-products";
import { brandsRouter } from "./routes/brands";
import { showroomSeedRouter } from "./routes/showroom-seed";
import { materialsRouter } from "./routes/materials";
import { showroomGapsRouter } from "./routes/showroom-gaps";
import { showroomCatalogRouter } from "./routes/showroom-catalog";
import { showroomScanRouter } from "./routes/showroom-scan";
import { showroomBackfillRouter } from "./routes/showroom-backfill";
import { showroomContactsRouter } from "./routes/showroom-contacts";
import { changelogRouter } from "./routes/changelog";
import { researchJobsRouter } from "./routes/research-jobs";
import { placesRouter } from "./routes/places";
import { adminIntegrationsRouter } from "./routes/admin-integrations";
import { adminPlansRouter } from "./routes/admin-plans";
import { clickupRouter } from "./routes/clickup";
import { companyCrmRouter } from "./routes/company-crm";
import { notesSharedRouter } from "./routes/notes-shared";
import { gmailRouter } from "./routes/gmail";
import { workshopRouter } from "./routes/workshop";
import { requireAccessAuth } from "@backend/utils/access";

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
app.use("/api/admin/*", requireAccessAuth);
// ClickUp task mirror (0009): admin-only — API token + task mutations behind auth.
app.use("/api/clickup", requireAccessAuth);
app.use("/api/clickup/*", requireAccessAuth);
app.use("/api/images/upload", requireAccessAuth);
app.use("/api/images/upload-urls", requireAccessAuth);
app.use("/api/images/inspiration/scoped", requireAccessAuth);
app.use("/api/images/:id/inspiration-category", requireAccessAuth);
app.use("/api/images/:id/suggest-category", requireAccessAuth);
app.use("/api/planning", requireAccessAuth);
app.use("/api/planning/*", requireAccessAuth);
app.use("/api/truth-table", requireAccessAuth);
app.use("/api/truth-table/*", requireAccessAuth);
app.use("/api/budget-tracker", requireAccessAuth);
app.use("/api/budget-tracker/*", requireAccessAuth);
app.use("/api/budget-data", requireAccessAuth);
app.use("/api/budget-data/*", requireAccessAuth);
app.use("/api/shopping-journal", requireAccessAuth);
app.use("/api/shopping-journal/*", requireAccessAuth);
app.use("/api/showroom-stores", requireAccessAuth);
app.use("/api/showroom-stores/*", requireAccessAuth);
app.use("/api/research-jobs", requireAccessAuth);
app.use("/api/research-jobs/*", requireAccessAuth);
app.use("/api/showroom-products", requireAccessAuth);
app.use("/api/showroom-products/*", requireAccessAuth);
app.use("/api/brands", requireAccessAuth);
app.use("/api/brands/*", requireAccessAuth);
app.use("/api/materials", requireAccessAuth);
app.use("/api/materials/*", requireAccessAuth);
app.use("/api/places", requireAccessAuth);
app.use("/api/places/*", requireAccessAuth);
// Company CRM (notes + todos, 0013 roadmap P3-03/P3-04) — admin-only, no public read.
app.use("/api/companies", requireAccessAuth);
app.use("/api/companies/*", requireAccessAuth);
// Shared note-editor utilities (AI title generation) — admin-only.
app.use("/api/notes", requireAccessAuth);
app.use("/api/notes/*", requireAccessAuth);
// Gmail comms hub (0013 roadmap P3-07) — admin-only, sends mail as justin@126colby.com.
app.use("/api/gmail", requireAccessAuth);
app.use("/api/gmail/*", requireAccessAuth);
// AI Photo Design Workshop (0014 Slice 1) — admin-only canvas/piles/clippings/recipes.
app.use("/api/workshop", requireAccessAuth);
app.use("/api/workshop/*", requireAccessAuth);
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
app.route("/api/admin/research", researchRouter);
app.route("/api/admin/dialer", dialerRouter);
app.route("/api/dashboard", dashboardRouter);
app.route("/api/threads", threadsRouter);
app.route("/api/health", healthRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/ai", aiRouter);
app.route("/api/documents", documentsRouter);
app.route("/api/images", imagesRouter);
app.route("/api/moodboards", moodBoardsRouter);
app.route("/api/listing-photos", listingPhotosRouter);
app.route("/api/photo-reviews", photoReviewsRouter);
app.route("/api/images", photoViewerNotesRouter);
app.route("/api/photo-edits", photoEditsRouter);
app.route("/api/render", renderRouter);
app.route("/api/mood-board", moodBoardRouter);
app.route("/api/mcp", mcpRouter);
app.route("/api/portal", portalRouter);
app.route("/api/planning", planningRouter);
app.route("/api/planning", planningExtendedRouter);
// rooms-extended mounts BEFORE roomsRouter so /:roomId/budget-items and
// /code/:roomCode/options-summary take priority over the broader /:id catch-all.
app.route("/api/rooms", roomsExtendedRouter);
app.route("/api/rooms", roomsRouter);
app.route("/api/measurements", measurementsRouter);
app.route("/api/estimate-statuses", estimateStatusesRouter);
app.route("/api/estimate-companies", estimateCompaniesRouter);
app.route("/api/estimate-contacts", estimateContactsRouter);
app.route("/api/estimates", estimatesRouter);
app.route("/api/contracts", contractsRouter);
app.route("/api/construction-checklist", constructionChecklistRouter);
app.route("/api/budget-agent", budgetAgentRouter);
app.route("/api/budget-tracker", budgetTrackerRouter);
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
app.route("/api/brands", brandsRouter);
app.route("/api/showroom-stores", showroomSeedRouter);
app.route("/api/showroom-stores", showroomGapsRouter);
app.route("/api/showroom-stores", showroomCatalogRouter);
app.route("/api/showroom-stores", showroomScanRouter);
app.route("/api/showroom-stores", showroomBackfillRouter);
app.route("/api/showroom-contacts", showroomContactsRouter);
app.route("/api/changelog", changelogRouter);
app.route("/api/research-jobs", researchJobsRouter);
app.route("/api/materials", materialsRouter);
app.route("/api/places", placesRouter);
// adminIntegrationsRouter mounts under /api/admin/integrations — already covered
// by the /api/admin/* requireAccessAuth middleware above.
app.route("/api/admin/integrations", adminIntegrationsRouter);
app.route("/api/admin/plans", adminPlansRouter);
app.route("/api/clickup", clickupRouter);
app.route("/api/companies", companyCrmRouter);
app.route("/api/notes", notesSharedRouter);
app.route("/api/gmail", gmailRouter);
app.route("/api/workshop", workshopRouter);
app.route("/", openapiRouter);

export { app };
