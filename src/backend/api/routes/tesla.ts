/**
 * @fileoverview Tesla / Tessie API surface for Showroom Drive Lists.
 *
 * Mounted at `/api/tesla`. Routes:
 *
 *   GET  /status            (admin)  — is Tessie configured? drives whether the
 *                                      frontend shows the "Send to Tesla" button.
 *   POST /navigate          (admin)  — push a destination to the car's nav.
 *                                      Body: { slug, stopId } (looks up the
 *                                      stop's address/coords) OR a raw
 *                                      { destination } / { lat, lng }.
 *   POST /webhook           (secret) — Tessie webhook (drive-state/park). Persists
 *                                      the event to TESLA_DB, marks the nearest
 *                                      active-drive stop visited, auto-navigates
 *                                      to the next one, and runs the automation
 *                                      hook.
 *   POST /telemetry         (secret) — Tessie hosted Fleet Telemetry sink (~500ms
 *                                      frames). Persists each frame to TESLA_DB
 *                                      and runs the automation hook.
 *
 * `/status` and `/navigate` require the admin cookie/bearer. `/webhook` and
 * `/telemetry` are called by Tessie (no admin cookie), so they're gated by the
 * shared `WORKER_API_KEY` instead (see `verifyWebhookSecret`). Event rows land in
 * the dedicated `TESLA_DB` D1, separate from the app DB read for drive matching.
 */
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { teslaTelemetryEvents, teslaWebhookEvents } from "@backend/db/schema/tesla";
import { matchAndMarkVisited } from "@backend/services/drive-geo-match";
import {
  maybeEndActiveDriveOnHomeArrival,
  type HomeArrivalResult,
} from "@backend/services/drive-home-arrival";
import {
  getLocation,
  sendNavigation,
  tessieConfigured,
  verifyWebhookSecret,
} from "@backend/services/tesla";
import { extractCoord, extractTelemetryFields } from "@backend/services/tesla/frames";
import {
  getStreamControl,
  isWithinStreamWindow,
  setPollFallbackSeconds,
  setStreamEnabled,
  setStreamWindow,
  shouldPollNow,
  shouldStreamNow,
} from "@backend/services/tesla/gating";
import { getVehicleImageUrl } from "@backend/services/tesla/vehicle-image";
import { evaluateAutomations } from "@backend/services/tesla-automations";
import { telemetryRecordingAllowed } from "@backend/services/tesla-integration";
import { pollVehicleForActiveDrive } from "@backend/services/tesla-poller";
import { isRequestAuthenticated } from "@backend/utils/access";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const teslaRouter = new Hono<{ Bindings: Env }>();

/** Paths Tessie POSTs to — gated by WORKER_API_KEY inside the handler, not the
 * admin cookie. Kept exact so no future nested route silently bypasses admin. */
const SECRET_GATED_PATHS = new Set(["/api/tesla/webhook", "/api/tesla/telemetry"]);

/** Admin gate for everything EXCEPT the secret-verified Tessie endpoints. */
teslaRouter.use("*", async (c, next) => {
  if (SECRET_GATED_PATHS.has(c.req.path)) return next();
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
 * POST /api/tesla/poll — run one vehicle poll now (admin).
 *
 * The same function the per-minute cron calls, exposed so a poll can be forced
 * from the config page or a QC run rather than waiting for the schedule. It
 * self-gates identically: no active drive, or a poll within the throttle
 * window, and it returns the reason instead of calling Tessie.
 */
teslaRouter.post("/poll", async (c) => {
  return c.json(await pollVehicleForActiveDrive(c.env));
});

/**
 * GET /api/tesla/stream/control — the streaming-DO lifecycle control state.
 *
 * Returns the toggle, the daytime window, the poll-fallback cadence, the DO's
 * self-reported connected flag, and the two derived decisions (`shouldStream` /
 * `shouldPoll`) so the drive-list UI can render the toggle + which ingest path
 * is live right now. Admin-gated by the router middleware.
 */
teslaRouter.get("/stream/control", async (c) => {
  const [control, streamNow, pollNow] = await Promise.all([
    getStreamControl(c.env),
    shouldStreamNow(c.env),
    shouldPollNow(c.env),
  ]);
  return c.json({ control, shouldStream: streamNow, shouldPoll: pollNow });
});

/**
 * POST /api/tesla/stream/control — update the lifecycle controls.
 *
 * Body (all optional): `{ enabled, windowStartHour, windowEndHour, pollFallbackSeconds }`.
 * `enabled:false` stands the DO down and hands ingest to the poller while a drive
 * is still active. The window and cadence are validated in the service layer.
 */
teslaRouter.post("/stream/control", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    enabled?: boolean;
    windowStartHour?: number;
    windowEndHour?: number;
    pollFallbackSeconds?: number;
  };
  try {
    if (typeof body.enabled === "boolean") await setStreamEnabled(c.env, body.enabled);
    if (typeof body.windowStartHour === "number" && typeof body.windowEndHour === "number") {
      await setStreamWindow(c.env, body.windowStartHour, body.windowEndHour);
    }
    if (typeof body.pollFallbackSeconds === "number") {
      await setPollFallbackSeconds(c.env, body.pollFallbackSeconds);
    }
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const control = await getStreamControl(c.env);
  return c.json({ ok: true, control });
});

/** Resolve the singleton TeslaStreamDO stub (one instance for the one vehicle). */
function teslaStreamStub(env: Env) {
  return env.TESLA_STREAM.get(env.TESLA_STREAM.idFromName("singleton"));
}

/**
 * POST /api/tesla/stream/start — arm the streaming DO's lifecycle.
 *
 * The DO's own alarm re-checks `shouldStreamNow` before it connects, so calling
 * this outside the window / with no active drive is a safe no-op (it goes dormant).
 * Normally the drive-activation route calls this for you.
 */
teslaRouter.post("/stream/start", async (c) => {
  const res = await teslaStreamStub(c.env).fetch("https://do/start", { method: "POST" });
  return c.json(await res.json(), res.status as ContentfulStatusCode);
});

/** POST /api/tesla/stream/stop — disconnect the socket and stop the DO now. */
teslaRouter.post("/stream/stop", async (c) => {
  const res = await teslaStreamStub(c.env).fetch("https://do/stop", { method: "POST" });
  return c.json(await res.json(), res.status as ContentfulStatusCode);
});

/** GET /api/tesla/stream/status — the DO's live connection state + write budget + breaker. */
teslaRouter.get("/stream/status", async (c) => {
  const res = await teslaStreamStub(c.env).fetch("https://do/status");
  return c.json(await res.json(), res.status as ContentfulStatusCode);
});

/** Format an hour (0–24) as a 12-hour clock label, e.g. 7 → "7:00 AM", 20 → "8:00 PM". */
function to12h(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? "AM" : "PM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp}:00 ${period}`;
}

/**
 * GET /api/tesla/stream/banner — everything the GLOBAL admin telemetry alert needs.
 *
 * The alert shows only when a drive list is active. It reports whether telemetry
 * is live (the DO's heartbeat-backed connected flag), whether the daytime window
 * is open (12-hour label), whether an Enable button should appear (active drive ∧
 * in window ∧ toggle off), and — when telemetry IS live — the compositor image of
 * the actual car. All D1/KV reads, no DO round-trip, so it's cheap on every page.
 */
teslaRouter.get("/stream/banner", async (c) => {
  const db = drizzle(c.env.DB);
  const [active] = await db
    .select({ slug: driveLists.slug, title: driveLists.title })
    .from(driveLists)
    .where(eq(driveLists.isActive, true))
    .limit(1);

  const control = await getStreamControl(c.env);
  const withinWindow = isWithinStreamWindow(new Date(), control);
  const telemetryActive = control.connected;
  const canEnable = Boolean(active) && withinWindow && !control.enabled;
  const vehicleImageUrl = telemetryActive ? await getVehicleImageUrl(c.env).catch(() => null) : null;

  return c.json({
    activeDrive: active ? { slug: active.slug, title: active.title } : null,
    telemetryActive,
    telemetryEnabled: control.enabled,
    withinWindow,
    canEnable,
    windowLabel: `${to12h(control.windowStartHour)}–${to12h(control.windowEndHour)}`,
    vehicleImageUrl,
  });
});

/**
 * POST /api/tesla/webhook — Tessie webhook (drive-state / park / etc.).
 *
 * Gated by `WORKER_API_KEY`. Responds 200 FAST and does the real work in
 * `waitUntil`, because the processing can include a slow `getLocation` call to
 * Tessie and Tessie's own webhook sender times out (~5s) and RETRIES on a slow
 * response — a retry would double-run `matchAndMarkVisited` and skip a stop. To
 * defend against those retries we also dedupe on the event `id` via the `CACHE`
 * KV (5-min TTL) before accepting.
 */
teslaRouter.post("/webhook", async (c) => {
  if (!(await verifyWebhookSecret(c.req.raw, c.env))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // Idempotency: ignore a webhook we've already accepted (Tessie retries).
  const eventId = typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id) : null;
  if (eventId) {
    const key = `tesla-webhook:${eventId}`;
    if (await c.env.CACHE.get(key)) {
      return c.json({ ok: true, reason: "duplicate-event" });
    }
    await c.env.CACHE.put(key, "1", { expirationTtl: 300 });
  }

  // Return immediately; process in the background so a slow getLocation / match
  // / navigate chain never trips Tessie's send timeout.
  c.executionCtx.waitUntil(processWebhookEvent(c.env, payload));
  return c.json({ ok: true, accepted: true });
});

/**
 * Background processing for a webhook event: resolve a coordinate (payload, else
 * a live location query), match+mark the nearest active-drive stop, auto-advance
 * to the next, persist the event to `TESLA_DB`, and run the automation hook.
 * Runs inside `waitUntil` — errors are swallowed (logged) so they can't reject
 * an already-sent response.
 */
async function processWebhookEvent(env: Env, payload: Record<string, unknown>): Promise<void> {
  try {
    const vin = typeof payload.vin === "string" ? payload.vin : null;
    const eventType =
      typeof payload.event_type === "string"
        ? payload.event_type
        : typeof payload.type === "string"
          ? payload.type
          : null;

    const coord = extractCoord(payload) ?? (await getLocation(env));

    // Drive auto-visit runs against the APP DB (drive stops live there).
    let matched: { id: number; name: string; distanceM: number } | null = null;
    let navigatedTo: string | null = null;
    let matchReason = "no-location";
    let homeArrival: HomeArrivalResult | null = null;
    if (coord) {
      const appDb = drizzle(env.DB);
      const result = await matchAndMarkVisited(appDb, { lat: coord.latitude, lng: coord.longitude });
      if (result.matched) {
        matched = {
          id: result.matched.id,
          name: result.matched.name,
          distanceM: result.matched.distanceM,
        };
        matchReason = "matched";
        if (result.next) {
          const nav = await sendNavigation(env, `${result.next.lat},${result.next.lng}`);
          if (nav.ok) navigatedTo = result.next.name;
        }
      } else {
        matchReason = "no-stop-nearby";
      }

      // Home for the day? A PARK at the project address after 15:30 ends the
      // active drive. Deliberately gated on a parked car — driving past the
      // house on the way to the next stop is not arriving home.
      homeArrival = await maybeEndActiveDriveOnHomeArrival(env, {
        latitude: coord.latitude,
        longitude: coord.longitude,
        source: "tesla-webhook",
        stopped: isParkedEvent(eventType, payload),
      });
    }

    await drizzle(env.TESLA_DB)
      .insert(teslaWebhookEvents)
      .values({
        vin,
        eventType,
        latitude: coord?.latitude ?? null,
        longitude: coord?.longitude ?? null,
        matchResult: JSON.stringify({ reason: matchReason, matched, navigatedTo, homeArrival }),
        data: JSON.stringify(payload),
      })
      .run();

    // IFTTT hook (placeholder — returns no actions yet).
    await evaluateAutomations(env, {
      source: "webhook",
      vin,
      eventType,
      latitude: coord?.latitude ?? null,
      longitude: coord?.longitude ?? null,
      raw: payload,
    });
  } catch (e) {
    console.error("tesla webhook processing failed", e);
  }
}

/**
 * POST /api/tesla/telemetry — Tessie hosted Fleet Telemetry sink.
 *
 * Gated by `WORKER_API_KEY`. Tessie forwards Fleet Telemetry frames (~500ms);
 * each POST is persisted as one row in `TESLA_DB` with the common fields hoisted
 * out, then passed through the automation hook. Kept deliberately lightweight —
 * one insert — because of the frame rate.
 *
 * ponytail: we persist EVERY frame by design (the ask was "receive all"). At
 * ~500ms that's ~170k rows/day/vehicle and real D1 write volume. If that becomes
 * a cost/quota problem, add a per-VIN coalesce here (in-memory Map: skip writes
 * within N seconds unless shiftState changes or the car moves >X m) — cuts writes
 * ~95% while keeping state-change fidelity.
 */
teslaRouter.post("/telemetry", async (c) => {
  if (!(await verifyWebhookSecret(c.req.raw, c.env))) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Consent gate (/admin/config/integrations/tesla). Recording requires BOTH a
  // configured integration and the toggle on — an unconfigured integration has
  // no vehicle to attribute frames to, so it can never log. When recording is
  // off we accept the POST (so Tessie doesn't retry) and store nothing, and say
  // which of the two gates stopped it rather than reporting a silent success.
  if (!(await telemetryRecordingAllowed(c.env))) {
    return c.json({
      ok: true,
      recorded: false,
      reason: (await tessieConfigured(c.env)) ? "recording-disabled" : "integration-unconfigured",
    });
  }

  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const f = extractTelemetryFields(payload);

  await drizzle(c.env.TESLA_DB)
    .insert(teslaTelemetryEvents)
    .values({
      vin: f.vin,
      eventTs: f.eventTs,
      latitude: f.latitude,
      longitude: f.longitude,
      speed: f.speed,
      shiftState: f.shiftState,
      batteryLevel: f.batteryLevel,
      odometer: f.odometer,
      data: JSON.stringify(payload),
    })
    .run();

  await evaluateAutomations(c.env, {
    source: "telemetry",
    vin: f.vin,
    latitude: f.latitude,
    longitude: f.longitude,
    speed: f.speed,
    shiftState: f.shiftState,
    batteryLevel: f.batteryLevel,
    raw: payload,
  });

  return c.json({ ok: true, recorded: true });
});

/**
 * Is this webhook a STOPPED-car event? True for an event type mentioning park,
 * or a payload reporting P gear / zero speed. Tessie's event names vary
 * ("parked", "drive_state" with shift_state P), so all three are accepted.
 */
function isParkedEvent(eventType: string | null, payload: Record<string, unknown>): boolean {
  if (eventType && /park/i.test(eventType)) return true;
  for (const c of [payload, payload.drive_state, (payload.data as Record<string, unknown> | undefined)?.drive_state]) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const shift = obj.shift_state ?? obj.shiftState;
    if (typeof shift === "string" && shift.toUpperCase() === "P") return true;
  }
  return false;
}

export default teslaRouter;
