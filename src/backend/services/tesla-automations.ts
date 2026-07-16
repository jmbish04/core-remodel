/**
 * @fileoverview Tesla automation hook — the IFTTT-style trigger layer.
 *
 * PLACEHOLDER. Every ingested Tesla event (a Fleet Telemetry frame or a webhook
 * notification) is passed through `evaluateAutomations` after it's persisted, so
 * there is ONE well-defined seam where "when <condition> then <action>" rules
 * will live. The conditional logic itself is coming soon — for now this only
 * normalizes the event into a common shape and returns no actions.
 *
 * Design intent for when rules land:
 *   - Rules are evaluated against the normalized `TeslaEvent` below.
 *   - A rule that fires returns an action the caller executes (e.g.
 *     `sendNavigation`, notify, write a row) — keep side effects OUT of here so
 *     evaluation stays pure and testable; the route/webhook performs the action.
 *   - Debounce/idempotency (telemetry is ~500ms) will matter — a rule engine
 *     should track last-fired state (likely a small table in TESLA_DB).
 */

/** Where the event came from. */
export type TeslaEventSource = "telemetry" | "webhook";

/** Normalized Tesla event handed to the (future) rule engine. */
export interface TeslaEvent {
  source: TeslaEventSource;
  vin: string | null;
  /** Coarse type for webhooks (e.g. "drive_state"); undefined for telemetry. */
  eventType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speed?: number | null;
  shiftState?: string | null;
  batteryLevel?: number | null;
  /** The raw payload, for rules that need a field we haven't hoisted yet. */
  raw: Record<string, unknown>;
}

/**
 * An action a fired rule wants the caller to perform. Deliberately open-ended;
 * the caller switches on `type`. No implementations yet.
 */
export type TeslaAutomationAction =
  | { type: "navigate"; destination: string; reason: string }
  | { type: "noop"; reason: string };

/**
 * Evaluate automation rules for one event.
 *
 * ponytail: intentionally a stub — returns no actions until the rule logic is
 * defined. Kept as an explicit async seam (not inlined) so wiring, tests, and
 * the persistence path are already in place when the rules arrive; swapping the
 * body for a real engine won't touch any call site.
 *
 * @param _env   Worker env (rules will read config/state from it).
 * @param _event The normalized event.
 * @returns Actions for the caller to execute (empty for now).
 */
export async function evaluateAutomations(
  _env: Env,
  _event: TeslaEvent,
): Promise<TeslaAutomationAction[]> {
  // TODO(tesla-automations): conditional trigger logic coming soon.
  return [];
}
