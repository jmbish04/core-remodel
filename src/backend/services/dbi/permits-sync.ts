/**
 * Permits sync orchestrator.
 *
 * Phase 1 (target permits) lives here: pull 126 Colby permits across building /
 * electrical / plumbing and persist them to `permits_records`. Phases 2–6
 * (contractor extraction, cross-trade gathering, activity detection, AI busyness)
 * are delegated to the focused modules under this folder. The dashboard / detail
 * getters consumed by the admin-permits routes are preserved here.
 *
 * Shared SODA primitives live in `./soda`; the dataset registry in `./datasets`.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  permitsContactActivity,
  permitsContactInsights,
  permitsContacts,
  permitsIdentifierViews,
  permitsRecordRevisions,
  permitsRecords,
  permitsSyncRuns,
  projectSystemVariables,
} from "@backend/db";

import {
  coerceLatLong,
  derivePermitLifecycle,
  escapeSoqlLiteral,
  extractFieldValue,
  fetchDatasetMetadata,
  fetchSodaRows,
  findFieldName,
  isClosedStatus,
  isObject,
  normalizeAddress,
  normalizeBlockLot,
  pruneVolatileRow,
  sha256,
  stableSortObject,
  statusToCategory,
  type DatasetMetadata,
  type PermitLifecycle,
  type SodaRow,
} from "./soda";
import { PERMIT_DATASETS, TRADES, type Trade } from "./datasets";
import {
  syncContractorActivity,
  type AnchorPermit,
} from "./contractor-sync";
import { generateContractorInsight } from "./ai-insights";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExtractedPermitRow = {
  dataset: Trade;
  recordKey: string;
  permitIdentifier: string | null;
  applicationNumber: string | null;
  permitNumber: string | null;
  permitType: string | null;
  permitStatus: string | null;
  statusCategory: string | null;
  propertyAddress: string | null;
  block: string | null;
  lot: string | null;
  contactName: string | null;
  contactRole: string | null;
  filedDate: string | null;
  issuedDate: string | null;
  expiresDate: string | null;
  closedDate: string | null;
  latitude: string | null;
  longitude: string | null;
  isClosed: boolean;
  rawData: SodaRow;
};

export type PermitsDashboard = {
  latestRuns: Array<typeof permitsSyncRuns.$inferSelect>;
  latestRecords: Array<typeof permitsRecords.$inferSelect>;
  contacts: Array<typeof permitsContacts.$inferSelect>;
  contactActivity: Array<typeof permitsContactActivity.$inferSelect>;
  propertyPermits: Array<{
    permitIdentifier: string;
    applicationNumber: string | null;
    permitNumber: string | null;
    permitType: string | null;
    permitStatus: string | null;
    statusCategory: string | null;
    propertyAddress: string | null;
    block: string | null;
    lot: string | null;
    issuedDate: string | null;
    closedDate: string | null;
    contactNames: string[];
    datasets: string[];
    changeHash: string | null;
    lastChangedAt: Date | number | string | null;
    lastViewedHash: string | null;
    needsReview: boolean;
    isClosed: boolean;
    ownerClosed: boolean;
    ownerCloseNote: string | null;
    ownerClosedAt: Date | null;
    lifecycleStatus: PermitLifecycle;
  }>;
  contactInsights: Array<typeof permitsContactInsights.$inferSelect>;
};

type PermitDetail = {
  permitIdentifier: string;
  needsReview: boolean;
  lifecycleStatus: PermitLifecycle;
  records: Array<typeof permitsRecords.$inferSelect>;
  revisions: Array<typeof permitsRecordRevisions.$inferSelect>;
  viewed: typeof permitsIdentifierViews.$inferSelect | null;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PermitsConfig {
  targetAddress: string;
  targetZip: string;
  /** House number parsed from {@link targetAddress} (e.g. "126"); queries SF DBI `street_number`. Empty string when unknown. */
  targetStreetNumber: string;
  /** Core street name parsed from {@link targetAddress} with the street-type suffix dropped (e.g. "Colby"); queries SF DBI `street_name`. Empty string when unknown. */
  targetStreetName: string;
  targetBlockVariants: string[];
  targetLotVariants: string[];
}

/**
 * Split a street address such as "126 Colby Street" into its house number
 * ("126") and core street name ("Colby"). The trailing street-type suffix is
 * removed so the result matches SF DBI's `street_name` column, which stores the
 * bare name ("Colby") rather than the full "Colby Street".
 */
function parseStreetAddress(value: string): {
  streetNumber: string | null;
  streetName: string | null;
} {
  const match = value.trim().match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return { streetNumber: null, streetName: null };
  }
  const streetNumber = match[1];
  const streetName = match[2]
    .replace(
      /\s+\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|court|ct|lane|ln|place|pl|terrace|ter|way|circle|cir)\b\.?$/i,
      "",
    )
    .trim();
  return { streetNumber, streetName: streetName || match[2].trim() };
}

/**
 * Expand a single block/lot number into the formatting variants SF DBI datasets
 * use interchangeably (bare, zero-stripped, and zero-padded to 3/4 digits). The
 * UI stores ONE value per field (no comma lists); the pipeline derives the match
 * set here. e.g. lot "5" → ["5","005","0005"]; block "5934" → ["5934"].
 */
export function expandBlockLotVariants(value: string): string[] {
  const v = value.trim();
  if (!v) return [];
  const variants = new Set<string>([v]);
  const stripped = v.replace(/^0+/, "") || "0";
  variants.add(stripped);
  if (/^\d+$/.test(stripped)) {
    variants.add(stripped.padStart(3, "0"));
    variants.add(stripped.padStart(4, "0"));
  }
  return [...variants];
}

export async function getPermitsConfig(env: Env): Promise<PermitsConfig> {
  const db = drizzle(env.DB);
  const vars = await db.select().from(projectSystemVariables).all();
  const getValue = (key: string, def: string) =>
    vars.find((v) => v.variableKey === key)?.valueText || def;

  const targetAddress = getValue("permits_target_address", "126 Colby Street");
  const parsedStreet = parseStreetAddress(targetAddress);

  // Single block/lot inputs (`permits_block`/`permits_lot`); fall back to the
  // legacy comma `*_variants` keys (first value) so pre-migration configs still
  // resolve. The pipeline consumes the expanded variant set, not the raw comma.
  const block = getValue("permits_block", getValue("permits_block_variants", "5934").split(",")[0] || "5934");
  const lot = getValue("permits_lot", getValue("permits_lot_variants", "005").split(",")[0] || "005");

  return {
    targetAddress,
    targetZip: getValue("permits_target_zip", "94134"),
    // SF DBI stores addresses as `street_number` + `street_name` components with
    // no single text address column on Building Permits, so these are the precise
    // matchers. Explicit system variables override the parsed values.
    targetStreetNumber: getValue("permits_street_number", parsedStreet.streetNumber ?? ""),
    targetStreetName: getValue("permits_street_name", parsedStreet.streetName ?? ""),
    targetBlockVariants: expandBlockLotVariants(block),
    targetLotVariants: expandBlockLotVariants(lot),
  };
}

/**
 * Read-only probe for the config UI's "Test SODA" button: run the same property
 * query the sync uses, per permit dataset, and return the confirmed match count
 * — WITHOUT persisting anything. Confirms the configured address/block/lot
 * actually resolves to records before the next scheduled sync.
 */
export async function probePropertyRecords(env: Env): Promise<{
  targetAddress: string;
  block: string[];
  lot: string[];
  datasets: { label: string; matched: number }[];
  totalMatched: number;
}> {
  const config = await getPermitsConfig(env);
  const datasets: { label: string; matched: number }[] = [];
  let totalMatched = 0;

  for (const trade of TRADES) {
    const dataset = PERMIT_DATASETS[trade];
    try {
      const metadata = await fetchDatasetMetadata(dataset.id);
      const rows = await queryPropertyRows(dataset.id, config);
      const matched = rows
        .map((row) => extractPermitRow(trade, row, metadata))
        .filter((row) => isTargetPropertyMatch(row, config)).length;
      datasets.push({ label: dataset.label, matched });
      totalMatched += matched;
    } catch (error) {
      datasets.push({
        label: `${dataset.label} (error: ${error instanceof Error ? error.message : "failed"})`,
        matched: 0,
      });
    }
  }

  return {
    targetAddress: config.targetAddress,
    block: config.targetBlockVariants,
    lot: config.targetLotVariants,
    datasets,
    totalMatched,
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — target permits (126 Colby) across trades
// ---------------------------------------------------------------------------

/** Pull lat/long from a SODA geo `location`/`point` object or explicit columns. */
function extractGeo(row: SodaRow): { latitude: string | null; longitude: string | null } {
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
    }
  }
  return {
    latitude: coerceLatLong(extractFieldValue(row, [], ["latitude", "lat"])),
    longitude: coerceLatLong(extractFieldValue(row, [], ["longitude", "lon", "lng"])),
  };
}

function buildStreetAddress(row: SodaRow, fields: DatasetMetadata["fields"]): string | null {
  const explicit = extractFieldValue(row, fields, [
    "property_address",
    "street_address",
    "job_address",
  ]);
  if (explicit) return explicit;
  const number = extractFieldValue(row, fields, ["street_number", "house_number"]);
  const name = extractFieldValue(row, fields, ["street_name"]);
  const suffix = extractFieldValue(row, fields, ["street_suffix"]);
  const unit = extractFieldValue(row, fields, ["unit", "unit_number"]);
  const parts = [number, name, suffix, unit ? `Unit ${unit}` : null]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
  return parts.length > 0 ? parts : null;
}

function buildRecordKey(trade: Trade, row: ExtractedPermitRow): string {
  const idCandidate =
    row.permitIdentifier ||
    row.applicationNumber ||
    row.permitNumber ||
    row.propertyAddress ||
    JSON.stringify(stableSortObject(pruneVolatileRow(row.rawData)));
  return `${trade}:${idCandidate}`;
}

/** Post-fetch confirmation that a fetched row really is the target property. */
function isTargetPropertyMatch(row: ExtractedPermitRow, config: PermitsConfig): boolean {
  const normalizedAddress = normalizeAddress(row.propertyAddress);
  const targetAddress = normalizeAddress(config.targetAddress);
  const targetStreet =
    config.targetStreetNumber && config.targetStreetName
      ? `${config.targetStreetNumber} ${config.targetStreetName}`.toLowerCase()
      : "";
  const addressMatches =
    (Boolean(targetAddress) && normalizedAddress.includes(targetAddress)) ||
    (Boolean(targetStreet) && normalizedAddress.includes(targetStreet));

  const block = normalizeBlockLot(row.block);
  const lot = normalizeBlockLot(row.lot);
  const blockMatches = block
    ? config.targetBlockVariants.map(normalizeBlockLot).includes(block)
    : false;
  const lotMatches = lot
    ? config.targetLotVariants.map(normalizeBlockLot).includes(lot)
    : false;

  return addressMatches || (blockMatches && lotMatches);
}

/** Build the property `$where` for a permit dataset from its metadata. */
function buildPropertyWhereClause(
  metadata: DatasetMetadata | null,
  config: PermitsConfig,
): string | null {
  if (!metadata || metadata.fields.length === 0) return null;

  const addressField = findFieldName(metadata.fields, [
    "property_address",
    "street_address",
    "address",
    "job_address",
    "location",
  ]);
  const streetNumberField = findFieldName(metadata.fields, ["street_number", "house_number"]);
  const streetNameField = findFieldName(metadata.fields, ["street_name"]);
  const blockField = findFieldName(metadata.fields, ["block"]);
  const lotField = findFieldName(metadata.fields, ["lot"]);
  const zipField = findFieldName(metadata.fields, ["zip", "zipcode", "postal_code"]);

  const clauses: string[] = [];
  // Precise component match: query `street_number` + `street_name` directly.
  if (streetNumberField && streetNameField && config.targetStreetNumber && config.targetStreetName) {
    clauses.push(
      `(\`${streetNumberField}\` = '${escapeSoqlLiteral(config.targetStreetNumber)}' AND lower(\`${streetNameField}\`) like '%${escapeSoqlLiteral(config.targetStreetName.toLowerCase())}%')`,
    );
  }
  if (blockField && lotField) {
    const blockClauses = config.targetBlockVariants.map(
      (value) => `\`${blockField}\` = '${escapeSoqlLiteral(value)}'`,
    );
    const lotClauses = config.targetLotVariants.map(
      (value) => `\`${lotField}\` = '${escapeSoqlLiteral(value)}'`,
    );
    clauses.push(`((${blockClauses.join(" OR ")}) AND (${lotClauses.join(" OR ")}))`);
  }
  if (addressField) {
    const addressNeedle =
      config.targetStreetNumber && config.targetStreetName
        ? `${config.targetStreetNumber} ${config.targetStreetName}`.toLowerCase()
        : normalizeAddress(config.targetAddress);
    clauses.push(`lower(\`${addressField}\`) like '%${escapeSoqlLiteral(addressNeedle)}%'`);
  }
  if (zipField && clauses.length === 0) {
    clauses.push(`\`${zipField}\` = '${escapeSoqlLiteral(config.targetZip)}'`);
  }

  return clauses.length > 0 ? clauses.join(" OR ") : null;
}

async function queryPropertyRows(
  datasetId: string,
  config: PermitsConfig,
): Promise<SodaRow[]> {
  const metadata = await fetchDatasetMetadata(datasetId);
  const whereClause = buildPropertyWhereClause(metadata, config);
  if (whereClause) {
    try {
      return await fetchSodaRows(datasetId, { $where: whereClause, $order: ":id DESC" }, 5000);
    } catch {
      // fall through to full-text search
    }
  }
  const searchTerms = [
    config.targetAddress,
    config.targetStreetNumber && config.targetStreetName
      ? `${config.targetStreetNumber} ${config.targetStreetName}`
      : "",
    config.targetBlockVariants[0] && config.targetLotVariants[0]
      ? `${config.targetBlockVariants[0]} ${config.targetLotVariants[0]}`
      : "",
  ].filter(Boolean);
  const rows: SodaRow[] = [];
  const seen = new Set<string>();
  for (const term of searchTerms) {
    const termRows = await fetchSodaRows(datasetId, { $q: term, $order: ":id DESC" }, 1500);
    for (const row of termRows) {
      const serialized = JSON.stringify(row);
      if (seen.has(serialized)) continue;
      seen.add(serialized);
      rows.push(row);
    }
  }
  return rows;
}

function extractPermitRow(
  trade: Trade,
  row: SodaRow,
  metadata: DatasetMetadata | null,
): ExtractedPermitRow {
  const fields = metadata?.fields || [];
  const permitNumber = extractFieldValue(row, fields, ["permit_number", "permit_no", "permit"]);
  const applicationNumber = extractFieldValue(row, fields, [
    "application_number",
    "application_no",
  ]);
  const permitIdentifier = permitNumber || applicationNumber;
  const permitStatus = extractFieldValue(row, fields, ["status", "current_status"]);
  const statusCategory = statusToCategory(permitStatus);
  const closedDate = extractFieldValue(row, fields, ["completed_date", "completion_date"]);
  const { latitude, longitude } = extractGeo(row);

  const extracted: ExtractedPermitRow = {
    dataset: trade,
    recordKey: "",
    permitIdentifier,
    applicationNumber,
    permitNumber,
    permitType: extractFieldValue(row, fields, ["permit_type", "type_of_work", "description"]),
    permitStatus,
    statusCategory,
    propertyAddress: buildStreetAddress(row, fields),
    block: extractFieldValue(row, fields, ["block"]),
    lot: extractFieldValue(row, fields, ["lot"]),
    contactName: extractFieldValue(row, fields, ["contact_name", "applicant_name"]),
    contactRole: extractFieldValue(row, fields, ["contact_role", "role"]),
    filedDate: extractFieldValue(row, fields, [
      "filed_date",
      "application_date",
      "application_creation_date",
    ]),
    issuedDate: extractFieldValue(row, fields, ["issued_date", "issue_date"]),
    expiresDate: extractFieldValue(row, fields, ["expires_date", "expiration_date"]),
    closedDate,
    latitude,
    longitude,
    isClosed: isClosedStatus(statusCategory, closedDate),
    rawData: row,
  };
  extracted.recordKey = buildRecordKey(trade, extracted);
  return extracted;
}

function simplifyRunPayload(payload: unknown): string {
  if (!payload) return "[]";
  try {
    const json = JSON.stringify(payload);
    return json.length <= 50000 ? json : JSON.stringify({ truncated: true, sample: json.slice(0, 50000) });
  } catch {
    return JSON.stringify({ truncated: true, reason: "serialize_failed" });
  }
}

async function createSyncRun(
  env: Env,
  values: {
    runType: "property" | "contact";
    queryLabel: string;
    sourceDataset: string;
    status: "success" | "error";
    resultCount: number;
    errorText?: string | null;
    aiSummary?: string | null;
    rawPayload?: unknown;
  },
): Promise<string> {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  await db
    .insert(permitsSyncRuns)
    .values({
      id,
      runType: values.runType,
      queryLabel: values.queryLabel,
      sourceDataset: values.sourceDataset,
      status: values.status,
      resultCount: values.resultCount,
      errorText: values.errorText || null,
      aiSummary: values.aiSummary || null,
      rawPayload: simplifyRunPayload(values.rawPayload),
    })
    .run();
  return id;
}

/** Upsert target permit records + append a revision row for change tracking. */
async function persistTargetRecords(
  env: Env,
  trade: Trade,
  runId: string,
  rows: ExtractedPermitRow[],
): Promise<void> {
  const db = drizzle(env.DB);
  // D1 does not support interactive SQL transactions (BEGIN/SAVEPOINT), so we
  // upsert each record sequentially. Writes are idempotent (change-hash keyed),
  // so a partial failure just leaves some rows un-updated until the next sync.
  for (const row of rows) {
    const sanitizedRaw = pruneVolatileRow(row.rawData);
    const changeSeed = stableSortObject({
      dataset: row.dataset,
      permitIdentifier: row.permitIdentifier,
      permitStatus: row.permitStatus,
      statusCategory: row.statusCategory,
      propertyAddress: row.propertyAddress,
      block: row.block,
      lot: row.lot,
      filedDate: row.filedDate,
      issuedDate: row.issuedDate,
      closedDate: row.closedDate,
      isClosed: row.isClosed,
      rawData: sanitizedRaw,
    });
    const changeHash = await sha256(JSON.stringify(changeSeed));
    const existing = await db
      .select()
      .from(permitsRecords)
      .where(eq(permitsRecords.recordKey, row.recordKey))
      .get();
    const changed = !existing || existing.changeHash !== changeHash;
    const now = new Date();

    const values = {
      id: existing?.id || crypto.randomUUID(),
      dataset: trade,
      recordKey: row.recordKey,
      permitIdentifier: row.permitIdentifier,
      applicationNumber: row.applicationNumber,
      permitNumber: row.permitNumber,
      permitType: row.permitType,
      permitStatus: row.permitStatus,
      statusCategory: row.statusCategory,
      propertyAddress: row.propertyAddress,
      block: row.block,
      lot: row.lot,
      contactName: row.contactName,
      contactRole: row.contactRole,
      filedDate: row.filedDate,
      issuedDate: row.issuedDate,
      expiresDate: row.expiresDate,
      closedDate: row.closedDate,
      latitude: row.latitude,
      longitude: row.longitude,
      isPropertyPermit: true,
      isClosed: row.isClosed,
      changeHash,
      lastChangedAt: changed ? now : existing?.lastChangedAt || null,
      latestRunId: runId,
      rawData: JSON.stringify(sanitizedRaw),
      datetimeUpdated: now,
    };

    await db
      .insert(permitsRecords)
      .values({ ...values, datetimeCreated: existing?.datetimeCreated || now })
      .onConflictDoUpdate({ target: permitsRecords.recordKey, set: values })
      .run();

    await db
      .insert(permitsRecordRevisions)
      .values({
        id: crypto.randomUUID(),
        runId,
        dataset: trade,
        recordKey: row.recordKey,
        permitNumber: row.permitNumber,
        permitStatus: row.permitStatus,
        rawData: JSON.stringify(sanitizedRaw),
      })
      .run();
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runPermitSync(env: Env): Promise<{
  success: boolean;
  summary: {
    propertyRecords: number;
    anchorPermits: number;
    monitoredContacts: number;
    contactActivity: number;
  };
}> {
  const db = drizzle(env.DB);
  const config = await getPermitsConfig(env);
  let propertyRecordCount = 0;

  // Phase 1 — target permits across trades.
  for (const trade of TRADES) {
    const dataset = PERMIT_DATASETS[trade];
    try {
      const metadata = await fetchDatasetMetadata(dataset.id);
      const rows = await queryPropertyRows(dataset.id, config);
      const normalized = rows
        .map((row) => extractPermitRow(trade, row, metadata))
        .filter((row) => isTargetPropertyMatch(row, config));
      propertyRecordCount += normalized.length;

      const runId = await createSyncRun(env, {
        runType: "property",
        queryLabel: `${dataset.label} for ${config.targetAddress}`,
        sourceDataset: dataset.id,
        status: "success",
        resultCount: normalized.length,
        aiSummary: `Fetched ${normalized.length} ${dataset.label} rows for target property.`,
        rawPayload: normalized.slice(0, 20).map((row) => row.rawData),
      });
      await persistTargetRecords(env, trade, runId, normalized);
    } catch (error) {
      await createSyncRun(env, {
        runType: "property",
        queryLabel: `${dataset.label} for ${config.targetAddress}`,
        sourceDataset: dataset.id,
        status: "error",
        resultCount: 0,
        errorText: error instanceof Error ? error.message : "Unknown sync error",
        rawPayload: null,
      });
    }
  }

  // Derive anchors (open target permits) + the full target permit-number set.
  const targetRows = await db
    .select()
    .from(permitsRecords)
    .where(eq(permitsRecords.isPropertyPermit, true))
    .all();
  const targetPermitNumbers = new Set<string>();
  const anchors: AnchorPermit[] = [];
  for (const row of targetRows) {
    const permitNumber = row.permitNumber || row.permitIdentifier;
    if (!permitNumber) continue;
    targetPermitNumbers.add(permitNumber);
    const lifecycle = derivePermitLifecycle({
      statusCategory: row.statusCategory,
      closedDate: row.closedDate,
      ownerClosed: Boolean(row.ownerClosed),
      filedDate: row.filedDate,
      issuedDate: row.issuedDate,
    });
    if (lifecycle === "active" && TRADES.includes(row.dataset as Trade)) {
      anchors.push({
        trade: row.dataset as Trade,
        permitNumber,
        filedDate: row.filedDate ?? null,
      });
    }
  }

  // Phases 2–5 — contractor gathering + persistence.
  const contractorRunId = await createSyncRun(env, {
    runType: "contact",
    queryLabel: "Contractor activity gather (building/electrical/plumbing)",
    sourceDataset: "multi",
    status: "success",
    resultCount: anchors.length,
  });
  const { contractors, activityCount } = await syncContractorActivity(env, {
    anchors,
    targetPermitNumbers,
    runId: contractorRunId,
  });

  // Phase 6 — AI busyness insight per contractor.
  for (const { contractor, permits } of contractors) {
    await generateContractorInsight(env, contractor, permits, contractorRunId);
  }

  return {
    success: true,
    summary: {
      propertyRecords: propertyRecordCount,
      anchorPermits: anchors.length,
      monitoredContacts: contractors.length,
      contactActivity: activityCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Dashboard / detail getters
// ---------------------------------------------------------------------------

async function hydratePropertyPermitRows(
  env: Env,
): Promise<PermitsDashboard["propertyPermits"]> {
  const db = drizzle(env.DB);
  const rows = await db
    .select()
    .from(permitsRecords)
    .where(
      and(
        eq(permitsRecords.isPropertyPermit, true),
        sql`${permitsRecords.permitIdentifier} IS NOT NULL`,
      ),
    )
    .orderBy(desc(permitsRecords.datetimeUpdated))
    .all();

  const views = await db.select().from(permitsIdentifierViews).all();
  const viewMap = new Map(views.map((row) => [row.permitIdentifier, row]));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.permitIdentifier || "";
    if (!key) continue;
    const existing = grouped.get(key) || [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([permitIdentifier, permitRows]) => {
    const first = permitRows[0];
    const contactNames = Array.from(
      new Set(permitRows.map((row) => row.contactName?.trim() || "").filter(Boolean)),
    );
    const datasets = Array.from(new Set(permitRows.map((row) => row.dataset)));
    const changeHash = first.changeHash || null;
    const view = viewMap.get(permitIdentifier) || null;
    const needsReview = Boolean(changeHash && changeHash !== (view?.lastViewedHash || null));

    return {
      permitIdentifier,
      applicationNumber: first.applicationNumber,
      permitNumber: first.permitNumber,
      permitType: first.permitType,
      permitStatus: first.permitStatus,
      statusCategory: first.statusCategory,
      propertyAddress: first.propertyAddress,
      block: first.block,
      lot: first.lot,
      issuedDate: first.issuedDate,
      closedDate: first.closedDate,
      contactNames,
      datasets,
      changeHash,
      lastChangedAt: first.lastChangedAt,
      lastViewedHash: view?.lastViewedHash || null,
      needsReview,
      isClosed: Boolean(first.isClosed),
      ownerClosed: Boolean(first.ownerClosed),
      ownerCloseNote: first.ownerCloseNote ?? null,
      ownerClosedAt: first.ownerClosedAt ?? null,
      lifecycleStatus: derivePermitLifecycle({
        statusCategory: first.statusCategory,
        closedDate: first.closedDate,
        ownerClosed: Boolean(first.ownerClosed),
        filedDate: first.filedDate,
        issuedDate: first.issuedDate,
      }),
    };
  });
}

export async function getPermitDashboard(env: Env): Promise<PermitsDashboard> {
  const db = drizzle(env.DB);
  const [latestRuns, latestRecords, contacts, contactActivity, contactInsights, propertyPermits] =
    await Promise.all([
      db.select().from(permitsSyncRuns).orderBy(desc(permitsSyncRuns.datetimeCreated)).limit(100).all(),
      db.select().from(permitsRecords).orderBy(desc(permitsRecords.datetimeUpdated)).limit(300).all(),
      db.select().from(permitsContacts).orderBy(desc(permitsContacts.lastSeenAt)).all(),
      db
        .select()
        .from(permitsContactActivity)
        .orderBy(desc(permitsContactActivity.datetimeCreated))
        .limit(500)
        .all(),
      db.select().from(permitsContactInsights).orderBy(desc(permitsContactInsights.datetimeUpdated)).all(),
      hydratePropertyPermitRows(env),
    ]);

  return { latestRuns, latestRecords, contacts, contactActivity, propertyPermits, contactInsights };
}

export async function getPermitDetail(
  env: Env,
  permitIdentifier: string,
): Promise<PermitDetail | null> {
  const db = drizzle(env.DB);
  const normalized = permitIdentifier.trim();
  if (!normalized) return null;

  const records = await db
    .select()
    .from(permitsRecords)
    .where(eq(permitsRecords.permitIdentifier, normalized))
    .orderBy(desc(permitsRecords.datetimeUpdated))
    .all();
  if (records.length === 0) return null;

  const recordKeys = records.map((row) => row.recordKey);
  const revisions =
    recordKeys.length > 0
      ? await db
          .select()
          .from(permitsRecordRevisions)
          .where(inArray(permitsRecordRevisions.recordKey, recordKeys))
          .orderBy(desc(permitsRecordRevisions.datetimeCreated))
          .all()
      : [];
  const viewed = await db
    .select()
    .from(permitsIdentifierViews)
    .where(eq(permitsIdentifierViews.permitIdentifier, normalized))
    .get();

  const latestHash = records[0].changeHash || null;
  const needsReview = Boolean(latestHash && latestHash !== (viewed?.lastViewedHash || null));
  const lifecycleStatus = derivePermitLifecycle({
    statusCategory: records[0].statusCategory,
    closedDate: records[0].closedDate,
    ownerClosed: Boolean(records[0].ownerClosed),
    filedDate: records[0].filedDate,
    issuedDate: records[0].issuedDate,
  });
  return { permitIdentifier: normalized, needsReview, lifecycleStatus, records, revisions, viewed: viewed || null };
}

export async function markPermitViewed(
  env: Env,
  permitIdentifier: string,
): Promise<{ success: boolean; permitIdentifier: string }> {
  const db = drizzle(env.DB);
  const normalized = permitIdentifier.trim();
  if (!normalized) throw new Error("permitIdentifier is required");

  const latest = await db
    .select()
    .from(permitsRecords)
    .where(eq(permitsRecords.permitIdentifier, normalized))
    .orderBy(desc(permitsRecords.datetimeUpdated))
    .get();
  if (!latest) throw new Error("Permit not found");

  const existing = await db
    .select()
    .from(permitsIdentifierViews)
    .where(eq(permitsIdentifierViews.permitIdentifier, normalized))
    .get();
  const now = new Date();

  await db
    .insert(permitsIdentifierViews)
    .values({
      permitIdentifier: normalized,
      lastViewedHash: latest.changeHash || null,
      lastViewedAt: now,
      viewCount: (existing?.viewCount || 0) + 1,
      datetimeCreated: existing?.datetimeCreated || now,
      datetimeUpdated: now,
    })
    .onConflictDoUpdate({
      target: permitsIdentifierViews.permitIdentifier,
      set: {
        lastViewedHash: latest.changeHash || null,
        lastViewedAt: now,
        viewCount: sql`${permitsIdentifierViews.viewCount} + 1`,
        datetimeUpdated: now,
      },
    })
    .run();

  return { success: true, permitIdentifier: normalized };
}

export async function closePermit(
  env: Env,
  permitIdentifier: string,
  note: string,
  closedBy: string,
): Promise<PermitDetail | null> {
  const db = drizzle(env.DB);
  const normalized = permitIdentifier.trim();
  const trimmedNote = note.trim();
  if (!normalized) throw new Error("permitIdentifier is required");
  if (!trimmedNote) throw new Error("A closing note is required");

  await db
    .update(permitsRecords)
    .set({
      ownerClosed: true,
      ownerCloseNote: trimmedNote,
      ownerClosedAt: new Date(),
      ownerClosedBy: closedBy,
      datetimeUpdated: new Date(),
    })
    .where(eq(permitsRecords.permitIdentifier, normalized))
    .run();

  return getPermitDetail(env, normalized);
}

// ---------------------------------------------------------------------------
// Contractor intelligence (map + table + AI) getter
// ---------------------------------------------------------------------------

export type ContractorPermitView = {
  trade: string;
  permitNumber: string | null;
  permitType: string | null;
  permitStatus: string | null;
  statusCategory: string | null;
  filedDate: string | null;
  issuedDate: string | null;
  closedDate: string | null;
  isOpen: boolean;
  isRecentlyClosed: boolean;
  relationToAnchor: string | null;
  latitude: string | null;
  longitude: string | null;
  propertyAddress: string | null;
  block: string | null;
  lot: string | null;
  recentActivityType: string | null;
  recentActivityDate: string | null;
  recentActivityDetail: string | null;
  matchStrategy: string | null;
  matchConfidence: string | null;
};

export type ContractorCard = {
  contactName: string;
  firmName: string | null;
  licenseNumber: string | null;
  role: string | null;
  isMonitored: boolean;
  anchorPermitIdentifiers: string[];
  anchorReferenceFiledDate: string | null;
  summary: { total: number; open: number; recentlyClosed: number; before: number; after: number };
  insight: {
    riskLevel: string;
    beforeBusyness: string | null;
    afterBusyness: string | null;
    summary: string;
    highlights: string[];
  } | null;
  permits: ContractorPermitView[];
};

export async function getPermitContactsInsights(env: Env): Promise<{
  contractors: ContractorCard[];
  target: { address: string; block: string | null; lot: string | null; latitude: string | null; longitude: string | null } | null;
}> {
  const db = drizzle(env.DB);
  const [contacts, activity, insights, propertyRows] = await Promise.all([
    db.select().from(permitsContacts).where(eq(permitsContacts.isMonitored, true)).all(),
    db.select().from(permitsContactActivity).orderBy(desc(permitsContactActivity.datetimeCreated)).all(),
    db.select().from(permitsContactInsights).all(),
    db.select().from(permitsRecords).where(eq(permitsRecords.isPropertyPermit, true)).all(),
  ]);

  const insightByName = new Map(insights.map((row) => [row.contactName, row]));
  const activityByName = new Map<string, typeof activity>();
  for (const row of activity) {
    const list = activityByName.get(row.contactName) || [];
    list.push(row);
    activityByName.set(row.contactName, list);
  }

  const parseJsonArray = (value: string | null): string[] => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
      return [];
    }
  };

  const contractors: ContractorCard[] = contacts.map((contact) => {
    const permitRows = activityByName.get(contact.contactName) || [];
    const permits: ContractorPermitView[] = permitRows.map((row) => ({
      trade: row.trade || row.dataset,
      permitNumber: row.permitNumber,
      permitType: row.permitType,
      permitStatus: row.permitStatus,
      statusCategory: row.statusCategory,
      filedDate: row.filedDate,
      issuedDate: row.issuedDate,
      closedDate: row.closedDate,
      isOpen: Boolean(row.isOpen),
      isRecentlyClosed: Boolean(row.isRecentlyClosed),
      relationToAnchor: row.relationToAnchor,
      latitude: row.latitude,
      longitude: row.longitude,
      propertyAddress: row.propertyAddress,
      block: row.block,
      lot: row.lot,
      recentActivityType: row.recentActivityType,
      recentActivityDate: row.recentActivityDate,
      recentActivityDetail: row.recentActivityDetail,
      matchStrategy: row.matchStrategy,
      matchConfidence: row.matchConfidence,
    }));

    const insightRow = insightByName.get(contact.contactName) || null;
    return {
      contactName: contact.contactName,
      firmName: contact.firmName,
      licenseNumber: contact.licenseNumber,
      role: contact.role,
      isMonitored: Boolean(contact.isMonitored),
      anchorPermitIdentifiers: parseJsonArray(contact.anchorPermitIdentifiers),
      anchorReferenceFiledDate: contact.anchorReferenceFiledDate,
      summary: {
        total: permits.length,
        open: permits.filter((p) => p.isOpen).length,
        recentlyClosed: permits.filter((p) => p.isRecentlyClosed).length,
        before: permits.filter((p) => p.relationToAnchor === "before").length,
        after: permits.filter((p) => p.relationToAnchor === "after" || p.relationToAnchor === "concurrent").length,
      },
      insight: insightRow
        ? {
            riskLevel: insightRow.riskLevel,
            beforeBusyness: insightRow.beforeBusyness,
            afterBusyness: insightRow.afterBusyness,
            summary: insightRow.summary,
            highlights: parseJsonArray(insightRow.highlights),
          }
        : null,
      permits,
    };
  });

  // Representative 126 Colby home marker (first target row with geo).
  const config = await getPermitsConfig(env);
  const geoRow = propertyRows.find((row) => row.latitude && row.longitude) || propertyRows[0] || null;
  const target = geoRow
    ? {
        address: config.targetAddress,
        block: geoRow.block,
        lot: geoRow.lot,
        latitude: geoRow.latitude,
        longitude: geoRow.longitude,
      }
    : { address: config.targetAddress, block: null, lot: null, latitude: null, longitude: null };

  return { contractors, target };
}
