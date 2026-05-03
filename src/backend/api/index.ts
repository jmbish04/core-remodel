/**
 * @fileoverview Main Hono API router
 *
 * This file sets up the main Hono application with all API routes and middleware.
 */



import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { aiRouter } from "./routes/ai";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { documentsRouter } from "./routes/documents";
import { healthRouter } from "./routes/health";
import { imagesRouter } from "./routes/images";
import { listingPhotosRouter } from "./routes/listing-photos";
import { moodBoardsRouter } from "./routes/moodboards";
import { notificationsRouter } from "./routes/notifications";
import { openapiRouter } from "./routes/openapi";
import { photoReviewsRouter } from "./routes/photo-reviews";
import { threadsRouter } from "./routes/threads";

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

// Health check
app.get("/api/ping", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Mount routers
app.route("/api/auth", authRouter);
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
app.route("/", openapiRouter);

export { app };
