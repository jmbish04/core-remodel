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
import { authRouter } from "./routes/auth";
import { artifactsRouter } from "./routes/artifacts";
import { budgetTrackerRouter } from "./routes/budget-tracker";
import { csvRouter } from "./routes/csv-ingestion";
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
import { moodBoardsRouter } from "./routes/moodboards";
import { notificationsRouter } from "./routes/notifications";
import { openapiRouter } from "./routes/openapi";
import { photoEditsRouter } from "./routes/photo-edits";
import { photoReviewsRouter } from "./routes/photo-reviews";
import { portalRouter } from "./routes/portal";
import { roomsRouter } from "./routes/rooms";
import { syncRouter } from "./routes/sync";
import { threadsRouter } from "./routes/threads";
import { supportingDocumentsRouter } from "./routes/supporting-documents";
import { visionNodesRouter } from "./routes/vision-nodes";
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
app.use("/api/images/upload", requireAccessAuth);

// Health check
app.get("/api/ping", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Mount routers
app.route("/api/auth", authRouter);
app.route("/api/access", accessRouter);
app.route("/api/admin", adminRouter);
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
app.route("/api/photo-edits", photoEditsRouter);
app.route("/api/portal", portalRouter);
app.route("/api/rooms", roomsRouter);
app.route("/api/estimate-statuses", estimateStatusesRouter);
app.route("/api/estimate-companies", estimateCompaniesRouter);
app.route("/api/estimate-contacts", estimateContactsRouter);
app.route("/api/estimates", estimatesRouter);
app.route("/api/contracts", contractsRouter);
app.route("/api/budget-tracker", budgetTrackerRouter);
app.route("/api/budget-tracker", csvRouter);
app.route("/api/sync", syncRouter);
app.route("/api/artifacts", artifactsRouter);
app.route("/api/supporting-documents", supportingDocumentsRouter);
app.route("/api/vision-nodes", visionNodesRouter);
app.route("/", openapiRouter);

export { app };
