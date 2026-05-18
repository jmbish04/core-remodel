import {
  AlertTriangle,
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sheet,
  Sparkles,
  Undo2,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SheetColumn = {
  key: string;
  label: string;
  type: "text" | "currency_cents" | "number" | "boolean" | "date" | "datetime" | "id" | "enum";
  writable: boolean;
  description?: string;
};

type WorkbookTabDefinition = {
  tab: string;
  label: string;
  writable: boolean;
  columns: SheetColumn[];
};

type WorkbookRow = Record<string, string | number | boolean | null>;

type WorkbookPayload = {
  meta: {
    generatedAt: string;
    cursor: string;
    syncHash: string;
    source: string;
  };
  tabs: Record<string, WorkbookRow[]>;
};

type TemplateResponse = {
  template: WorkbookTabDefinition[];
  workbook?: WorkbookPayload | null;
  referenceSheets?: Array<{
    spreadsheetId: string;
    title: string;
    notes: string;
  }>;
  error?: string;
};

type SyncStatusResponse = {
  lastPullAt: string | null;
  lastPushAt: string | null;
  cursorValue: string | null;
  syncHash: string | null;
  notes: string | null;
  recentEvents?: Array<{
    id: number;
    direction: string;
    idempotencyKey: string;
    datetimeCreated: string | null;
  }>;
  error?: string;
};

function deepCloneWorkbook(workbook: WorkbookPayload | null): WorkbookPayload | null {
  if (!workbook) return null;
  return {
    meta: { ...workbook.meta },
    tabs: Object.fromEntries(
      Object.entries(workbook.tabs || {}).map(([tab, rows]) => [
        tab,
        rows.map((row) => ({ ...row })),
      ]),
    ),
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatCellValue(type: SheetColumn["type"], value: WorkbookRow[string]): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (type === "boolean") {
    return value ? "Yes" : "No";
  }

  if (type === "currency_cents") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(numeric / 100);
  }

  if (type === "datetime" || type === "date") {
    const asDate = new Date(String(value));
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toLocaleString();
    }
  }

  return String(value);
}

function parseCurrencyInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

function formatCentsInput(value: WorkbookRow[string]): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return (numeric / 100).toFixed(2);
}

function isCellWritable(
  tabDefinition: WorkbookTabDefinition,
  row: WorkbookRow,
  column: SheetColumn,
): boolean {
  if (!tabDefinition.writable || !column.writable) return false;
  if (tabDefinition.tab === "Financial_Status") {
    return String(row.line_type || "") === "account";
  }
  return true;
}

function getDefaultRowForTab(tab: WorkbookTabDefinition): WorkbookRow {
  const defaults: WorkbookRow = {};
  for (const column of tab.columns) {
    defaults[column.key] = column.type === "boolean" ? false : null;
  }

  if (tab.tab === "Budget_Items") {
    defaults.item_type = "project";
    defaults.execution_class = "must_now";
    defaults.status = "open";
    defaults.risk_level = "medium";
    defaults.is_draft = true;
    defaults.change_source = "budget_tracker_ui";
    defaults.changed_by = "homeowner";
  }

  if (tab.tab === "Itemized_Expenses") {
    defaults.category = "general";
    defaults.source_type = "manual";
    defaults.is_draft = false;
  }

  if (tab.tab === "Financial_Status") {
    defaults.line_type = "account";
  }

  return defaults;
}

function stringifyCellValue(value: WorkbookRow[string]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function getRowIdentity(tab: string, row: WorkbookRow, rowIndex: number): string {
  const candidateKeys = [
    "track_id",
    "revision_id",
    "id",
    "info_key",
    "account_key",
    "line_item_id",
    "contract_id",
    "estimate_id",
    "company_id",
    "room_id",
    "scenario_id",
    "name",
    "title",
  ];

  for (const key of candidateKeys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim().length > 0) {
      return `${tab}:${key}:${String(value)}`;
    }
  }
  return `${tab}:index:${rowIndex}`;
}

function computeChangedCellKeys(
  previousWorkbook: WorkbookPayload,
  nextWorkbook: WorkbookPayload,
  definitions: WorkbookTabDefinition[],
): string[] {
  const changed: string[] = [];

  for (const tab of definitions) {
    const oldRows = previousWorkbook.tabs[tab.tab] || [];
    const nextRows = nextWorkbook.tabs[tab.tab] || [];
    const oldByKey = new Map<string, WorkbookRow>();

    oldRows.forEach((row, index) => {
      oldByKey.set(getRowIdentity(tab.tab, row, index), row);
    });

    nextRows.forEach((row, index) => {
      const rowIdentity = getRowIdentity(tab.tab, row, index);
      const oldRow = oldByKey.get(rowIdentity);
      if (!oldRow) {
        tab.columns.forEach((column) => {
          changed.push(`${tab.tab}:${rowIdentity}:${column.key}`);
        });
        return;
      }

      tab.columns.forEach((column) => {
        const oldValue = stringifyCellValue(oldRow[column.key]);
        const nextValue = stringifyCellValue(row[column.key]);
        if (oldValue !== nextValue) {
          changed.push(`${tab.tab}:${rowIdentity}:${column.key}`);
        }
      });
    });
  }

  return changed;
}

export function BudgetTrackerApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tabs, setTabs] = useState<WorkbookTabDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<string>("Budget_Items");
  const [workbook, setWorkbook] = useState<WorkbookPayload | null>(null);
  const [draftWorkbook, setDraftWorkbook] = useState<WorkbookPayload | null>(null);
  const [referenceSheets, setReferenceSheets] = useState<TemplateResponse["referenceSheets"]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [dirtyCells, setDirtyCells] = useState<Record<string, true>>({});
  const [flashedCells, setFlashedCells] = useState<Record<string, true>>({});

  const workbookRef = useRef<WorkbookPayload | null>(null);
  const tabsRef = useRef<WorkbookTabDefinition[]>([]);
  const hasUnsavedChangesRef = useRef(false);
  const lastRealtimeSkipToastAtRef = useRef(0);

  useEffect(() => {
    workbookRef.current = workbook;
  }, [workbook]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const markDirtyCell = useCallback((tab: string, rowIndex: number, key: string) => {
    setDirtyCells((current) => ({
      ...current,
      [`${tab}:${rowIndex}:${key}`]: true,
    }));
  }, []);

  const clearDirtyState = useCallback(() => {
    setDirtyCells({});
  }, []);

  const flashCells = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setFlashedCells((current) => {
      const next = { ...current };
      keys.forEach((key) => {
        next[key] = true;
      });
      return next;
    });

    window.setTimeout(() => {
      setFlashedCells((current) => {
        const next = { ...current };
        keys.forEach((key) => {
          delete next[key];
        });
        return next;
      });
    }, 2200);
  }, []);

  const applyIncomingWorkbook = useCallback(
    (
      nextWorkbook: WorkbookPayload | null,
      nextTabs: WorkbookTabDefinition[] | null,
      options?: {
        flashChanges?: boolean;
        resetDraft?: boolean;
        clearDirty?: boolean;
      },
    ) => {
      const flashChanges = options?.flashChanges ?? false;
      const resetDraft = options?.resetDraft ?? true;
      const clearDirty = options?.clearDirty ?? true;

      if (nextTabs) {
        setTabs(nextTabs);
      }

      if (flashChanges && nextWorkbook && workbookRef.current) {
        const definitions = nextTabs || tabsRef.current;
        if (definitions.length > 0) {
          const changedKeys = computeChangedCellKeys(
            workbookRef.current,
            nextWorkbook,
            definitions,
          );
          flashCells(changedKeys);
        }
      }

      setWorkbook(nextWorkbook);
      workbookRef.current = nextWorkbook;

      if (resetDraft) {
        setDraftWorkbook(deepCloneWorkbook(nextWorkbook));
      }
      if (clearDirty) {
        clearDirtyState();
      }
    },
    [clearDirtyState, flashCells],
  );

  const loadTemplateAndWorkbook = useCallback(async () => {
    const response = await fetch("/api/sync/google-sheets/template?includeWorkbook=true");
    const payload = (await response.json()) as TemplateResponse;
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load workbook template");
    }

    applyIncomingWorkbook(payload.workbook || null, payload.template || [], {
      flashChanges: false,
      resetDraft: true,
      clearDirty: true,
    });
    setReferenceSheets(payload.referenceSheets || []);

    if (payload.template?.[0]?.tab) {
      setActiveTab((current) => current || payload.template![0].tab);
    }
  }, [applyIncomingWorkbook]);

  const loadSyncStatus = useCallback(async () => {
    const response = await fetch("/api/sync/google-sheets/status");
    const payload = (await response.json()) as SyncStatusResponse;
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load sync status");
    }
    setSyncStatus(payload);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadTemplateAndWorkbook(), loadSyncStatus()]);
  }, [loadSyncStatus, loadTemplateAndWorkbook]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load budget tracker");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadAll]);

  const pullFromD1 = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/sync/google-sheets/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          notes: "Manual refresh from budget tracker page",
          changedBy: "homeowner",
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        workbook?: WorkbookPayload;
        template?: WorkbookTabDefinition[];
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to refresh workbook");
      }
      applyIncomingWorkbook(payload.workbook || null, payload.template || null, {
        flashChanges: false,
        resetDraft: true,
        clearDirty: true,
      });
      await loadSyncStatus();
      toast.success("Workbook refreshed from D1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh workbook");
    } finally {
      setRefreshing(false);
    }
  }, [applyIncomingWorkbook, loadSyncStatus]);

  const bootstrapPlan = useCallback(async () => {
    setBootstrapping(true);
    try {
      const response = await fetch("/api/budget-tracker/bootstrap-homeowner-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changedBy: "homeowner",
          overwriteActiveItems: false,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        inserted?: number;
        skippedExisting?: number;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to seed plan");
      }

      toast.success(
        `Seed complete: inserted ${payload.inserted ?? 0}, skipped ${payload.skippedExisting ?? 0}`,
      );
      await pullFromD1();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to seed plan");
    } finally {
      setBootstrapping(false);
    }
  }, [pullFromD1]);

  const activeTabDefinition = useMemo(
    () => tabs.find((tab) => tab.tab === activeTab) || tabs[0] || null,
    [activeTab, tabs],
  );

  const workbookForRender = draftWorkbook || workbook;

  const activeRows = useMemo(() => {
    if (!activeTabDefinition || !workbookForRender?.tabs) {
      return [] as WorkbookRow[];
    }
    return workbookForRender.tabs[activeTabDefinition.tab] || [];
  }, [activeTabDefinition, workbookForRender?.tabs]);

  const decisionGateRows = useMemo(
    () => workbookForRender?.tabs?.Decision_Gates || [],
    [workbookForRender?.tabs],
  );
  const budgetSummaryRows = useMemo(
    () => workbookForRender?.tabs?.Budget_Summary || [],
    [workbookForRender?.tabs],
  );
  const financialStatusRows = useMemo(
    () => workbookForRender?.tabs?.Financial_Status || [],
    [workbookForRender?.tabs],
  );
  const varianceRows = useMemo(
    () => workbookForRender?.tabs?.Variance_Options || [],
    [workbookForRender?.tabs],
  );
  const categorySummaryRows = useMemo(
    () => workbookForRender?.tabs?.Category_Summary || [],
    [workbookForRender?.tabs],
  );

  const allottedFunds = useMemo(
    () =>
      financialStatusRows.find((row) => String(row.account_key || "") === "total_allotted_funds")
        ?.amount_cents ?? null,
    [financialStatusRows],
  );
  const usedFunds = useMemo(
    () =>
      financialStatusRows.find((row) => String(row.account_key || "") === "funds_used_to_date")
        ?.amount_cents ?? null,
    [financialStatusRows],
  );
  const remainingFunds = useMemo(
    () =>
      financialStatusRows.find((row) => String(row.account_key || "") === "funds_remaining")
        ?.amount_cents ?? null,
    [financialStatusRows],
  );

  const hasUnsavedChanges = useMemo(() => Object.keys(dirtyCells).length > 0, [dirtyCells]);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const refreshFromRealtime = useCallback(async () => {
    const response = await fetch("/api/sync/google-sheets/template?includeWorkbook=true");
    const payload = (await response.json()) as TemplateResponse;
    if (!response.ok) {
      throw new Error(payload.error || "Failed to refresh workbook in realtime");
    }
    applyIncomingWorkbook(payload.workbook || null, payload.template || [], {
      flashChanges: true,
      resetDraft: true,
      clearDirty: true,
    });
    setReferenceSheets(payload.referenceSheets || []);
    await loadSyncStatus();
  }, [applyIncomingWorkbook, loadSyncStatus]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/api/realtime/estimates?room=home`,
    );

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data || "{}")) as {
          payload?: { event?: string };
        };
        const eventName = parsed.payload?.event || "";
        const shouldHandle =
          eventName.startsWith("budget.") ||
          eventName.startsWith("sync.google_sheets.") ||
          eventName === "budget.sync.push.applied";
        if (!shouldHandle) return;

        if (hasUnsavedChangesRef.current) {
          const now = Date.now();
          if (now - lastRealtimeSkipToastAtRef.current > 5000) {
            lastRealtimeSkipToastAtRef.current = now;
            toast.warning("Remote budget updates available. Save or discard local edits to sync.");
          }
          return;
        }

        void refreshFromRealtime();
      } catch {
        // noop
      }
    };

    return () => {
      ws.close();
    };
  }, [refreshFromRealtime]);

  const updateCell = useCallback(
    (
      tab: WorkbookTabDefinition,
      rowIndex: number,
      column: SheetColumn,
      nextValue: WorkbookRow[string],
    ) => {
      setDraftWorkbook((current) => {
        if (!current) return current;
        const next = deepCloneWorkbook(current);
        if (!next) return next;
        const tabRows = next.tabs[tab.tab] || [];
        if (!tabRows[rowIndex]) return current;
        tabRows[rowIndex] = {
          ...tabRows[rowIndex],
          [column.key]: nextValue,
        };
        if (tab.tab === "Budget_Items" || tab.tab === "Itemized_Expenses") {
          tabRows[rowIndex].row_hash = null;
        }
        next.tabs[tab.tab] = tabRows;
        return next;
      });
      markDirtyCell(tab.tab, rowIndex, column.key);
    },
    [markDirtyCell],
  );

  const discardEdits = useCallback(() => {
    setDraftWorkbook(deepCloneWorkbook(workbook));
    clearDirtyState();
    toast.success("Unsaved edits discarded");
  }, [clearDirtyState, workbook]);

  const addRow = useCallback(() => {
    if (!activeTabDefinition) return;
    if (!activeTabDefinition.writable) return;

    setDraftWorkbook((current) => {
      if (!current) return current;
      const next = deepCloneWorkbook(current);
      if (!next) return next;
      const rows = [...(next.tabs[activeTabDefinition.tab] || [])];
      rows.push(getDefaultRowForTab(activeTabDefinition));
      next.tabs[activeTabDefinition.tab] = rows;
      return next;
    });

    const newIndex = (draftWorkbook?.tabs?.[activeTabDefinition.tab] || []).length;
    markDirtyCell(activeTabDefinition.tab, newIndex, "__new_row__");
  }, [activeTabDefinition, draftWorkbook?.tabs, markDirtyCell]);

  const saveChanges = useCallback(async () => {
    if (!draftWorkbook) {
      toast.error("Nothing to save yet");
      return;
    }

    const writableTabs = tabs.filter((tab) => tab.writable);
    const pushTabs = Object.fromEntries(
      writableTabs.map((tab) => [tab.tab, draftWorkbook.tabs[tab.tab] || []]),
    );

    setSaving(true);
    try {
      const response = await fetch("/api/sync/google-sheets/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          changedBy: "homeowner",
          changeSource: "budget_tracker_frontend",
          notes: "Manual update from Budget Tracker mirrored table",
          workbook: {
            meta: draftWorkbook.meta,
            tabs: pushTabs,
          },
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        result?: {
          duplicate?: boolean;
          createdBudgetItems?: number;
          revisedBudgetItems?: number;
          createdExpenses?: number;
          revisedExpenses?: number;
          updatedProjectInfo?: number;
          updatedFundingAccounts?: number;
        };
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to save updates");
      }

      const result = payload.result;
      toast.success(
        `Saved. Budget +${result?.createdBudgetItems || 0}/${result?.revisedBudgetItems || 0} · Expenses +${result?.createdExpenses || 0}/${result?.revisedExpenses || 0}`,
      );
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save updates");
    } finally {
      setSaving(false);
    }
  }, [draftWorkbook, loadAll, tabs]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading budget tracker...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-2xl">Budget + Scenario Tracker</CardTitle>
            <CardDescription>
              Mirrored to Google Sheets tabs so spreadsheet and app workflows stay aligned.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasUnsavedChanges ? (
              <Badge variant="secondary">Unsaved: {Object.keys(dirtyCells).length}</Badge>
            ) : null}
            <Button onClick={bootstrapPlan} disabled={bootstrapping} variant="secondary">
              {bootstrapping ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Seeding
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  Seed Homeowner Plan
                </>
              )}
            </Button>
            <Button onClick={pullFromD1} disabled={refreshing} variant="outline">
              {refreshing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Refreshing
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 size-4" />
                  Pull From D1
                </>
              )}
            </Button>
            <Button
              onClick={discardEdits}
              disabled={!hasUnsavedChanges || saving}
              variant="outline"
            >
              <Undo2 className="mr-2 size-4" />
              Discard
            </Button>
            <Button onClick={saveChanges} disabled={!hasUnsavedChanges || saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <Save className="mr-2 size-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Sync Status</CardTitle>
            <CardDescription>D1 remains source of truth; Sheets is mirrored.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Last Pull:</span>{" "}
              {formatDate(syncStatus?.lastPullAt || null)}
            </p>
            <p>
              <span className="text-muted-foreground">Last Push:</span>{" "}
              {formatDate(syncStatus?.lastPushAt || null)}
            </p>
            <p className="break-all">
              <span className="text-muted-foreground">Cursor:</span>{" "}
              {syncStatus?.cursorValue || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Allotted:</span>{" "}
              {formatCellValue("currency_cents", allottedFunds)}
            </p>
            <p>
              <span className="text-muted-foreground">Used:</span>{" "}
              {formatCellValue("currency_cents", usedFunds)}
            </p>
            <p>
              <span className="text-muted-foreground">Remaining:</span>{" "}
              {formatCellValue("currency_cents", remainingFunds)}
            </p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Decision Gates</CardTitle>
            <CardDescription>Bottlenecks that block major remodel paths.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{decisionGateRows.length} active gate(s)</p>
            {decisionGateRows.slice(0, 3).map((row, index) => (
              <div
                key={`${row.track_id || "gate"}-${index}`}
                className="rounded-md bg-muted/25 p-2 ring-1 ring-border/30"
              >
                <p className="text-xs font-medium">{String(row.title || "Untitled gate")}</p>
                <p className="text-xs text-muted-foreground">{String(row.status || "open")}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Budget Summary</CardTitle>
            <CardDescription>Class-level low/high budget totals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {budgetSummaryRows.length === 0 ? (
              <p className="text-muted-foreground">No summary rows yet.</p>
            ) : (
              budgetSummaryRows.map((row, index) => (
                <div
                  key={`${row.execution_class || "summary"}-${index}`}
                  className="rounded-md bg-muted/25 p-2 ring-1 ring-border/30"
                >
                  <p className="text-xs font-medium">
                    {String(row.execution_class || "unclassified")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCellValue("currency_cents", row.low_sum_cents)} to{" "}
                    {formatCellValue("currency_cents", row.high_sum_cents)}
                  </p>
                </div>
              ))
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              {varianceRows.length} variance option path(s) tracked · {categorySummaryRows.length}{" "}
              expense category bucket(s)
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sheet className="size-4 text-muted-foreground" />
            Mirrored Workbook Tabs
          </CardTitle>
          <CardDescription>
            Tab names and columns are intentionally mirrored with the Google Sheet structure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <Button
                key={tab.tab}
                size="sm"
                variant={tab.tab === (activeTabDefinition?.tab || "") ? "default" : "outline"}
                onClick={() => setActiveTab(tab.tab)}
              >
                {tab.label}
                {tab.writable ? (
                  <Badge className="ml-2" variant="secondary">
                    Editable
                  </Badge>
                ) : null}
              </Button>
            ))}
          </div>

          {activeTabDefinition ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Database className="size-4" />
                {activeTabDefinition.label} • {activeRows.length} row(s)
                {activeTabDefinition.writable ? (
                  <Button size="sm" variant="outline" onClick={addRow}>
                    <Plus className="mr-2 size-4" />
                    Add Row
                  </Button>
                ) : null}
              </div>
              <div className="overflow-x-auto rounded-md border border-border/50">
                <table className="w-full min-w-[1120px] text-left text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {activeTabDefinition.columns.map((column) => (
                        <th
                          key={column.key}
                          className="whitespace-nowrap border-b border-border/50 px-3 py-2 font-semibold"
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={activeTabDefinition.columns.length}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          No rows available for this tab.
                        </td>
                      </tr>
                    ) : (
                      activeRows.map((row, rowIndex) => (
                        <tr
                          key={`${activeTabDefinition.tab}-${String(row.track_id || row.revision_id || rowIndex)}`}
                          className="border-b border-border/40 align-top"
                        >
                          {activeTabDefinition.columns.map((column) => {
                            const rowIdentity = getRowIdentity(
                              activeTabDefinition.tab,
                              row,
                              rowIndex,
                            );
                            const writable = isCellWritable(activeTabDefinition, row, column);
                            const dirty =
                              dirtyCells[`${activeTabDefinition.tab}:${rowIndex}:${column.key}`] ===
                              true;
                            const flashed =
                              flashedCells[
                                `${activeTabDefinition.tab}:${rowIdentity}:${column.key}`
                              ] === true;

                            if (!writable) {
                              return (
                                <td
                                  key={`${rowIndex}-${column.key}`}
                                  className={cn(
                                    "max-w-[360px] px-3 py-2 text-foreground/90 transition-colors",
                                    flashed && "bg-amber-300/25",
                                  )}
                                >
                                  <div className="line-clamp-3">
                                    {formatCellValue(column.type, row[column.key])}
                                  </div>
                                </td>
                              );
                            }

                            if (column.type === "boolean") {
                              return (
                                <td
                                  key={`${rowIndex}-${column.key}`}
                                  className="max-w-[360px] px-3 py-2 text-foreground/90"
                                >
                                  <label className="inline-flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={row[column.key] === true}
                                      onChange={(event) =>
                                        updateCell(
                                          activeTabDefinition,
                                          rowIndex,
                                          column,
                                          event.currentTarget.checked,
                                        )
                                      }
                                    />
                                    {row[column.key] === true ? "Yes" : "No"}
                                  </label>
                                </td>
                              );
                            }

                            if (column.type === "currency_cents") {
                              return (
                                <td
                                  key={`${rowIndex}-${column.key}`}
                                  className="max-w-[360px] px-3 py-2 text-foreground/90"
                                >
                                  <div className="space-y-1">
                                    <Input
                                      value={formatCentsInput(row[column.key])}
                                      onChange={(event) => {
                                        const parsed = parseCurrencyInputToCents(
                                          event.currentTarget.value,
                                        );
                                        updateCell(activeTabDefinition, rowIndex, column, parsed);
                                      }}
                                      placeholder="0.00"
                                      className={cn(
                                        dirty && "border-amber-500/60",
                                        flashed && "bg-amber-300/25",
                                      )}
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                      Dollar input, stored as cents.
                                    </p>
                                  </div>
                                </td>
                              );
                            }

                            return (
                              <td
                                key={`${rowIndex}-${column.key}`}
                                className="max-w-[360px] px-3 py-2 text-foreground/90"
                              >
                                <Input
                                  value={
                                    row[column.key] === null || row[column.key] === undefined
                                      ? ""
                                      : String(row[column.key])
                                  }
                                  onChange={(event) => {
                                    const textValue = event.currentTarget.value;
                                    const normalizedValue =
                                      textValue.trim().length === 0 ? null : textValue;
                                    updateCell(
                                      activeTabDefinition,
                                      rowIndex,
                                      column,
                                      normalizedValue,
                                    );
                                  }}
                                  className={cn(
                                    dirty && "border-amber-500/60",
                                    flashed && "bg-amber-300/25",
                                  )}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">No tab metadata loaded yet.</p>
              <p className="mt-1 text-muted-foreground">
                Use “Pull From D1” to initialize workbook tabs.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-muted-foreground" />
            Reference Sheets Reviewed
          </CardTitle>
          <CardDescription>
            These informed the mirrored tab strategy for this tracker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {referenceSheets && referenceSheets.length > 0 ? (
            referenceSheets.map((sheet) => (
              <div
                key={sheet.spreadsheetId}
                className="rounded-md bg-muted/20 p-3 ring-1 ring-border/30"
              >
                <p className="font-medium">{sheet.title}</p>
                <p className="mt-1 text-muted-foreground">{sheet.notes}</p>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No reference sheet metadata available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
