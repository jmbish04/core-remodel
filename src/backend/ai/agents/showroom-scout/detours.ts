/**
 * @fileoverview Showroom Scout — detour guardrail.
 *
 * `plan_drive_route` computes, for every showroom that missed the main route,
 * the real cost of diverting to it (cheapest-insertion delta) and whether it
 * would be open on arrival. Those are `detourOptions`.
 *
 * The model, however, consistently published `detours: []` even when handed a
 * +0 and +6 minute option — the same "instructions fade" pattern that made
 * publishing itself unreliable. So this is enforced rather than requested:
 * `publish_route` rejects a route that silently drops a cheap, open option.
 *
 * Kept as a separate pure module so it is unit-testable without standing up a
 * Durable Object or making a live model call.
 */

/** A detour worth putting in front of the user. */
export interface OfferableDetour {
  name: string;
  extraMinutes: number;
}

/**
 * Worth offering: a short diversion not known to be closed on arrival.
 *
 * 15 minutes is the line between "while you're out there" and "a different
 * trip". Tuned against live runs, where genuine near-path options came in at
 * +0/+3/+5/+6 min and everything unhelpful was +19 or worse (one was +684 —
 * a Los Angeles showroom surfaced by an ambiguous "South Bay").
 */
export const DETOUR_MAX_MINUTES = 15;

/**
 * Pull the offerable detours out of a raw `plan_drive_route` result.
 *
 * Parses defensively: a malformed or unexpected result must degrade to "no
 * detours to check" rather than blocking the user's route from publishing.
 */
export function extractOfferableDetours(rawResult: string): OfferableDetour[] {
  try {
    const parsed = JSON.parse(rawResult) as {
      detourOptions?: Array<{ name?: unknown; extraMinutes?: unknown; openAtArrival?: unknown }>;
    };
    const options = Array.isArray(parsed?.detourOptions) ? parsed.detourOptions : [];
    return options
      .filter(
        (d) =>
          typeof d?.name === "string" &&
          d.name.trim() !== "" &&
          typeof d?.extraMinutes === "number" &&
          Number.isFinite(d.extraMinutes) &&
          d.extraMinutes <= DETOUR_MAX_MINUTES &&
          // Only a definite "no" disqualifies — "unknown" hours are still worth
          // offering with a call-ahead.
          d?.openAtArrival !== "no",
      )
      .map((d) => ({ name: (d.name as string).trim(), extraMinutes: d.extraMinutes as number }));
  } catch {
    return [];
  }
}

/**
 * Offerable detours that the published route neither routed nor offered.
 *
 * A stop that got promoted into the main route is not "missed" — that is the
 * better outcome, not a failure.
 */
export function findMissedDetours(
  offerable: readonly OfferableDetour[],
  routeDetourNames: readonly string[],
  routeStopNames: readonly string[],
): OfferableDetour[] {
  const norm = (s: string) => s.toLowerCase().trim();
  const offered = new Set(routeDetourNames.map(norm));
  const routed = new Set(routeStopNames.map(norm));
  return offerable.filter((d) => !offered.has(norm(d.name)) && !routed.has(norm(d.name)));
}
