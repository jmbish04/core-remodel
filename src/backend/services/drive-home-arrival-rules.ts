/**
 * @fileoverview The pure half of the "you're home, the drive is over" rule.
 *
 * Kept free of DB/Env imports on purpose so it can be unit-tested with plain
 * node (`scripts/tests/test_home_arrival.mjs`) — the sibling
 * `drive-home-arrival.ts` does the I/O and calls in here for every judgement.
 */

/**
 * How close counts as "at the house" — 500 yards (~457m). If the car is PARKED
 * this near the permit address the driver is at the property, so they are not
 * out visiting showrooms — end the drive and stand telemetry down. Wide enough
 * to cover street parking / the block; the `stopped` (parked) gate is what keeps
 * merely driving past from triggering it.
 */
export const HOME_RADIUS_M = 457;

/**
 * @deprecated The drive no longer waits for a wall-clock cutoff — a car PARKED
 * at the permit address ends the drive at ANY hour (no reason to stream
 * telemetry while parked at the remodel). Kept only for the `/home-location`
 * response's informational field; `homeArrivalReason` no longer reads it.
 */
export const HOME_ARRIVAL_AFTER_MINUTES = 15 * 60 + 30;

/** Great-circle distance in metres. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Minutes since local midnight in America/Los_Angeles for the given instant.
 * The project is in San Francisco and the cutoff is a wall-clock time there, so
 * this must be a real timezone conversion — a UTC offset drifts by an hour
 * across DST and would move the cutoff to 14:30 for half the year.
 */
export function localMinutesInLA(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // Some ICU builds render midnight as "24" — normalize it.
  return (hour % 24) * 60 + minute;
}

/** Why the rule fired, or why it didn't. `"ended"` is the only acting outcome. */
export type HomeArrivalReason =
  | "ended"
  | "no-active-drive"
  | "not-stopped"
  | "not-home"
  | "before-cutoff"
  | "home-unconfigured";

/**
 * The whole decision, given facts the caller has already gathered. Ordered
 * cheapest-first so the caller can skip the geocode lookup when an earlier gate
 * already fails — pass `distanceM: null` for "not looked up yet" and the result
 * will be `home-unconfigured` only after the other gates have passed.
 */
export function homeArrivalReason(facts: {
  hasActiveDrive: boolean;
  stopped: boolean;
  at: Date;
  distanceM: number | null;
}): HomeArrivalReason {
  if (!facts.hasActiveDrive) return "no-active-drive";
  if (!facts.stopped) return "not-stopped";
  // No wall-clock cutoff: parked at the permit address ends the drive at any
  // hour. `facts.at` is retained for callers/telemetry but no longer gates here.
  if (facts.distanceM == null) return "home-unconfigured";
  return facts.distanceM <= HOME_RADIUS_M ? "ended" : "not-home";
}
