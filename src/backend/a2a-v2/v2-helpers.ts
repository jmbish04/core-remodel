import { buildGoogleSheetsWorkbook } from "@/services/google/sheets";
import { getHomeCatalog } from "@backend/services/home-catalog";
import {
  getPermitContactsInsights,
  getPermitDashboard,
} from "@/services/dbi/permits-sync";

type RegisteredFunctionName =
  | "getExistingD1Data"
  | "fetchMetricsReport"
  | "getPermitDashboard"
  | "getPermitContactsInsights"
  | "getHomeCatalog"
  | "buildGoogleSheetsWorkbook";

const MAX_GRID_ROWS = 300;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function escapeCsvValue(value: string): string {
  const needsQuoting =
    value.includes(",") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes('"');
  if (!needsQuoting) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function objectArrayToRows(rows: unknown[]): Array<Record<string, unknown>> {
  return rows
    .map((row) => {
      const asRecord = toRecord(row);
      if (!asRecord) {
        return { value: row };
      }
      return asRecord;
    })
    .slice(0, MAX_GRID_ROWS);
}

function workbookTabsToRows(value: unknown): Array<Record<string, unknown>> {
  const record = toRecord(value);
  if (!record) {
    return [];
  }

  const tabs = toRecord(record.tabs);
  if (!tabs) {
    return [];
  }

  const rows: Array<Record<string, unknown>> = [];
  const tabNames = Object.keys(tabs);

  for (const tab of tabNames) {
    const tabRows = tabs[tab];
    if (!Array.isArray(tabRows)) {
      continue;
    }

    for (const row of tabRows) {
      if (rows.length >= MAX_GRID_ROWS) {
        return rows;
      }

      const rowRecord = toRecord(row);
      if (!rowRecord) {
        rows.push({ tab, value: row });
        continue;
      }
      rows.push({ tab, ...rowRecord });
    }
  }

  return rows;
}

function nestedArrayPropertyToRows(
  value: unknown,
): Array<Record<string, unknown>> {
  const record = toRecord(value);
  if (!record) {
    return [];
  }

  const preferredKeys = [
    "propertyPermits",
    "contractorCards",
    "latestRecords",
    "contacts",
    "rooms",
    "floors",
  ];

  for (const key of preferredKeys) {
    const candidate = record[key];
    if (Array.isArray(candidate) && candidate.length > 0) {
      return objectArrayToRows(candidate).map((row) => ({
        source: key,
        ...row,
      }));
    }
  }

  for (const [key, candidate] of Object.entries(record)) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return objectArrayToRows(candidate).map((row) => ({
        source: key,
        ...row,
      }));
    }
  }

  return [];
}

function coerceRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return objectArrayToRows(value);
  }

  const workbookRows = workbookTabsToRows(value);
  if (workbookRows.length > 0) {
    return workbookRows;
  }

  const nestedRows = nestedArrayPropertyToRows(value);
  if (nestedRows.length > 0) {
    return nestedRows;
  }

  const record = toRecord(value);
  if (record) {
    return [record];
  }

  return [{ value: value ?? "" }];
}

function rowsToGrid(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "No database records found matching that request.";
  }

  const headers: string[] = [];
  const headerSet = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headerSet.has(key)) {
        headerSet.add(key);
        headers.push(key);
      }
    }
  }

  const csvLines: string[] = [];
  csvLines.push(headers.map((header) => escapeCsvValue(header)).join(","));

  for (const row of rows) {
    const line = headers
      .map((header) => normalizeCellValue(row[header]))
      .map((value) => escapeCsvValue(value))
      .join(",");
    csvLines.push(line);
  }

  return `<sheet-grid>\n${csvLines.join("\n")}\n</sheet-grid>`;
}

async function runExistingFunction(
  functionName: RegisteredFunctionName,
  env: Env,
): Promise<unknown> {
  switch (functionName) {
    case "getExistingD1Data":
    case "getPermitDashboard":
      return getPermitDashboard(env);
    case "fetchMetricsReport":
    case "getPermitContactsInsights":
      return getPermitContactsInsights(env);
    case "getHomeCatalog":
      return getHomeCatalog(env);
    case "buildGoogleSheetsWorkbook":
      return buildGoogleSheetsWorkbook(env);
    default:
      throw new Error(
        `Function ${functionName} is not registered in the V2 wrapper.`,
      );
  }
}

export async function wrapExistingFunctionToGrid(
  functionName: string,
  _args: unknown[],
  env: Env,
): Promise<string> {
  try {
    const registeredFunction = functionName as RegisteredFunctionName;
    const rawData = await runExistingFunction(registeredFunction, env);
    const rows = coerceRows(rawData);
    return rowsToGrid(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Failed to process structural data from existing API: ${message}`;
  }
}
