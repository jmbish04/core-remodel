/**
 * @fileoverview Vehicle polling — because Tessie does not push.
 *
 * The drive automation was built around `POST /api/tesla/webhook`: Tessie would
 * announce a park event, we'd check off the nearest stop and decide whether the
 * driver had gone home. That webhook never fires, because **Tessie has no
 * webhook product**. Its Fleet Telemetry access is a WebSocket the CLIENT dials
 * (`streaming.tessie.com/{VIN}`), and its REST API is pull-only. The sinks sat
 * there collecting nothing — 0 rows, ever — while the UI reported a healthy,
 * configured integration.
 *
 * So we pull. Once a couple of minutes, `GET /{vin}/state?use_cache=true` (the
 * cached read, which per Tessie's docs does not affect vehicle sleep) gives the
 * gear and a position — everything the park-event handler needed.
 *
 * Three things keep this from becoming a background cost sink:
 *
 *   1. **It only runs while a drive is active.** No active drive → one indexed
 *      D1 read and out. The single-active invariant makes that check cheap and
 *      unambiguous.
 *   2. **It throttles through KV**, so the per-minute master tick doesn't turn
 *      into 1,440 Tessie calls a day.
 *   3. **It never wakes the car.** Cached reads only.
 *
 * Each poll that does happen is recorded in `tesla_webhook_events` with
 * `event_type = "poll"`, so the drive history and the integration health screen
 * have the same shape of evidence they were always meant to have.
 */
import { teslaWebhookEvents } from "@backend/db/schema/tesla";
import { matchAndMarkVisited } from "@backend/services/drive-geo-match";
import { maybeEndActiveDriveOnHomeArrival } from "@backend/services/drive-home-arrival";
import { getActiveDriveSlug } from "@backend/services/drive-lists";
import { getVehicleState, sendNavigation, tessieConfigured } from "@backend/services/tesla";
import { getStreamControl, isWithinStreamWindow } from "@backend/services/tesla/gating";
import { drizzle } from "drizzle-orm/d1";

/** KV key holding the last poll timestamp, used as the throttle. */
const THROTTLE_KEY = "tesla-poll:last";

/** Minimum gap between two Tessie reads. */
export const POLL_INTERVAL_SECONDS = 120;

export interface PollResult {
  polled: boolean;
  /** Why a poll was skipped, when it was. */
  reason?: "no-active-drive" | "unconfigured" | "throttled" | "no-state" | "stream-active";
  shiftState?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Stop checked off by this poll, if any. */
  matchedStop?: { id: number; name: string; distanceM: number } | null;
  /** Next stop the car was sent to, if any. */
  navigatedTo?: string | null;
  /** Home-arrival verdict for this position. */
  homeArrival?: { ended: boolean; reason: string } | null;
}

/**
 * One tick of vehicle polling. Safe to call every minute — it decides for
 * itself whether there is anything worth asking Tessie about.
 */
export async function pollVehicleForActiveDrive(env: Env): Promise<PollResult> {
  const db = drizzle(env.DB);

  // Gate 1: is a drive even running? This is the cheap one, so it goes first.
  const activeSlug = await getActiveDriveSlug(db);
  if (!activeSlug) return { polled: false, reason: "no-active-drive" };

  if (!(await tessieConfigured(env))) return { polled: false, reason: "unconfigured" };

  // Gate 1b: the poller is the FALLBACK ingest path. When the streaming DO is
  // carrying the load (toggle on, socket connected, inside the daytime window)
  // it stands down so the two paths never double-process the same drive. The
  // configured cadence also becomes the throttle interval below.
  //
  // A failure reading stream-control must NOT take the fallback down — default to
  // "stream not carrying" and the built-in cadence so ingest keeps flowing.
  let streamCarrying = false;
  let throttleTtl = POLL_INTERVAL_SECONDS;
  try {
    const control = await getStreamControl(env);
    streamCarrying =
      control.enabled && control.connected && isWithinStreamWindow(new Date(), control);
    throttleTtl = control.pollFallbackSeconds;
  } catch (err) {
    console.error("[tesla-poller] stream-control read failed; using default cadence:", err);
  }
  if (streamCarrying) return { polled: false, reason: "stream-active" };

  // Gate 2: throttle. KV TTL is the clock — a present key means "polled
  // recently", so no timestamp arithmetic and no clock skew to reason about.
  // Cloudflare KV rejects a TTL below 60s, so floor it (the config setter already
  // enforces this, but a hand-edited row must not throw here).
  if (await env.CACHE.get(THROTTLE_KEY)) return { polled: false, reason: "throttled" };
  await env.CACHE.put(THROTTLE_KEY, "1", { expirationTtl: Math.max(throttleTtl, 60) });

  const state = await getVehicleState(env);
  if (!state || state.latitude == null || state.longitude == null) {
    return { polled: true, reason: "no-state" };
  }

  const coord = { lat: state.latitude, lng: state.longitude };

  // Parked, per the gear — falling back to "reporting no speed" for a firmware
  // that leaves shift_state null while asleep at a stop.
  const parked =
    state.shiftState === "P" ||
    (state.shiftState == null && (state.speed == null || state.speed === 0));

  let matchedStop: PollResult["matchedStop"] = null;
  let navigatedTo: string | null = null;
  if (parked) {
    const match = await matchAndMarkVisited(db, coord);
    if (match.matched) {
      matchedStop = {
        id: match.matched.id,
        name: match.matched.name,
        distanceM: match.matched.distanceM,
      };
      if (match.next) {
        const nav = await sendNavigation(env, `${match.next.lat},${match.next.lng}`);
        if (nav.ok) navigatedTo = match.next.name;
      }
    }
  }

  const homeArrival = await maybeEndActiveDriveOnHomeArrival(env, {
    latitude: coord.lat,
    longitude: coord.lng,
    source: "tesla-webhook",
    stopped: parked,
  });

  // Record the poll like any other vehicle event, so the drive history and the
  // health screen see the same evidence a webhook would have produced.
  await drizzle(env.TESLA_DB)
    .insert(teslaWebhookEvents)
    .values({
      vin: null,
      eventType: "poll",
      latitude: coord.lat,
      longitude: coord.lng,
      matchResult: JSON.stringify({
        reason: matchedStop ? "matched" : "no-stop-nearby",
        matched: matchedStop,
        navigatedTo,
        homeArrival,
        shiftState: state.shiftState,
        parked,
      }),
      data: JSON.stringify({ source: "poll", drive: activeSlug, state }),
    })
    .run();

  return {
    polled: true,
    shiftState: state.shiftState,
    latitude: coord.lat,
    longitude: coord.lng,
    matchedStop,
    navigatedTo,
    homeArrival: { ended: homeArrival.ended, reason: homeArrival.reason },
  };
}
