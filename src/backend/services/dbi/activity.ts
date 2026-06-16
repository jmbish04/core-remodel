/**
 * Recent-activity detection (SPEC Phase 4).
 *
 * For each gathered contractor permit, determine *whether* and *what* recent
 * activity exists — the strongest "actively being worked" signal. This is a
 * descriptive field, NOT a filter: an open permit with no recent activity still
 * shows, just flagged as quiet.
 *
 * Signals, newest wins:
 *   - Inspections (building `vckc-dh2h`, plumbing `fuas-yurr`) by permit number —
 *     a scheduled/performed inspection is the strongest on-site signal.
 *   - Addenda (building `87xy-gk8d`) by application number — plan-check steps.
 *   - The permit's own `status_date` / `last_permit_activity_date`.
 *   - Fallback: issued / completed dates.
 *
 * Inspection + addenda lookups are batched (`reference_number IN (...)` /
 * `application_number IN (...)`) so the whole set costs a handful of calls.
 */

import {
  chunkArray,
  fetchSodaRows,
  parseDate,
  type SodaRow,
  toNullableString,
} from "./soda";
import { ADDENDA_DATASET, INSPECTION_DATASETS, type Trade } from "./datasets";

export type RecentActivityType =
  | "inspection"
  | "addenda"
  | "status_change"
  | "issued"
  | "none";

export type RecentActivity = {
  recentActivityType: RecentActivityType;
  recentActivityDate: string | null;
  recentActivityDetail: string | null;
};

/** Minimal per-permit input the detector needs. */
export type PermitActivityInput = {
  trade: Trade;
  permitNumber: string | null;
  applicationNumber: string | null;
  statusDate: string | null;
  lastActivityDate: string | null;
  issuedDate: string | null;
  completedDate: string | null;
};

const IN_CHUNK = 40;
const INSPECTION_MAX_ROWS = 4000;
const ADDENDA_MAX_ROWS = 4000;

function field(row: SodaRow, name: string): string | null {
  return toNullableString(row[name]);
}

/** Newest parseable date among the given ISO strings, or null. */
function latestDate(values: Array<string | null | undefined>): string | null {
  let best: { iso: string; time: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = parseDate(value);
    if (!parsed) continue;
    const time = parsed.getTime();
    if (!best || time > best.time) best = { iso: value, time };
  }
  return best?.iso ?? null;
}

type ActivityEvent = { date: string; detail: string };

/**
 * Fetch inspections for a set of permit numbers within a trade and index the
 * single most-recent inspection per permit.
 */
async function fetchInspectionEvents(
  trade: Trade,
  permitNumbers: string[],
): Promise<Map<string, ActivityEvent>> {
  const out = new Map<string, ActivityEvent>();
  const dataset = INSPECTION_DATASETS[trade];
  if (!dataset || permitNumbers.length === 0) return out;

  for (const chunk of chunkArray(permitNumbers, IN_CHUNK)) {
    const inList = chunk.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(",");
    const where = `reference_number in (${inList}) AND lower(reference_number_type) = 'permit'`;
    let rows: SodaRow[] = [];
    try {
      rows = await fetchSodaRows(dataset.id, { $where: where, $order: ":id DESC" }, INSPECTION_MAX_ROWS);
    } catch {
      continue;
    }
    for (const row of rows) {
      const ref = field(row, "reference_number");
      if (!ref) continue;
      const date = latestDate([
        field(row, "scheduled_date"),
        field(row, "appointment_date"),
        field(row, "request_date"),
      ]);
      if (!date) continue;
      const desc = field(row, "inspection_description") || "Inspection";
      const result = field(row, "result");
      const detail = `Inspection: ${desc}${result ? ` — ${result}` : ""}`;
      const existing = out.get(ref);
      if (!existing || parseDate(date)!.getTime() > parseDate(existing.date)!.getTime()) {
        out.set(ref, { date, detail });
      }
    }
  }
  return out;
}

/**
 * Fetch building addenda for a set of application numbers and index the single
 * most-recent addenda step per application.
 */
async function fetchAddendaEvents(
  applicationNumbers: string[],
): Promise<Map<string, ActivityEvent>> {
  const out = new Map<string, ActivityEvent>();
  if (applicationNumbers.length === 0) return out;

  for (const chunk of chunkArray(applicationNumbers, IN_CHUNK)) {
    const inList = chunk.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(",");
    const where = `application_number in (${inList})`;
    let rows: SodaRow[] = [];
    try {
      rows = await fetchSodaRows(ADDENDA_DATASET.id, { $where: where, $order: ":id DESC" }, ADDENDA_MAX_ROWS);
    } catch {
      continue;
    }
    for (const row of rows) {
      const app = field(row, "application_number");
      if (!app) continue;
      const date = latestDate([
        field(row, "finish_date"),
        field(row, "approved_date"),
        field(row, "start_date"),
        field(row, "assign_date"),
      ]);
      if (!date) continue;
      const title = field(row, "title") || field(row, "addenda_status") || "Addenda step";
      const status = field(row, "addenda_status");
      const detail = `Addenda: ${title}${status && status !== title ? ` (${status})` : ""}`;
      const existing = out.get(app);
      if (!existing || parseDate(date)!.getTime() > parseDate(existing.date)!.getTime()) {
        out.set(app, { date, detail });
      }
    }
  }
  return out;
}

/**
 * Compute the most-recent activity descriptor for each permit. Returns a map
 * keyed by permit number. Inspections/addenda are fetched in batch up front,
 * then merged per permit with the permit's own status/issue dates.
 */
export async function detectRecentActivity(
  permits: PermitActivityInput[],
): Promise<Map<string, RecentActivity>> {
  const out = new Map<string, RecentActivity>();
  if (permits.length === 0) return out;

  // Batch inspections per trade.
  const inspectionByTrade = new Map<Trade, Map<string, ActivityEvent>>();
  for (const trade of Object.keys(INSPECTION_DATASETS) as Trade[]) {
    const nums = permits
      .filter((p) => p.trade === trade && p.permitNumber)
      .map((p) => p.permitNumber as string);
    inspectionByTrade.set(trade, await fetchInspectionEvents(trade, Array.from(new Set(nums))));
  }

  // Batch building addenda by application number (permit number is the app number on modern permits).
  const appNumbers = permits
    .filter((p) => p.trade === "building")
    .map((p) => p.applicationNumber || p.permitNumber)
    .filter((value): value is string => Boolean(value));
  const addendaEvents = await fetchAddendaEvents(Array.from(new Set(appNumbers)));

  for (const permit of permits) {
    if (!permit.permitNumber) continue;
    const candidates: Array<{ type: RecentActivityType; event: ActivityEvent }> = [];

    const inspection = inspectionByTrade.get(permit.trade)?.get(permit.permitNumber);
    if (inspection) candidates.push({ type: "inspection", event: inspection });

    if (permit.trade === "building") {
      const addenda = addendaEvents.get(permit.applicationNumber || permit.permitNumber);
      if (addenda) candidates.push({ type: "addenda", event: addenda });
    }

    const statusDate = latestDate([permit.statusDate, permit.lastActivityDate]);
    if (statusDate) {
      candidates.push({
        type: "status_change",
        event: { date: statusDate, detail: "Permit status / activity update" },
      });
    }

    const issuedOrDone = latestDate([permit.issuedDate, permit.completedDate]);
    if (issuedOrDone) {
      candidates.push({
        type: "issued",
        event: {
          date: issuedOrDone,
          detail: permit.completedDate ? "Completed" : "Permit issued",
        },
      });
    }

    if (candidates.length === 0) {
      out.set(permit.permitNumber, {
        recentActivityType: "none",
        recentActivityDate: null,
        recentActivityDetail: null,
      });
      continue;
    }

    candidates.sort(
      (a, b) => parseDate(b.event.date)!.getTime() - parseDate(a.event.date)!.getTime(),
    );
    const winner = candidates[0];
    out.set(permit.permitNumber, {
      recentActivityType: winner.type,
      recentActivityDate: winner.event.date,
      recentActivityDetail: winner.event.detail,
    });
  }

  return out;
}
