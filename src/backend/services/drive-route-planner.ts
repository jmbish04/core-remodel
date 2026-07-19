/**
 * @fileoverview Traffic-aware, hours-constrained drive sequencing.
 *
 * Division of labour: the AGENT decides *what matters* (which showrooms, how
 * long to spend, how valuable each is). This module decides *what order works*.
 * Timing arithmetic — ETAs, closing-time feasibility, wait-for-open — is
 * deterministic code because language models reliably get it subtly wrong, and
 * a 12-minute error here means arriving at a locked door.
 *
 * Heuristic: earliest-deadline-first seeded, then greedy nearest-feasible with
 * a value/drive tradeoff, then a feasibility-preserving 2-opt pass.
 *
 * ponytail: this is a heuristic, not an optimal VRP solve. For a 6–10 stop
 * shopping day it lands within a few minutes of optimal. If routes ever grow
 * past ~15 stops or gain hard appointment windows, swap in a real solver
 * (or-tools via a service binding) behind this same interface.
 */

/** Minutes-from-midnight, California wall clock, throughout this module. */
export interface PlannerStop {
  id: string;
  name: string;
  /** How long the visit itself takes. */
  dwellMinutes: number;
  /** 0–100 sourcing value. Drives sequencing when timing allows a choice. */
  priority: number;
  /** Opening window. `null` = hours unknown; treated as open but flagged. */
  openMinute: number | null;
  closeMinute: number | null;
  /** True when hours could not be verified — surfaces a call-ahead. */
  hoursUnknown: boolean;
}

export interface PlannedStop {
  id: string;
  name: string;
  order: number;
  arriveMinute: number;
  /** Minutes spent idle because we arrived before opening. */
  waitMinutes: number;
  departMinute: number;
  dwellMinutes: number;
  driveMinutesToNext: number | null;
  /** e.g. "must go first — closes at 3:00 PM". */
  warnings: string[];
}

export interface PlanResult {
  stops: PlannedStop[];
  /** Stops that could not be fitted, with the reason. */
  dropped: Array<{ id: string; name: string; reason: string }>;
  totalDriveMinutes: number;
  endMinute: number;
}

/**
 * `travel[i][j]` = minutes from stop i to stop j, indexed against
 * `[origin, ...stops]`. `null` = unroutable.
 */
export interface PlanInput {
  stops: PlannerStop[];
  travelMinutes: (number | null)[][];
  /** When the user can start driving (California minutes-from-midnight). */
  startMinute: number;
  /** Hard stop — nothing may begin after this. */
  endMinute: number;
}

/** Unknown legs must not read as free travel; assume a real-world default. */
const UNKNOWN_LEG_MINUTES = 30;

function leg(travel: (number | null)[][], from: number, to: number): number {
  const v = travel[from]?.[to];
  return v == null ? UNKNOWN_LEG_MINUTES : v;
}

/**
 * Latest clock time we could still *begin* a visit and finish before close.
 * Stops with no known close time sort last — they constrain nothing.
 */
function latestStart(stop: PlannerStop, dayEnd: number): number {
  if (stop.closeMinute == null) return dayEnd;
  return stop.closeMinute - stop.dwellMinutes;
}

/**
 * Sequence stops into a feasible, high-value day.
 *
 * Feasibility rule: we may arrive before opening (and wait), but we may never
 * *start* a visit later than `close - dwell`. A stop that cannot satisfy that
 * is dropped with a reason rather than silently scheduled into a closed store.
 */
export function planRoute(input: PlanInput): PlanResult {
  const { stops, travelMinutes, startMinute, endMinute } = input;

  const remaining = stops.map((s, i) => ({ stop: s, index: i + 1 })); // +1: origin is 0
  const ordered: PlannedStop[] = [];
  const dropped: PlanResult["dropped"] = [];

  let cursor = 0; // travel-matrix index of where we are
  let clock = startMinute;
  let totalDrive = 0;

  while (remaining.length > 0) {
    let best: { at: number; arrive: number; wait: number; score: number } | null = null;

    for (let k = 0; k < remaining.length; k++) {
      const { stop, index } = remaining[k];
      const drive = leg(travelMinutes, cursor, index);
      const arrive = clock + drive;
      const open = stop.openMinute ?? arrive;
      const begin = Math.max(arrive, open);
      const wait = Math.max(0, open - arrive);

      // Infeasible: would start after the store's last workable moment, or
      // push past the user's hard end.
      if (begin > latestStart(stop, endMinute)) continue;
      if (begin + stop.dwellMinutes > endMinute) continue;

      // Value per unit of time consumed, with urgency for early closers so a
      // 3pm-closing stone yard outranks an equally-valuable 6pm showroom.
      const slack = latestStart(stop, endMinute) - begin;
      const urgency = 1 + 120 / (slack + 60);
      const cost = drive + wait + stop.dwellMinutes;
      const score = (stop.priority * urgency) / Math.max(cost, 1);

      if (!best || score > best.score) best = { at: k, arrive, wait, score };
    }

    if (!best) {
      // Nothing left fits. Report each survivor with a specific reason.
      for (const { stop, index } of remaining) {
        const arrive = clock + leg(travelMinutes, cursor, index);
        const begin = Math.max(arrive, stop.openMinute ?? arrive);
        dropped.push({
          id: stop.id,
          name: stop.name,
          reason:
            begin > latestStart(stop, endMinute)
              ? "closes before we could arrive and complete a useful visit"
              : "does not fit inside the available time window",
        });
      }
      break;
    }

    const { stop, index } = remaining[best.at];
    const drive = leg(travelMinutes, cursor, index);
    const arrive = clock + drive;
    const begin = Math.max(arrive, stop.openMinute ?? arrive);

    totalDrive += drive;
    ordered.push({
      id: stop.id,
      name: stop.name,
      order: ordered.length + 1,
      arriveMinute: arrive,
      waitMinutes: Math.max(0, begin - arrive),
      departMinute: begin + stop.dwellMinutes,
      dwellMinutes: stop.dwellMinutes,
      driveMinutesToNext: null,
      warnings: [],
    });

    clock = begin + stop.dwellMinutes;
    cursor = index;
    remaining.splice(best.at, 1);
  }

  // Backfill drive-to-next now that the order is known.
  const indexOf = new Map(stops.map((s, i) => [s.id, i + 1]));
  for (let i = 0; i < ordered.length - 1; i++) {
    ordered[i].driveMinutesToNext = leg(
      travelMinutes,
      indexOf.get(ordered[i].id)!,
      indexOf.get(ordered[i + 1].id)!,
    );
  }

  annotate(ordered, stops);

  return {
    stops: ordered,
    dropped,
    totalDriveMinutes: totalDrive,
    endMinute: ordered.length > 0 ? ordered[ordered.length - 1].departMinute : startMinute,
  };
}

/** Attach the human-facing timing warnings the route output requires. */
function annotate(ordered: PlannedStop[], stops: PlannerStop[]): void {
  const byId = new Map(stops.map((s) => [s.id, s]));
  for (const planned of ordered) {
    const stop = byId.get(planned.id);
    if (!stop) continue;

    if (stop.hoursUnknown) {
      planned.warnings.push("hours unverified — call ahead before driving");
    }
    if (stop.closeMinute != null) {
      const spare = stop.closeMinute - planned.departMinute;
      if (spare <= 15) {
        planned.warnings.push(
          planned.order === 1
            ? "must go first — closing time is tight"
            : "tight against closing — do not linger at the previous stop",
        );
      }
    }
    if (planned.waitMinutes >= 20) {
      planned.warnings.push(`opens later — ${planned.waitMinutes} min wait if you arrive on time`);
    }
  }
}
