import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  permitsContactActivity,
  permitsContactInsights,
  permitsContacts,
  permitsIdentifierViews,
  permitsRecordRevisions,
  permitsRecords,
  permitsSyncRuns,
  planningTaskUpdates,
  planningTasks,
} from "@backend/db";

type SodaRow = Record<string, unknown>;

type PermitDataset = {
  key: string;
  label: string;
  datasetId: string;
  includeInPropertySync: boolean;
  includeInContactSync: boolean;
};

type FieldMeta = {
  fieldName: string;
  displayName: string;
  normalized: string;
};

type DatasetMetadata = {
  fields: FieldMeta[];
};

type ExtractedPermitRow = {
  dataset: string;
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
  issuedDate: string | null;
  expiresDate: string | null;
  closedDate: string | null;
  latitude: string | null;
  longitude: string | null;
  isClosed: boolean;
  rawData: SodaRow;
};

type ContactInsightSummary = {
  riskLevel: "low" | "medium" | "high";
  summary: string;
  highlights: string[];
  metrics: Record<string, unknown>;
};

type PermitDetail = {
  permitIdentifier: string;
  needsReview: boolean;
  records: Array<typeof permitsRecords.$inferSelect>;
  revisions: Array<typeof permitsRecordRevisions.$inferSelect>;
  viewed: typeof permitsIdentifierViews.$inferSelect | null;
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
  }>;
  contactInsights: Array<typeof permitsContactInsights.$inferSelect>;
};

const SODA_HOST = "https://data.sfgov.org";
const SODA_PAGE_LIMIT = 1000;

const TARGET_ADDRESS = "126 Colby Street";
const TARGET_ZIP = "94134";
const TARGET_BLOCK_VARIANTS = ["0054", "54", "0050054"];
const TARGET_LOT_VARIANTS = ["009", "9"];

const CONTACT_EXCLUSIONS = ["mr roofing"];
const VOLATILE_ROW_KEYS = new Set([
  "data_loaded_at",
  "data_as_of",
  ":updated_at",
  ":created_at",
  ":id",
  ":version",
  ":position",
  ":@computed_region_jwn9_ihcz",
  ":@computed_region_yftq_j783",
  ":@computed_region_h4ep_8xdi",
  ":@computed_region_26cr_cadq",
  ":@computed_region_ajp5_b2md",
  ":@computed_region_n4xg_c4py",
  ":@computed_region_rxqg_mtj9",
  ":@computed_region_qgnn_b9vv",
  ":@computed_region_k4du-7f2p",
]);

const DATASETS: PermitDataset[] = [
  {
    key: "building_permits",
    label: "Building Permits",
    datasetId: "i98e-djp9",
    includeInPropertySync: true,
    includeInContactSync: true,
  },
  {
    key: "building_permit_contacts",
    label: "Building Permit Contacts",
    datasetId: "3pee-9qhc",
    includeInPropertySync: true,
    includeInContactSync: true,
  },
  {
    key: "building_addenda",
    label: "Building Permit Addenda",
    datasetId: "87xy-gk8d",
    includeInPropertySync: true,
    includeInContactSync: true,
  },
  {
    key: "electrical_permits",
    label: "Electrical Permits",
    datasetId: "ftty-kx6y",
    includeInPropertySync: true,
    includeInContactSync: true,
  },
  {
    key: "plumbing_permits",
    label: "Plumbing Permits",
    datasetId: "a6aw-rudh",
    includeInPropertySync: true,
    includeInContactSync: true,
  },
  {
    key: "complaints",
    label: "Code Enforcement Complaints",
    datasetId: "nyek-jaw8",
    includeInPropertySync: true,
    includeInContactSync: true,
  },
];

const metadataCache = new Map<string, DatasetMetadata | null>();

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeAddress(value: string | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\bst\b/g, "street")
    .replace(/\bave\b/g, "avenue")
    .replace(/\brd\b/g, "road")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function chunkArray<T>(values: T[], size: number): T[][];
function chunkArray<T>(values: T[], size: number): Array<Array<T>> {
  if (size <= 0) return [values];
  const chunks: Array<Array<T>> = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }
  if (!isObject(value)) {
    return value;
  }
  const sortedEntries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableSortObject(entry)] as const);
  return Object.fromEntries(sortedEntries);
}

function pruneVolatileRow(row: SodaRow): SodaRow {
  const next: SodaRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (VOLATILE_ROW_KEYS.has(key.toLowerCase())) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const parts = Array.from(new Uint8Array(digest));
  return parts.map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

function statusToCategory(status: string | null): string | null {
  if (!status) return null;
  const normalized = normalizeText(status);
  if (
    normalized.includes("closed") ||
    normalized.includes("complete") ||
    normalized.includes("completed") ||
    normalized.includes("final")
  ) {
    return "completed";
  }
  if (
    normalized.includes("issued") ||
    normalized.includes("approved") ||
    normalized.includes("active") ||
    normalized.includes("in progress") ||
    normalized.includes("inspection")
  ) {
    return "in_progress";
  }
  if (normalized.includes("pending") || normalized.includes("submitted") || normalized.includes("review")) {
    return "pending";
  }
  if (normalized.includes("cancel") || normalized.includes("void") || normalized.includes("deny")) {
    return "cancelled";
  }
  return "other";
}

function isClosedStatus(statusCategory: string | null, closedDate: string | null): boolean {
  if (closedDate) return true;
  return statusCategory === "completed" || statusCategory === "cancelled";
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function coerceLatLong(value: string | null): string | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(6);
}

function findFieldName(fields: FieldMeta[], patterns: string[]): string | null {
  const normalizedPatterns = patterns.map((pattern) => normalizeKey(pattern));
  for (const field of fields) {
    if (normalizedPatterns.some((pattern) => field.normalized.includes(pattern))) {
      return field.fieldName;
    }
  }
  return null;
}

function extractFieldValue(row: SodaRow, fields: FieldMeta[], patterns: string[]): string | null {
  const fieldName = findFieldName(fields, patterns);
  if (fieldName && row[fieldName] !== undefined) {
    return toNullableString(row[fieldName]);
  }
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key);
    if (patterns.some((pattern) => normalized.includes(normalizeKey(pattern)))) {
      const resolved = toNullableString(value);
      if (resolved) return resolved;
    }
  }
  return null;
}

function buildStreetAddress(row: SodaRow, fields: FieldMeta[]): string | null {
  const explicit = extractFieldValue(row, fields, [
    "address",
    "property_address",
    "street_address",
    "location",
    "job_address",
    "jobsite_address",
  ]);
  if (explicit) return explicit;

  const streetNumber = extractFieldValue(row, fields, ["street_number", "house_number"]);
  const streetNumberSuffix = extractFieldValue(row, fields, ["street_number_suffix"]);
  const streetName = extractFieldValue(row, fields, ["street_name"]);
  const streetSuffix = extractFieldValue(row, fields, ["street_suffix"]);
  const unit = extractFieldValue(row, fields, ["unit", "unit_number", "apt"]);
  const unitSuffix = extractFieldValue(row, fields, ["unit_suffix"]);

  const parts = [
    streetNumber,
    streetNumberSuffix,
    streetName,
    streetSuffix,
    unit ? `Unit ${unit}` : null,
    unitSuffix,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();

  return parts.length > 0 ? parts : null;
}

function buildRecordKey(datasetKey: string, row: ExtractedPermitRow): string {
  const idCandidate =
    row.permitIdentifier ||
    row.applicationNumber ||
    row.permitNumber ||
    row.propertyAddress ||
    JSON.stringify(stableSortObject(pruneVolatileRow(row.rawData)));
  return `${datasetKey}:${idCandidate}`;
}

function normalizeBlockLot(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

function isTargetPropertyMatch(row: ExtractedPermitRow): boolean {
  const normalizedAddress = normalizeAddress(row.propertyAddress);
  const targetAddress = normalizeAddress(TARGET_ADDRESS);
  const addressMatches =
    normalizedAddress.includes(targetAddress) ||
    normalizedAddress.includes(normalizeAddress("126 colby st")) ||
    normalizedAddress.includes("126 colby");

  const block = normalizeBlockLot(row.block);
  const lot = normalizeBlockLot(row.lot);
  const blockMatches = block ? TARGET_BLOCK_VARIANTS.map(normalizeBlockLot).includes(block) : false;
  const lotMatches = lot ? TARGET_LOT_VARIANTS.map(normalizeBlockLot).includes(lot) : false;

  return addressMatches || (blockMatches && lotMatches);
}

function shouldExcludeContact(contactName: string): boolean {
  const normalized = normalizeText(contactName);
  return CONTACT_EXCLUSIONS.some((token) => normalized.includes(token));
}

function getContactActivityWindowStartIso(): string {
  const now = new Date();
  const priorYear = new Date(now);
  priorYear.setDate(now.getDate() - 365);
  return priorYear.toISOString();
}

function getYearStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0)).toISOString();
}

function simplifyRunPayload(payload: unknown): string {
  if (!payload) return "[]";
  try {
    const json = JSON.stringify(payload);
    if (json.length <= 50000) {
      return json;
    }
    return JSON.stringify({ truncated: true, sample: json.slice(0, 50000) });
  } catch {
    return JSON.stringify({ truncated: true, reason: "serialize_failed" });
  }
}

function toFieldMeta(value: unknown): FieldMeta[] {
  if (!Array.isArray(value)) return [];
  const rows: FieldMeta[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const fieldName = toNullableString(entry.fieldName);
    if (!fieldName) continue;
    const displayName = toNullableString(entry.name) || fieldName;
    rows.push({
      fieldName,
      displayName,
      normalized: normalizeKey(`${fieldName} ${displayName}`),
    });
  }
  return rows;
}

async function fetchDatasetMetadata(datasetId: string): Promise<DatasetMetadata | null> {
  if (metadataCache.has(datasetId)) {
    return metadataCache.get(datasetId) || null;
  }
  try {
    const response = await fetch(`${SODA_HOST}/api/views/${datasetId}.json`);
    if (!response.ok) {
      metadataCache.set(datasetId, null);
      return null;
    }
    const payload = (await response.json()) as { columns?: unknown };
    const metadata: DatasetMetadata = {
      fields: toFieldMeta(payload.columns),
    };
    metadataCache.set(datasetId, metadata);
    return metadata;
  } catch {
    metadataCache.set(datasetId, null);
    return null;
  }
}

async function fetchSodaRows(
  datasetId: string,
  params: Record<string, string>,
  maxRows = 3000,
): Promise<SodaRow[]> {
  const rows: SodaRow[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < maxRows) {
    const url = new URL(`${SODA_HOST}/resource/${datasetId}.json`);
    for (const [key, value] of Object.entries(params)) {
      if (!value) continue;
      url.searchParams.set(key, value);
    }
    url.searchParams.set("$limit", String(Math.min(SODA_PAGE_LIMIT, maxRows - offset)));
    url.searchParams.set("$offset", String(offset));

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`SODA ${datasetId} request failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    for (const entry of payload) {
      if (!isObject(entry)) continue;
      const stringified = JSON.stringify(entry);
      if (seen.has(stringified)) continue;
      seen.add(stringified);
      rows.push(entry);
    }

    if (payload.length < SODA_PAGE_LIMIT) {
      break;
    }

    offset += payload.length;
  }

  return rows;
}

function buildPropertyWhereClause(metadata: DatasetMetadata | null): string | null {
  if (!metadata || metadata.fields.length === 0) {
    return null;
  }

  const addressField =
    findFieldName(metadata.fields, [
      "property_address",
      "street_address",
      "address",
      "job_address",
      "jobsite_address",
      "location",
    ]) || null;
  const blockField = findFieldName(metadata.fields, ["block"]);
  const lotField = findFieldName(metadata.fields, ["lot"]);
  const zipField = findFieldName(metadata.fields, ["zip", "zipcode", "postal_code"]);

  const clauses: string[] = [];
  if (addressField) {
    clauses.push(`lower(\`${addressField}\`) like '%${escapeSoqlLiteral(normalizeAddress(TARGET_ADDRESS))}%'`);
    clauses.push(`lower(\`${addressField}\`) like '%126 colby%'`);
  }
  if (blockField && lotField) {
    const blockClauses = TARGET_BLOCK_VARIANTS.map(
      (value) => `\`${blockField}\` = '${escapeSoqlLiteral(value)}'`,
    );
    const lotClauses = TARGET_LOT_VARIANTS.map(
      (value) => `\`${lotField}\` = '${escapeSoqlLiteral(value)}'`,
    );
    clauses.push(`((${blockClauses.join(" OR ")}) AND (${lotClauses.join(" OR ")}))`);
  }
  if (zipField) {
    clauses.push(`\`${zipField}\` = '${escapeSoqlLiteral(TARGET_ZIP)}'`);
  }

  if (clauses.length === 0) {
    return null;
  }

  return clauses.join(" OR ");
}

async function queryPropertyRows(dataset: PermitDataset): Promise<SodaRow[]> {
  const metadata = await fetchDatasetMetadata(dataset.datasetId);
  const whereClause = buildPropertyWhereClause(metadata);

  if (whereClause) {
    try {
      return await fetchSodaRows(
        dataset.datasetId,
        {
          $where: whereClause,
          $order: ":id DESC",
        },
        5000,
      );
    } catch {
      // Fall back to full-text search below.
    }
  }

  const searchTerms = ["126 Colby Street", "126 Colby", "0054 009", "0050054 009"];
  const rows: SodaRow[] = [];
  const seen = new Set<string>();

  for (const term of searchTerms) {
    const termRows = await fetchSodaRows(dataset.datasetId, { $q: term, $order: ":id DESC" }, 1500);
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
  datasetKey: string,
  row: SodaRow,
  metadata: DatasetMetadata | null,
): ExtractedPermitRow {
  const fields = metadata?.fields || [];
  const permitNumber = extractFieldValue(row, fields, [
    "permit_number",
    "permit_no",
    "permitnumber",
    "permit",
  ]);
  const applicationNumber = extractFieldValue(row, fields, [
    "application_number",
    "application_no",
    "applicationnumber",
    "application",
  ]);
  const permitIdentifier = permitNumber || applicationNumber;
  const permitType = extractFieldValue(row, fields, [
    "permit_type",
    "type_of_work",
    "permit_type_definition",
    "permit_type_desc",
    "permit_type_name",
    "category",
  ]);
  const permitStatus = extractFieldValue(row, fields, [
    "status",
    "permit_status",
    "current_status",
    "application_status",
    "case_status",
    "disposition",
  ]);
  const statusCategory = statusToCategory(permitStatus);
  const propertyAddress = buildStreetAddress(row, fields);
  const block = extractFieldValue(row, fields, ["block"]);
  const lot = extractFieldValue(row, fields, ["lot"]);
  const contactName = extractFieldValue(row, fields, [
    "contact_name",
    "contractor_name",
    "applicant_name",
    "company_name",
    "owner_name",
    "permit_contact_name",
  ]);
  const contactRole = extractFieldValue(row, fields, [
    "contact_role",
    "contact_type",
    "role",
    "applicant_role",
    "contact_description",
  ]);
  const issuedDate = extractFieldValue(row, fields, ["issued_date", "issue_date", "approved_date"]);
  const expiresDate = extractFieldValue(row, fields, ["expires_date", "expiration_date"]);
  const closedDate = extractFieldValue(row, fields, [
    "completed_date",
    "closed_date",
    "completion_date",
    "finaled_date",
    "status_date",
  ]);
  const latitude = coerceLatLong(
    extractFieldValue(row, fields, ["latitude", "lat", "y", "location_latitude"]),
  );
  const longitude = coerceLatLong(
    extractFieldValue(row, fields, ["longitude", "lon", "lng", "x", "location_longitude"]),
  );
  const isClosed = isClosedStatus(statusCategory, closedDate);

  const extracted: ExtractedPermitRow = {
    dataset: datasetKey,
    recordKey: "",
    permitIdentifier,
    applicationNumber,
    permitNumber,
    permitType,
    permitStatus,
    statusCategory,
    propertyAddress,
    block,
    lot,
    contactName,
    contactRole,
    issuedDate,
    expiresDate,
    closedDate,
    latitude,
    longitude,
    isClosed,
    rawData: row,
  };
  extracted.recordKey = buildRecordKey(datasetKey, extracted);
  return extracted;
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

async function persistPropertyRecords(
  env: Env,
  dataset: PermitDataset,
  runId: string,
  rows: ExtractedPermitRow[],
): Promise<void> {
  const db = drizzle(env.DB);
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const sanitizedRaw = pruneVolatileRow(row.rawData);
      const changeSeed = stableSortObject({
        dataset: row.dataset,
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
        issuedDate: row.issuedDate,
        expiresDate: row.expiresDate,
        closedDate: row.closedDate,
        latitude: row.latitude,
        longitude: row.longitude,
        isClosed: row.isClosed,
        rawData: sanitizedRaw,
      });
      const changeHash = await sha256(JSON.stringify(changeSeed));

      const existing = await tx
        .select()
        .from(permitsRecords)
        .where(eq(permitsRecords.recordKey, row.recordKey))
        .get();

      const changed = !existing || existing.changeHash !== changeHash;
      const now = new Date();

      const values = {
        id: existing?.id || crypto.randomUUID(),
        dataset: dataset.key,
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
        issuedDate: row.issuedDate,
        expiresDate: row.expiresDate,
        closedDate: row.closedDate,
        latitude: row.latitude,
        longitude: row.longitude,
        isPropertyPermit: isTargetPropertyMatch(row),
        isClosed: row.isClosed,
        changeHash,
        lastChangedAt: changed ? now : existing?.lastChangedAt || null,
        latestRunId: runId,
        rawData: JSON.stringify(sanitizedRaw),
        datetimeUpdated: now,
      };

      await tx
        .insert(permitsRecords)
        .values({
          ...values,
          datetimeCreated: existing?.datetimeCreated || now,
        })
        .onConflictDoUpdate({
          target: permitsRecords.recordKey,
          set: values,
        })
        .run();

      await tx
        .insert(permitsRecordRevisions)
        .values({
          id: crypto.randomUUID(),
          runId,
          dataset: dataset.key,
          recordKey: row.recordKey,
          permitNumber: row.permitNumber,
          permitStatus: row.permitStatus,
          rawData: JSON.stringify(sanitizedRaw),
        })
        .run();
    }
  });
}

async function refreshPermitContacts(env: Env): Promise<Array<typeof permitsContacts.$inferSelect>> {
  const db = drizzle(env.DB);
  const propertyRows = await db
    .select()
    .from(permitsRecords)
    .where(eq(permitsRecords.isPropertyPermit, true))
    .all();

  const tally = new Map<
    string,
    {
      activeCount: number;
      closedCount: number;
      metadata: {
        roles: Set<string>;
        permitIdentifiers: Set<string>;
      };
    }
  >();

  for (const row of propertyRows) {
    const contactName = row.contactName?.trim();
    if (!contactName) continue;

    const existing = tally.get(contactName) || {
      activeCount: 0,
      closedCount: 0,
      metadata: { roles: new Set<string>(), permitIdentifiers: new Set<string>() },
    };

    if (row.isClosed) {
      existing.closedCount += 1;
    } else {
      existing.activeCount += 1;
    }
    if (row.contactRole) {
      existing.metadata.roles.add(row.contactRole);
    }
    if (row.permitIdentifier) {
      existing.metadata.permitIdentifiers.add(row.permitIdentifier);
    }

    tally.set(contactName, existing);
  }

  for (const [contactName, stats] of tally.entries()) {
    const existing = await db
      .select()
      .from(permitsContacts)
      .where(eq(permitsContacts.contactName, contactName))
      .get();
    const monitorEligible =
      stats.activeCount > 0 && !shouldExcludeContact(contactName);

    const metadata = JSON.stringify({
      roles: Array.from(stats.metadata.roles.values()),
      permitIdentifiers: Array.from(stats.metadata.permitIdentifiers.values()),
    });
    const now = new Date();

    await db
      .insert(permitsContacts)
      .values({
        contactName,
        isMonitored: monitorEligible,
        activePropertyPermitCount: stats.activeCount,
        closedPropertyPermitCount: stats.closedCount,
        metadata,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: permitsContacts.contactName,
        set: {
          isMonitored: monitorEligible,
          activePropertyPermitCount: stats.activeCount,
          closedPropertyPermitCount: stats.closedCount,
          metadata,
          lastSeenAt: now,
        },
      })
      .run();
  }

  return db.select().from(permitsContacts).orderBy(desc(permitsContacts.lastSeenAt)).all();
}

function getIdentifiersForContact(
  rows: Array<typeof permitsRecords.$inferSelect>,
  contactName: string,
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if ((row.contactName || "").trim() !== contactName) continue;
    if (row.permitIdentifier) set.add(row.permitIdentifier);
    if (row.applicationNumber) set.add(row.applicationNumber);
    if (row.permitNumber) set.add(row.permitNumber);
  }
  return Array.from(set.values()).filter(Boolean);
}

function buildIdentifierWhere(
  metadata: DatasetMetadata | null,
  identifiers: string[],
): string | null {
  if (!metadata || identifiers.length === 0) return null;
  const permitField = findFieldName(metadata.fields, ["permit_number", "permit_no", "permitnumber", "permit"]);
  const applicationField = findFieldName(metadata.fields, [
    "application_number",
    "application_no",
    "applicationnumber",
    "application",
  ]);

  const escaped = identifiers.map((value) => `'${escapeSoqlLiteral(value)}'`);
  const clauses: string[] = [];
  if (permitField) {
    clauses.push(`\`${permitField}\` in (${escaped.join(",")})`);
  }
  if (applicationField) {
    clauses.push(`\`${applicationField}\` in (${escaped.join(",")})`);
  }

  if (clauses.length === 0) return null;
  return clauses.join(" OR ");
}

function extractContactField(metadata: DatasetMetadata | null): string | null {
  if (!metadata) return null;
  return (
    findFieldName(metadata.fields, [
      "contact_name",
      "contractor_name",
      "applicant_name",
      "company_name",
      "owner_name",
      "permit_contact_name",
    ]) || null
  );
}

function buildContactWhere(metadata: DatasetMetadata | null, contactName: string): string | null {
  const contactField = extractContactField(metadata);
  if (!contactField) return null;
  return `lower(\`${contactField}\`) = '${escapeSoqlLiteral(normalizeText(contactName))}'`;
}

function isWithinMonitoringWindow(
  row: ExtractedPermitRow,
  startIso: string,
  yearStartIso: string,
): boolean {
  const issued = parseDate(row.issuedDate);
  const closed = parseDate(row.closedDate);
  const start = new Date(startIso);
  const ytd = new Date(yearStartIso);

  if (issued && (issued >= start || issued >= ytd)) return true;
  if (closed && (closed >= start || closed >= ytd)) return true;
  return !issued && !closed;
}

async function clearContactActivityForContacts(env: Env, contactNames: string[]): Promise<void> {
  if (contactNames.length === 0) return;
  const db = drizzle(env.DB);
  await db
    .delete(permitsContactActivity)
    .where(inArray(permitsContactActivity.contactName, contactNames))
    .run();
}

async function syncContactActivity(
  env: Env,
  contactRows: Array<typeof permitsContacts.$inferSelect>,
): Promise<void> {
  const db = drizzle(env.DB);
  const monitoredContacts = contactRows.filter((row) => Boolean(row.isMonitored));
  if (monitoredContacts.length === 0) {
    return;
  }

  const propertyRows = await db
    .select()
    .from(permitsRecords)
    .where(eq(permitsRecords.isPropertyPermit, true))
    .all();

  const monitoredContactNames = monitoredContacts.map((row) => row.contactName);
  await clearContactActivityForContacts(env, monitoredContactNames);

  const windowStartIso = getContactActivityWindowStartIso();
  const yearStartIso = getYearStartIso();
  await Promise.all(
    monitoredContacts.map(async (contact) => {
      const identifiers = getIdentifiersForContact(propertyRows, contact.contactName);
      const datasetsToSync = DATASETS.filter((row) => row.includeInContactSync);
      const seenKeys = new Set<string>();

      const datasetResults = await Promise.all(
        datasetsToSync.map(async (dataset) => {
          const metadata = await fetchDatasetMetadata(dataset.datasetId);
          const identifierChunks = chunkArray(identifiers, 40);
          const chunks = identifierChunks.length > 0 ? identifierChunks : [[]];

          const chunkRows = await Promise.all(
            chunks.map(async (chunk) => {
              const whereByIdentifier = buildIdentifierWhere(metadata, chunk);
              try {
                const rawRows = whereByIdentifier
                  ? await fetchSodaRows(
                      dataset.datasetId,
                      {
                        $where: whereByIdentifier,
                        $order: ":id DESC",
                      },
                      2000,
                    )
                  : await (async () => {
                      const whereByContact = buildContactWhere(metadata, contact.contactName);
                      if (whereByContact) {
                        return fetchSodaRows(
                          dataset.datasetId,
                          {
                            $where: whereByContact,
                            $order: ":id DESC",
                          },
                          2000,
                        );
                      }
                      return fetchSodaRows(
                        dataset.datasetId,
                        {
                          $q: contact.contactName,
                          $order: ":id DESC",
                        },
                        1200,
                      );
                    })();

                return rawRows
                  .map((row) => extractPermitRow(dataset.key, row, metadata))
                  .filter((row) => isWithinMonitoringWindow(row, windowStartIso, yearStartIso));
              } catch {
                return [] as ExtractedPermitRow[];
              }
            }),
          );

          const dedupedRows: ExtractedPermitRow[] = [];
          for (const extractedRows of chunkRows) {
            for (const row of extractedRows) {
              const key = `${contact.contactName}:${row.recordKey}`;
              if (seenKeys.has(key)) continue;
              seenKeys.add(key);
              dedupedRows.push(row);
            }
          }

          return {
            dataset,
            rows: dedupedRows,
          };
        }),
      );

      await Promise.all(
        datasetResults.map(async ({ dataset, rows }) => {
          const runId = await createSyncRun(env, {
            runType: "contact",
            queryLabel: `${contact.contactName} ${dataset.label} activity`,
            sourceDataset: dataset.datasetId,
            status: "success",
            resultCount: rows.length,
            aiSummary: `Tracked ${contact.contactName} against ${dataset.label}.`,
            rawPayload: rows.slice(0, 20).map((row) => row.rawData),
          });

          if (rows.length === 0) {
            return;
          }

          await db.transaction(async (tx) => {
            for (const row of rows) {
              await tx
                .insert(permitsContactActivity)
                .values({
                  id: crypto.randomUUID(),
                  contactName: contact.contactName,
                  dataset: row.dataset,
                  recordKey: row.recordKey,
                  permitIdentifier: row.permitIdentifier,
                  applicationNumber: row.applicationNumber,
                  permitNumber: row.permitNumber,
                  permitType: row.permitType,
                  permitStatus: row.permitStatus,
                  statusCategory: row.statusCategory,
                  propertyAddress: row.propertyAddress,
                  issuedDate: row.issuedDate,
                  closedDate: row.closedDate,
                  latitude: row.latitude,
                  longitude: row.longitude,
                  runId,
                  rawData: JSON.stringify(pruneVolatileRow(row.rawData)),
                })
                .run();
            }
          });
        }),
      );
    }),
  );
}

async function computeOverdueTaskSignals(env: Env): Promise<{
  overdueTasks: number;
  overdueByResponsible: Map<string, number>;
}> {
  const db = drizzle(env.DB);
  const today = new Date();
  const tasks = await db
    .select()
    .from(planningTasks)
    .where(
      and(
        or(
          eq(planningTasks.status, "pending"),
          eq(planningTasks.status, "in_progress"),
          eq(planningTasks.status, "blocked"),
          eq(planningTasks.status, "delayed"),
        ),
        sql`${planningTasks.dueDate} IS NOT NULL`,
      ),
    )
    .all();

  const updates = await db
    .select()
    .from(planningTaskUpdates)
    .orderBy(desc(planningTaskUpdates.datetimeCreated))
    .all();
  const latestUpdateByTask = new Map<string, typeof planningTaskUpdates.$inferSelect>();
  for (const update of updates) {
    if (!latestUpdateByTask.has(update.taskId)) {
      latestUpdateByTask.set(update.taskId, update);
    }
  }

  const overdueByResponsible = new Map<string, number>();
  let overdueTasks = 0;

  for (const task of tasks) {
    const due = task.dueDate ? new Date(task.dueDate) : null;
    if (!due || Number.isNaN(due.getTime()) || due >= today) continue;

    const latest = latestUpdateByTask.get(task.id);
    if (latest?.status === "done") continue;

    overdueTasks += 1;
    const ownerKey = task.responsibleParticipantId
      ? String(task.responsibleParticipantId)
      : "unassigned";
    overdueByResponsible.set(ownerKey, (overdueByResponsible.get(ownerKey) || 0) + 1);
  }

  return { overdueTasks, overdueByResponsible };
}

function parseActivityRowsForContact(
  rows: Array<typeof permitsContactActivity.$inferSelect>,
  contactName: string,
): Array<typeof permitsContactActivity.$inferSelect> {
  return rows.filter((row) => row.contactName === contactName);
}

function computeContactMetrics(
  rows: Array<typeof permitsContactActivity.$inferSelect>,
  contactName: string,
): {
  openCount: number;
  inProgressCount: number;
  pendingCount: number;
  completedCount: number;
  averageCloseDays: number | null;
  permitTypes: Array<{ permitType: string; averageCloseDays: number | null; count: number }>;
  latLngPoints: Array<{ latitude: number; longitude: number; statusCategory: string; propertyAddress: string | null }>;
} {
  const contactRows = parseActivityRowsForContact(rows, contactName);

  let openCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let completedCount = 0;

  const closeDurations: number[] = [];
  const byType = new Map<string, number[]>();
  const latLngPoints: Array<{
    latitude: number;
    longitude: number;
    statusCategory: string;
    propertyAddress: string | null;
  }> = [];

  for (const row of contactRows) {
    const statusCategory = row.statusCategory || "other";
    if (statusCategory === "completed") {
      completedCount += 1;
    } else if (statusCategory === "in_progress") {
      inProgressCount += 1;
      openCount += 1;
    } else if (statusCategory === "pending") {
      pendingCount += 1;
      openCount += 1;
    } else {
      openCount += 1;
    }

    const issued = parseDate(row.issuedDate);
    const closed = parseDate(row.closedDate);
    if (issued && closed && closed >= issued) {
      const days = Math.max(1, Math.round((closed.getTime() - issued.getTime()) / (1000 * 60 * 60 * 24)));
      closeDurations.push(days);
      const key = (row.permitType || "Unknown").trim() || "Unknown";
      const existing = byType.get(key) || [];
      existing.push(days);
      byType.set(key, existing);
    }

    const latitude = Number.parseFloat(row.latitude || "");
    const longitude = Number.parseFloat(row.longitude || "");
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      latLngPoints.push({
        latitude,
        longitude,
        statusCategory,
        propertyAddress: row.propertyAddress || null,
      });
    }
  }

  const averageCloseDays =
    closeDurations.length > 0
      ? Math.round(closeDurations.reduce((sum, value) => sum + value, 0) / closeDurations.length)
      : null;

  const permitTypes = Array.from(byType.entries()).map(([permitType, durations]) => ({
    permitType,
    averageCloseDays:
      durations.length > 0
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
    count: durations.length,
  }));

  return {
    openCount,
    inProgressCount,
    pendingCount,
    completedCount,
    averageCloseDays,
    permitTypes,
    latLngPoints,
  };
}

async function generateContactInsight(
  env: Env,
  contactName: string,
  metrics: ReturnType<typeof computeContactMetrics>,
  overdueSignalCount: number,
): Promise<ContactInsightSummary> {
  const prompt = [
    `You are analyzing contractor permit workload risk for ${contactName}.`,
    "Return strict JSON with keys riskLevel, summary, highlights.",
    `Open permits: ${metrics.openCount}`,
    `In-progress permits: ${metrics.inProgressCount}`,
    `Pending permits: ${metrics.pendingCount}`,
    `Completed permits: ${metrics.completedCount}`,
    `Average close days: ${metrics.averageCloseDays ?? "unknown"}`,
    `Overdue tasks in homeowner tracker linked to contractor activity: ${overdueSignalCount}`,
    `Permit-type close durations: ${metrics.permitTypes
      .map((entry) => `${entry.permitType}=${entry.averageCloseDays ?? "n/a"} days`)
      .join(", ") || "none"}`,
    "If overdue tasks are non-zero and contractor has active work elsewhere, risk should be medium or high.",
  ].join("\n");

  try {
    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You output concise JSON only. riskLevel must be one of low, medium, high. highlights must be an array of 2-5 strings.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 700,
    });

    const rawText =
      isObject(response) && typeof response.response === "string"
        ? response.response
        : JSON.stringify(response);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : null;

    if (parsed) {
      const riskLevelRaw =
        typeof parsed.riskLevel === "string" ? normalizeText(parsed.riskLevel) : "medium";
      const riskLevel =
        riskLevelRaw === "low" || riskLevelRaw === "high" || riskLevelRaw === "medium"
          ? (riskLevelRaw as "low" | "medium" | "high")
          : "medium";
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Permit activity was analyzed for current workload pressure.";
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 5)
        : [];

      return {
        riskLevel,
        summary,
        highlights,
        metrics: {
          ...metrics,
          overdueSignalCount,
        },
      };
    }
  } catch {
    // Heuristic fallback below.
  }

  const riskLevel: "low" | "medium" | "high" =
    overdueSignalCount > 3 && metrics.openCount > 4
      ? "high"
      : overdueSignalCount > 0 || metrics.openCount > 6
        ? "medium"
        : "low";

  const highlights = [
    `Open permits: ${metrics.openCount}, completed permits: ${metrics.completedCount}.`,
    metrics.averageCloseDays
      ? `Average close time is about ${metrics.averageCloseDays} days.`
      : "Average close time is not available yet.",
    overdueSignalCount > 0
      ? `There are ${overdueSignalCount} overdue project task(s) to monitor against contractor activity.`
      : "No overdue tracker tasks are currently linked to this contractor signal set.",
  ];

  return {
    riskLevel,
    summary:
      riskLevel === "high"
        ? "Contractor appears overextended against current homeowner deadlines."
        : riskLevel === "medium"
          ? "Contractor workload is active; continue monitoring timeline alignment."
          : "Contractor workload appears manageable relative to current project signals.",
    highlights,
    metrics: {
      ...metrics,
      overdueSignalCount,
    },
  };
}

async function refreshContactInsights(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const contactRows = await db.select().from(permitsContacts).all();
  const activityRows = await db.select().from(permitsContactActivity).all();
  const overdueSignals = await computeOverdueTaskSignals(env);
  const monitoredContacts = contactRows.filter((contact) => Boolean(contact.isMonitored));

  await Promise.all(
    monitoredContacts.map(async (contact) => {
      const metrics = computeContactMetrics(activityRows, contact.contactName);
      const insight = await generateContactInsight(
        env,
        contact.contactName,
        metrics,
        overdueSignals.overdueTasks,
      );

      const existing = await db
        .select()
        .from(permitsContactInsights)
        .where(eq(permitsContactInsights.contactName, contact.contactName))
        .get();

      const now = new Date();
      await db
        .insert(permitsContactInsights)
        .values({
          id: existing?.id || crypto.randomUUID(),
          contactName: contact.contactName,
          riskLevel: insight.riskLevel,
          summary: insight.summary,
          highlights: JSON.stringify(insight.highlights),
          metrics: JSON.stringify(insight.metrics),
          model: "@cf/meta/llama-3.1-8b-instruct",
          lastRunId: null,
          datetimeCreated: existing?.datetimeCreated || now,
          datetimeUpdated: now,
        })
        .onConflictDoUpdate({
          target: permitsContactInsights.contactName,
          set: {
            riskLevel: insight.riskLevel,
            summary: insight.summary,
            highlights: JSON.stringify(insight.highlights),
            metrics: JSON.stringify(insight.metrics),
            model: "@cf/meta/llama-3.1-8b-instruct",
            datetimeUpdated: now,
          },
        })
        .run();
    }),
  );
}

export async function runPermitSync(env: Env): Promise<{
  success: boolean;
  summary: {
    propertyRecords: number;
    monitoredContacts: number;
    contactActivity: number;
  };
}> {
  const db = drizzle(env.DB);
  let propertyRecordCount = 0;

  for (const dataset of DATASETS.filter((row) => row.includeInPropertySync)) {
    try {
      const metadata = await fetchDatasetMetadata(dataset.datasetId);
      const rows = await queryPropertyRows(dataset);
      const normalizedRows = rows
        .map((row) => extractPermitRow(dataset.key, row, metadata))
        .filter((row) => isTargetPropertyMatch(row));
      propertyRecordCount += normalizedRows.length;

      const runId = await createSyncRun(env, {
        runType: "property",
        queryLabel: `${dataset.label} for ${TARGET_ADDRESS}`,
        sourceDataset: dataset.datasetId,
        status: "success",
        resultCount: normalizedRows.length,
        aiSummary: `Fetched ${normalizedRows.length} ${dataset.label} rows for target property.`,
        rawPayload: normalizedRows.slice(0, 20).map((row) => row.rawData),
      });

      await persistPropertyRecords(env, dataset, runId, normalizedRows);
    } catch (error) {
      await createSyncRun(env, {
        runType: "property",
        queryLabel: `${dataset.label} for ${TARGET_ADDRESS}`,
        sourceDataset: dataset.datasetId,
        status: "error",
        resultCount: 0,
        errorText: error instanceof Error ? error.message : "Unknown sync error",
        rawPayload: null,
      });
    }
  }

  const contacts = await refreshPermitContacts(env);
  await syncContactActivity(env, contacts);
  await refreshContactInsights(env);

  const monitoredContacts = contacts.filter((row) => Boolean(row.isMonitored));
  const contactActivityCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(permitsContactActivity)
    .get()
    .then((row) => Number(row?.count || 0));

  return {
    success: true,
    summary: {
      propertyRecords: propertyRecordCount,
      monitoredContacts: monitoredContacts.length,
      contactActivity: contactActivityCount,
    },
  };
}

async function hydratePropertyPermitRows(
  env: Env,
): Promise<
  Array<{
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
  }>
> {
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
      new Set(
        permitRows
          .map((row) => row.contactName?.trim() || "")
          .filter(Boolean),
      ),
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
    };
  });
}

export async function getPermitDashboard(env: Env): Promise<PermitsDashboard> {
  const db = drizzle(env.DB);

  const [latestRuns, latestRecords, contacts, contactActivity, contactInsights, propertyPermits] =
    await Promise.all([
      db.select().from(permitsSyncRuns).orderBy(desc(permitsSyncRuns.datetimeCreated)).limit(100).all(),
      db
        .select()
        .from(permitsRecords)
        .orderBy(desc(permitsRecords.datetimeUpdated))
        .limit(300)
        .all(),
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

  return {
    latestRuns,
    latestRecords,
    contacts,
    contactActivity,
    propertyPermits,
    contactInsights,
  };
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

  if (records.length === 0) {
    return null;
  }

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

  return {
    permitIdentifier: normalized,
    needsReview,
    records,
    revisions,
    viewed: viewed || null,
  };
}

export async function markPermitViewed(
  env: Env,
  permitIdentifier: string,
): Promise<{ success: boolean; permitIdentifier: string }> {
  const db = drizzle(env.DB);
  const normalized = permitIdentifier.trim();
  if (!normalized) {
    throw new Error("permitIdentifier is required");
  }

  const latest = await db
    .select()
    .from(permitsRecords)
    .where(eq(permitsRecords.permitIdentifier, normalized))
    .orderBy(desc(permitsRecords.datetimeUpdated))
    .get();
  if (!latest) {
    throw new Error("Permit not found");
  }

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

export async function getPermitContactsInsights(env: Env): Promise<{
  contacts: Array<typeof permitsContacts.$inferSelect>;
  insights: Array<typeof permitsContactInsights.$inferSelect>;
  activity: Array<typeof permitsContactActivity.$inferSelect>;
  contractorCards: Array<{
    contactName: string;
    isMonitored: boolean;
    activePropertyPermitCount: number;
    closedPropertyPermitCount: number;
    workload: {
      open: number;
      inProgress: number;
      pending: number;
      completed: number;
    };
    averageCloseDays: number | null;
    averageCloseDaysByType: Array<{ permitType: string; averageCloseDays: number | null; count: number }>;
    mapPoints: Array<{ latitude: number; longitude: number; statusCategory: string; propertyAddress: string | null }>;
    insight: {
      riskLevel: string;
      summary: string;
      highlights: string[];
      metrics: Record<string, unknown> | null;
    } | null;
  }>;
}> {
  const db = drizzle(env.DB);
  const [contacts, insights, activity] = await Promise.all([
    db.select().from(permitsContacts).orderBy(desc(permitsContacts.lastSeenAt)).all(),
    db.select().from(permitsContactInsights).orderBy(desc(permitsContactInsights.datetimeUpdated)).all(),
    db
      .select()
      .from(permitsContactActivity)
      .orderBy(desc(permitsContactActivity.datetimeCreated))
      .all(),
  ]);

  const insightMap = new Map(insights.map((row) => [row.contactName, row]));

  const contractorCards = contacts.map((contact) => {
    const metrics = computeContactMetrics(activity, contact.contactName);
    const insightRow = insightMap.get(contact.contactName) || null;
    let parsedHighlights: string[] = [];
    let parsedMetrics: Record<string, unknown> | null = null;
    try {
      parsedHighlights = insightRow?.highlights ? (JSON.parse(insightRow.highlights) as string[]) : [];
    } catch {
      parsedHighlights = [];
    }
    try {
      parsedMetrics = insightRow?.metrics ? (JSON.parse(insightRow.metrics) as Record<string, unknown>) : null;
    } catch {
      parsedMetrics = null;
    }

    return {
      contactName: contact.contactName,
      isMonitored: Boolean(contact.isMonitored),
      activePropertyPermitCount: contact.activePropertyPermitCount,
      closedPropertyPermitCount: contact.closedPropertyPermitCount,
      workload: {
        open: metrics.openCount,
        inProgress: metrics.inProgressCount,
        pending: metrics.pendingCount,
        completed: metrics.completedCount,
      },
      averageCloseDays: metrics.averageCloseDays,
      averageCloseDaysByType: metrics.permitTypes,
      mapPoints: metrics.latLngPoints,
      insight: insightRow
        ? {
            riskLevel: insightRow.riskLevel,
            summary: insightRow.summary,
            highlights: parsedHighlights,
            metrics: parsedMetrics,
          }
        : null,
    };
  });

  return {
    contacts,
    insights,
    activity,
    contractorCards,
  };
}
