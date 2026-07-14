/**
 * @fileoverview Tesla / Tessie API surface for Showroom Drive Lists.
 *
 * Mounted at `/api/tesla`. Three routes:
 *
 *   GET  /status            (admin)  — is Tessie configured? drives whether the
 *                                      frontend shows the "Send to Tesla" button.
 *   POST /navigate          (admin)  — push a destination to the car's nav.
 *                                      Body: { slug, stopId } (looks up the
 *                                      stop's address/coords) OR a raw
 *                                      { destination } / { lat, lng }.
 *   POST /webhook           (secret) — Tessie park webhook. On a stop, marks the
 *                                      nearest active-drive stop visited and
 *                                      auto-navigates to the next one.
 *
 * `/status` and `/navigate` require the admin cookie/bearer; `/webhook` can't
 * carry that (it's called by Tessie), so it's gated by `TESLA_WEBHOOK_SECRET`
 * instead (see `verifyWebhookSecret`).
 */
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { matchAndMarkVisited } from "@backend/services/drive-geo-match";
import {
  getLocation,
  sendNavigation,
  tessieConfigured,
  verifyWebhookSecret,
} from "@backend/services/tesla";
import { isRequestAuthenticated } from "@backend/utils/access";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const teslaRouter = new Hono<{ Bindings: Env }>();

/** Admin gate for everything EXCEPT the secret-verified webhook. */
teslaRouter.use("*", async (c, next) => {
  if (c.req.path.endsWith("/webhook")) return next();
  if (!(await isRequestAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** GET /api/tesla/status — whether the Tessie integration is usable. */
teslaRouter.get("/status", async (c) => {
  return c.json({ configured: await tessieConfigured(c.env) });
});

/**
 * POST /api/tesla/navigate — hand a destination to the car.
 *
 * Prefers an explicit `{ destination }` or `{ lat, lng }`; otherwise resolves
 * the address/coords from a `{ slug, stopId }` on a drive.
 */
teslaRouter.post("/navigate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    slug?: string;
    stopId?: number;
    destination?: string;
    lat?: number;
    lng?: number;
  };

  let dest: string | null = null;

  if (typeof body.lat === "number" && typeof body.lng === "number") {
    dest = `${body.lat},${body.lng}`;
  } else if (typeof body.destination === "string" && body.destination.trim()) {
    dest = body.destination.trim();
  } else if (body.slug && typeof body.stopId === "number") {
    const db = drizzle(c.env.DB);
    const [stop] = await db
      .select({
        address: driveListStops.address,
        name: driveListStops.name,
        city: driveListStops.city,
        lat: driveListStops.latitude,
        lng: driveListStops.longitude,
        driveListId: driveListStops.driveListId,
        sLat: showroomStores.latitude,
        sLng: showroomStores.longitude,
      })
      .from(driveListStops)
      .innerJoin(driveLists, eq(driveListStops.driveListId, driveLists.id))
      .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
      .where(eq(driveListStops.id, body.stopId))
      .limit(1);
    if (!stop || stop.driveListId == null) return c.json({ error: "Stop not found" }, 404);
    // Prefer precise coords (stop, else showroom); fall back to the address text.
    const lat = stop.lat ?? stop.sLat;
    const lng = stop.lng ?? stop.sLng;
    dest =
      lat != null && lng != null
        ? `${lat},${lng}`
        : (stop.address ?? `${stop.name} ${stop.city ?? ""}`.trim());
  }

  if (!dest) {
    return c.json({ error: "Provide { destination } or { lat, lng } or { slug, stopId }." }, 400);
  }

  const result = await sendNavigation(c.env, dest);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 502);
  return c.json({ ok: true, destination: dest });
});

/**
 * POST /api/tesla/webhook — Tessie park webhook.
 *
 * Gated by `TESLA_WEBHOOK_SECRET` (header `X-Webhook-Secret` or `?secret=`).
 * Uses the coordinate in the payload if present, else queries the car's current
 * location, matches it to the nearest unvisited active-drive stop, marks it
 * visited, and (if there's a next stop) auto-navigates the car to it.
 *
 * Tessie webhook payloads vary by firmware/event, so coordinate extraction is
 * intentionally forgiving.
 */
teslaRouter.post("/webhook", async (c) => {
  if (!(await verifyWebhookSecret(c.req.raw, c.env))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // Try to read a coordinate straight from the webhook body (several shapes),
  // else fall back to a live location query.
  const coord = extractCoord(payload) ?? (await getLocation(c.env));
  if (!coord) {
    return c.json({ ok: true, matched: null, reason: "no-location" });
  }

  const db = drizzle(c.env.DB);
  const result = await matchAndMarkVisited(db, { lat: coord.latitude, lng: coord.longitude });
  if (!result.matched) {
    return c.json({ ok: true, matched: null, reason: "no-stop-nearby" });
  }

  // Auto-advance: send the car to the next unvisited stop, if any.
  let navigatedTo: string | null = null;
  if (result.next) {
    const dest = `${result.next.lat},${result.next.lng}`;
    const nav = await sendNavigation(c.env, dest);
    if (nav.ok) navigatedTo = result.next.name;
  }

  return c.json({
    ok: true,
    matched: { id: result.matched.id, name: result.matched.name, distanceM: result.matched.distanceM },
    navigatedTo,
  });
});

/**
 * Pull `{latitude, longitude}` out of a loosely-typed webhook payload. Handles
 * the common Tessie shapes: top-level `latitude`/`longitude`, a nested
 * `drive_state`, or a `location` object.
 */
function extractCoord(payload: Record<string, unknown>): { latitude: number; longitude: number } | null {
  const candidates: unknown[] = [
    payload,
    payload.drive_state,
    payload.location,
    (payload.data as Record<string, unknown> | undefined)?.drive_state,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const lat = obj.latitude ?? obj.lat;
    const lng = obj.longitude ?? obj.lng ?? obj.long;
    if (typeof lat === "number" && typeof lng === "number") return { latitude: lat, longitude: lng };
  }
  return null;
}

export default teslaRouter;
