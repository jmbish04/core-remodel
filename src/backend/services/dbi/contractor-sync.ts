/**
 * Contractor activity sync (SPEC Phases 2, 3, 5).
 *
 * Given the anchor (open 126 Colby) permits, this:
 *  - Phase 2: reads each anchor permit's contacts, builds a deduped set of
 *    monitored contractors with a before/after baseline filed date.
 *  - Phase 3: for each contractor, gathers their other permits across building /
 *    electrical / plumbing via the matcher, fetches permit details, and keeps the
 *    ones that are open or recently-closed (after the baseline), tagging each with
 *    relation-to-anchor + match confidence.
 *  - Phase 4: attaches the most-recent-activity descriptor (via {@link activity}).
 *  - Phase 5: persists contractors → `permits_contacts` and their permits →
 *    `permits_contact_activity`.
 *
 * The hardcoded contact-exclusion list is gone: a contractor is in scope iff they
 * sit on an open anchor permit.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import { permitsContactActivity, permitsContacts } from "@backend/db";
import {
  chunkArray,
  coerceLatLong,
  extractFieldValue,
  fetchDatasetMetadata,
  fetchSodaRows,
  findFieldName,
  isClosedStatus,
  isObject,
  normalizeText,
  parseDate,
  type SodaRow,
  statusToCategory,
  toNullableString,
} from "./soda";
import { CONTACT_DATASETS, PERMIT_DATASETS, TRADES, type Trade } from "./datasets";
import {
  buildContactMatchWhere,
  classifyContactMatch,
  isValidLicense,
  type ContractorIdentity,
  type MatchConfidence,
  type MatchStrategy,
} from "./matching";
import { detectRecentActivity, type PermitActivityInput, type RecentActivity } from "./activity";

/** An open 126 Colby permit that anchors contact extraction. */
export type AnchorPermit = {
  trade: Trade;
  permitNumber: string;
  filedDate: string | null;
};

type MonitoredContractor = ContractorIdentity & {
  /** Stable dedupe key (license → sf-biz → normalized name). */
  key: string;
  anchorPermitNumbers: string[];
  anchorReferenceFiledDate: string | null;
};

/** A contractor permit ready to persist / render as a marker + table row. */
export type GatheredPermit = {
  trade: Trade;
  permitNumber: string;
  applicationNumber: string | null;
  permitType: string | null;
  permitStatus: string | null;
  statusCategory: string | null;
  filedDate: string | null;
  issuedDate: string | null;
  completedDate: string | null;
  isOpen: boolean;
  isRecentlyClosed: boolean;
  relationToAnchor: "before" | "after" | "concurrent" | null;
  latitude: string | null;
  longitude: string | null;
  propertyAddress: string | null;
  block: string | null;
  lot: string | null;
  matchStrategy: MatchStrategy;
  matchConfidence: MatchConfidence;
  recentActivity: RecentActivity;
  rawData: SodaRow;
};

const GATHER_MAX_CONTACT_ROWS = 1500;
const PERMIT_DETAIL_CHUNK = 45;
const PERMIT_DETAIL_MAX_ROWS = 3000;
// D1 caps bound parameters at 100 per statement (~30 columns/row here), so we
// group single-row inserts into batches via db.batch() instead of one large
// multi-row INSERT — fewer round-trips, still within the per-statement limit.
const ACTIVITY_INSERT_BATCH = 50;

// ---------------------------------------------------------------------------
// Phase 2 — anchor contacts → monitored contractors
// ---------------------------------------------------------------------------

/** Read a contractor identity off a contact row using the dataset's field map. */
function extractIdentity(row: SodaRow, trade: Trade): ContractorIdentity {
  const config = CONTACT_DATASETS[trade];
  const firstName =
    config.personNameFields.length === 2 ? toNullableString(row[config.personNameFields[0]]) : null;
  const lastName =
    config.personNameFields.length === 2 ? toNullableString(row[config.personNameFields[1]]) : null;
  const firmName = toNullableString(row[config.firmNameField]);
  const firmAddress = config.firmAddressFields
    .map((field) => toNullableString(row[field]))
    .filter(Boolean)
    .join(" ")
    .trim();
  const licenseNumbers = Array.from(
    new Set(
      config.licenseFields
        .map((field) => toNullableString(row[field]))
        .filter((value): value is string => isValidLicense(value)),
    ),
  );
  const sfBusinessLicense = toNullableString(row[config.sfBizField]);
  const contactName =
    firstName && lastName ? `${firstName} ${lastName}` : firmName || "Unknown contractor";

  return {
    contactName,
    firstName,
    lastName,
    firmName,
    firmAddress: firmAddress || null,
    licenseNumbers,
    sfBusinessLicense,
  };
}

/** Stable dedupe key so the same contractor across permits collapses to one row. */
function contractorKey(identity: ContractorIdentity): string {
  if (identity.licenseNumbers.length > 0) return `lic:${identity.licenseNumbers.slice().sort()[0]}`;
  if (isValidLicense(identity.sfBusinessLicense)) return `sfbiz:${identity.sfBusinessLicense}`;
  return `name:${normalizeText(identity.contactName)}`;
}

/** Earlier of two ISO date strings (nulls ignored). */
function earlierDate(a: string | null, b: string | null): string | null {
  const da = parseDate(a);
  const db = parseDate(b);
  if (da && db) return da.getTime() <= db.getTime() ? a : b;
  return a ?? b;
}

/**
 * Phase 2: for every anchor permit, pull its contacts and fold them into a
 * deduped map of monitored contractors with their anchor permit list + baseline.
 */
async function extractMonitoredContractors(
  anchors: AnchorPermit[],
): Promise<MonitoredContractor[]> {
  const byKey = new Map<string, MonitoredContractor>();

  for (const anchor of anchors) {
    const config = CONTACT_DATASETS[anchor.trade];
    let rows: SodaRow[] = [];
    try {
      rows = await fetchSodaRows(
        config.id,
        { $where: `${config.idField} = '${anchor.permitNumber.replace(/'/g, "\\'")}'` },
        500,
      );
    } catch {
      continue;
    }

    for (const row of rows) {
      const identity = extractIdentity(row, anchor.trade);
      // Skip rows with no usable identity at all.
      if (
        identity.licenseNumbers.length === 0 &&
        !identity.firmName &&
        !(identity.firstName && identity.lastName)
      ) {
        continue;
      }
      const key = contractorKey(identity);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.anchorPermitNumbers.includes(anchor.permitNumber)) {
          existing.anchorPermitNumbers.push(anchor.permitNumber);
        }
        existing.anchorReferenceFiledDate = earlierDate(
          existing.anchorReferenceFiledDate,
          anchor.filedDate,
        );
        // Merge any newly-seen licenses.
        for (const lic of identity.licenseNumbers) {
          if (!existing.licenseNumbers.includes(lic)) existing.licenseNumbers.push(lic);
        }
      } else {
        byKey.set(key, {
          ...identity,
          key,
          anchorPermitNumbers: [anchor.permitNumber],
          anchorReferenceFiledDate: anchor.filedDate,
        });
      }
    }
  }

  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Phase 3 — gather a contractor's permits across trades
// ---------------------------------------------------------------------------

type Candidate = {
  trade: Trade;
  permitNumber: string;
  matchStrategy: MatchStrategy;
  matchConfidence: MatchConfidence;
};

const CONFIDENCE_RANK: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Query all contact datasets for this contractor; return best-confidence candidate permits. */
async function gatherCandidatePermits(contractor: MonitoredContractor): Promise<Candidate[]> {
  const best = new Map<string, Candidate>(); // key: `${trade}:${permit}`

  for (const trade of TRADES) {
    const config = CONTACT_DATASETS[trade];
    const where = buildContactMatchWhere(contractor, config);
    if (!where) continue;

    let rows: SodaRow[] = [];
    try {
      rows = await fetchSodaRows(
        config.id,
        { $where: where, $order: ":id DESC" },
        GATHER_MAX_CONTACT_ROWS,
      );
    } catch {
      continue;
    }

    for (const row of rows) {
      const permitNumber = toNullableString(row[config.idField]);
      if (!permitNumber) continue;
      const match = classifyContactMatch(row, contractor, config);
      if (!match) continue; // OR-query returned a row no rule actually confirms
      const mapKey = `${trade}:${permitNumber}`;
      const existing = best.get(mapKey);
      if (!existing || CONFIDENCE_RANK[match.confidence] > CONFIDENCE_RANK[existing.matchConfidence]) {
        best.set(mapKey, {
          trade,
          permitNumber,
          matchStrategy: match.strategy,
          matchConfidence: match.confidence,
        });
      }
    }
  }

  return Array.from(best.values());
}

/** Extracted permit detail from a permit dataset row. */
type PermitDetail = {
  applicationNumber: string | null;
  permitType: string | null;
  permitStatus: string | null;
  statusCategory: string | null;
  filedDate: string | null;
  issuedDate: string | null;
  completedDate: string | null;
  statusDate: string | null;
  lastActivityDate: string | null;
  latitude: string | null;
  longitude: string | null;
  propertyAddress: string | null;
  block: string | null;
  lot: string | null;
  raw: SodaRow;
};

/** Pull lat/long from a SODA geo `location`/`point` object or explicit columns. */
function extractLatLong(row: SodaRow): { latitude: string | null; longitude: string | null } {
  for (const key of ["location", "point"]) {
    const value = row[key];
    if (isObject(value)) {
      const coords = (value as { coordinates?: unknown }).coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        return {
          longitude: coerceLatLong(String(coords[0])),
          latitude: coerceLatLong(String(coords[1])),
        };
      }
      const lat = (value as { latitude?: unknown }).latitude;
      const lon = (value as { longitude?: unknown }).longitude;
      if (lat != null && lon != null) {
        return { latitude: coerceLatLong(String(lat)), longitude: coerceLatLong(String(lon)) };
      }
    }
  }
  return {
    latitude: coerceLatLong(extractFieldValue(row, [], ["latitude", "lat"])),
    longitude: coerceLatLong(extractFieldValue(row, [], ["longitude", "lon", "lng"])),
  };
}

function buildAddress(row: SodaRow): string | null {
  const number = extractFieldValue(row, [], ["street_number", "house_number"]);
  const name = extractFieldValue(row, [], ["street_name"]);
  const suffix = extractFieldValue(row, [], ["street_suffix"]);
  const parts = [number, name, suffix].filter(Boolean).join(" ").trim();
  return parts || extractFieldValue(row, [], ["address", "property_address"]);
}

/** Fetch + extract permit details for a set of permit numbers within a trade. */
async function fetchPermitDetails(
  trade: Trade,
  permitNumbers: string[],
): Promise<Map<string, PermitDetail>> {
  const out = new Map<string, PermitDetail>();
  if (permitNumbers.length === 0) return out;
  const dataset = PERMIT_DATASETS[trade];
  const metadata = await fetchDatasetMetadata(dataset.id);
  const fields = metadata?.fields ?? [];
  const permitField = findFieldName(fields, ["permit_number", "permit_no"]) || "permit_number";

  for (const chunk of chunkArray(permitNumbers, PERMIT_DETAIL_CHUNK)) {
    const inList = chunk.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(",");
    let rows: SodaRow[] = [];
    try {
      rows = await fetchSodaRows(
        dataset.id,
        { $where: `\`${permitField}\` in (${inList})` },
        PERMIT_DETAIL_MAX_ROWS,
      );
    } catch {
      continue;
    }
    for (const row of rows) {
      const permitNumber = extractFieldValue(row, fields, ["permit_number", "permit_no"]);
      if (!permitNumber) continue;
      const permitStatus = extractFieldValue(row, fields, ["status", "current_status"]);
      const statusCategory = statusToCategory(permitStatus);
      const completedDate = extractFieldValue(row, fields, ["completed_date", "completion_date"]);
      const { latitude, longitude } = extractLatLong(row);
      out.set(permitNumber, {
        applicationNumber: extractFieldValue(row, fields, ["application_number", "application_no"]),
        permitType: extractFieldValue(row, fields, ["permit_type", "type_of_work", "description"]),
        permitStatus,
        statusCategory,
        filedDate: extractFieldValue(row, fields, ["filed_date", "application_date", "application_creation_date"]),
        issuedDate: extractFieldValue(row, fields, ["issued_date", "issue_date"]),
        completedDate,
        statusDate: extractFieldValue(row, fields, ["status_date"]),
        lastActivityDate: extractFieldValue(row, fields, ["last_permit_activity_date", "last_activity"]),
        latitude,
        longitude,
        propertyAddress: buildAddress(row),
        block: extractFieldValue(row, fields, ["block"]),
        lot: extractFieldValue(row, fields, ["lot"]),
        raw: row,
      });
    }
  }
  return out;
}

function relationToAnchor(
  filedDate: string | null,
  baseline: string | null,
): "before" | "after" | "concurrent" | null {
  const filed = parseDate(filedDate);
  const base = parseDate(baseline);
  if (!filed || !base) return null;
  if (filed.getTime() < base.getTime()) return "before";
  if (filed.getTime() > base.getTime()) return "after";
  return "concurrent";
}

/**
 * Phase 3 + 4 for one contractor: gather candidates, fetch details, keep
 * open/recently-closed permits, tag relation + recent activity. Excludes the
 * contractor's own 126 Colby (target) permits — those are the home marker, not
 * "other work".
 */
async function buildContractorPermits(
  contractor: MonitoredContractor,
  targetPermitNumbers: Set<string>,
): Promise<GatheredPermit[]> {
  const candidates = (await gatherCandidatePermits(contractor)).filter(
    (candidate) => !targetPermitNumbers.has(candidate.permitNumber),
  );
  if (candidates.length === 0) return [];

  // Fetch permit details per trade.
  const detailsByTrade = new Map<Trade, Map<string, PermitDetail>>();
  for (const trade of TRADES) {
    const nums = candidates.filter((c) => c.trade === trade).map((c) => c.permitNumber);
    if (nums.length > 0) detailsByTrade.set(trade, await fetchPermitDetails(trade, nums));
  }

  const baseline = contractor.anchorReferenceFiledDate;
  const shown: Array<Omit<GatheredPermit, "recentActivity">> = [];

  for (const candidate of candidates) {
    const detail = detailsByTrade.get(candidate.trade)?.get(candidate.permitNumber);
    if (!detail) continue;
    const isClosed = isClosedStatus(detail.statusCategory, detail.completedDate);
    const isOpen = !isClosed;
    const closed = parseDate(detail.completedDate);
    const base = parseDate(baseline);
    const isRecentlyClosed = Boolean(isClosed && closed && base && closed.getTime() > base.getTime());

    // Keep only open permits and permits that closed after we filed.
    if (!isOpen && !isRecentlyClosed) continue;

    shown.push({
      trade: candidate.trade,
      permitNumber: candidate.permitNumber,
      applicationNumber: detail.applicationNumber,
      permitType: detail.permitType,
      permitStatus: detail.permitStatus,
      statusCategory: detail.statusCategory,
      filedDate: detail.filedDate,
      issuedDate: detail.issuedDate,
      completedDate: detail.completedDate,
      isOpen,
      isRecentlyClosed,
      relationToAnchor: relationToAnchor(detail.filedDate, baseline),
      latitude: detail.latitude,
      longitude: detail.longitude,
      propertyAddress: detail.propertyAddress,
      block: detail.block,
      lot: detail.lot,
      matchStrategy: candidate.matchStrategy,
      matchConfidence: candidate.matchConfidence,
      rawData: detail.raw,
    });
  }

  // Phase 4 — recent-activity descriptors (batched).
  const activityInputs: PermitActivityInput[] = shown.map((permit) => ({
    trade: permit.trade,
    permitNumber: permit.permitNumber,
    applicationNumber: permit.applicationNumber,
    statusDate: detailsByTrade.get(permit.trade)?.get(permit.permitNumber)?.statusDate ?? null,
    lastActivityDate:
      detailsByTrade.get(permit.trade)?.get(permit.permitNumber)?.lastActivityDate ?? null,
    issuedDate: permit.issuedDate,
    completedDate: permit.completedDate,
  }));
  const activityByPermit = await detectRecentActivity(activityInputs);

  return shown.map((permit) => ({
    ...permit,
    recentActivity:
      activityByPermit.get(permit.permitNumber) ?? {
        recentActivityType: "none",
        recentActivityDate: null,
        recentActivityDetail: null,
      },
  }));
}

// ---------------------------------------------------------------------------
// Phase 5 — persistence
// ---------------------------------------------------------------------------

function countByPredicate<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.reduce((total, item) => (predicate(item) ? total + 1 : total), 0);
}

/**
 * Orchestrate Phases 2–5. Returns the gathered data so the AI step (Phase 6) and
 * the dashboard getter can build on it without re-querying SODA.
 */
export async function syncContractorActivity(
  env: Env,
  options: { anchors: AnchorPermit[]; targetPermitNumbers: Set<string>; runId: string },
): Promise<{
  contractors: Array<{ contractor: MonitoredContractor; permits: GatheredPermit[] }>;
  activityCount: number;
}> {
  const db = drizzle(env.DB);
  const contractors = await extractMonitoredContractors(options.anchors);
  const results: Array<{ contractor: MonitoredContractor; permits: GatheredPermit[] }> = [];
  let activityCount = 0;

  for (const contractor of contractors) {
    const permits = await buildContractorPermits(contractor, options.targetPermitNumbers);
    results.push({ contractor, permits });
    activityCount += permits.length;

    const now = new Date();
    const existing = await db
      .select()
      .from(permitsContacts)
      .where(eq(permitsContacts.contactName, contractor.contactName))
      .get();

    await db
      .insert(permitsContacts)
      .values({
        contactName: contractor.contactName,
        isMonitored: true,
        activePropertyPermitCount: countByPredicate(permits, (p) => p.isOpen),
        closedPropertyPermitCount: countByPredicate(permits, (p) => p.isRecentlyClosed),
        metadata: JSON.stringify({ key: contractor.key }),
        licenseNumber: contractor.licenseNumbers[0] ?? null,
        sfBusinessLicenseNumber: contractor.sfBusinessLicense,
        firmName: contractor.firmName,
        firmAddress: contractor.firmAddress,
        role: null,
        anchorPermitIdentifiers: JSON.stringify(contractor.anchorPermitNumbers),
        anchorReferenceFiledDate: contractor.anchorReferenceFiledDate,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: permitsContacts.contactName,
        set: {
          isMonitored: true,
          activePropertyPermitCount: countByPredicate(permits, (p) => p.isOpen),
          closedPropertyPermitCount: countByPredicate(permits, (p) => p.isRecentlyClosed),
          licenseNumber: contractor.licenseNumbers[0] ?? null,
          sfBusinessLicenseNumber: contractor.sfBusinessLicense,
          firmName: contractor.firmName,
          firmAddress: contractor.firmAddress,
          anchorPermitIdentifiers: JSON.stringify(contractor.anchorPermitNumbers),
          anchorReferenceFiledDate: contractor.anchorReferenceFiledDate,
          lastSeenAt: now,
        },
      })
      .run();

    // Replace this contractor's activity rows. D1 caps bound parameters at 100
    // per statement, so rather than one large multi-row INSERT (~30 columns/row)
    // we group single-row inserts into batched round-trips via db.batch().
    await db
      .delete(permitsContactActivity)
      .where(eq(permitsContactActivity.contactName, contractor.contactName))
      .run();

    const activityRows = permits.map((permit) => ({
      id: crypto.randomUUID(),
      contactName: contractor.contactName,
      dataset: permit.trade,
      trade: permit.trade,
      recordKey: `${permit.trade}:${permit.permitNumber}`,
      permitIdentifier: permit.permitNumber,
      applicationNumber: permit.applicationNumber,
      permitNumber: permit.permitNumber,
      permitType: permit.permitType,
      permitStatus: permit.permitStatus,
      statusCategory: permit.statusCategory,
      propertyAddress: permit.propertyAddress,
      filedDate: permit.filedDate,
      issuedDate: permit.issuedDate,
      closedDate: permit.completedDate,
      block: permit.block,
      lot: permit.lot,
      latitude: permit.latitude,
      longitude: permit.longitude,
      isOpen: permit.isOpen,
      isRecentlyClosed: permit.isRecentlyClosed,
      relationToAnchor: permit.relationToAnchor,
      recentActivityType: permit.recentActivity.recentActivityType,
      recentActivityDate: permit.recentActivity.recentActivityDate,
      recentActivityDetail: permit.recentActivity.recentActivityDetail,
      matchStrategy: permit.matchStrategy,
      matchConfidence: permit.matchConfidence,
      anchorPermitIdentifier: contractor.anchorPermitNumbers[0] ?? null,
      runId: options.runId,
      rawData: JSON.stringify(permit.rawData),
    }));

    for (const rowsChunk of chunkArray(activityRows, ACTIVITY_INSERT_BATCH)) {
      const statements = rowsChunk.map((values) =>
        db.insert(permitsContactActivity).values(values),
      );
      if (statements.length > 0) {
        await db.batch(statements as Parameters<typeof db.batch>[0]);
      }
    }
  }

  // Demote contractors that are no longer on any open anchor (stale monitors).
  const activeNames = results.map((r) => r.contractor.contactName);
  const stale = await db.select().from(permitsContacts).where(eq(permitsContacts.isMonitored, true)).all();
  const toDemote = stale.filter((row) => !activeNames.includes(row.contactName)).map((row) => row.contactName);
  if (toDemote.length > 0) {
    await db
      .update(permitsContacts)
      .set({ isMonitored: false })
      .where(inArray(permitsContacts.contactName, toDemote))
      .run();
    await db
      .delete(permitsContactActivity)
      .where(inArray(permitsContactActivity.contactName, toDemote))
      .run();
  }

  return { contractors: results, activityCount };
}

export type { MonitoredContractor };
