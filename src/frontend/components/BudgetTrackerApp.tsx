import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sheet,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ============================================================
// TYPES
// ============================================================

type BudgetItem = {
  id: number;
  trackId: string;
  revisionNumber: number;
  isActive: boolean;
  isDraft: boolean;
  itemType: string;
  executionClass: string;
  optionGroup: string | null;
  optionKey: string | null;
  title: string;
  description: string | null;
  status: string;
  riskLevel: string;
  isBottleneck: boolean;
  bottleneckReason: string | null;
  estimatedLowCents: number | null;
  estimatedHighCents: number | null;
  scenarioId: string | null;
  owner: string | null;
  aiRationale: string | null;
  changeSource: string;
  changedBy: string | null;
  datetimeCreated: string | null;
  datetimeUpdated: string | null;
  rooms: Array<{ roomId: number; roomName: string }>;
};

type BudgetItemsResponse = {
  items: BudgetItem[];
  summary: {
    totalActive: number;
    bottlenecks: number;
    mustNow: number;
    futureTbd: number;
    options: number;
  };
};

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

// ============================================================
// CONSTANTS
// ============================================================

const EXECUTION_CLASSES = [
  { value: "must_now", label: "Must Now", color: "text-red-400" },
  { value: "future_tbd", label: "Future TBD", color: "text-amber-400" },
  { value: "option", label: "Option", color: "text-blue-400" },
] as const;

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "researching", label: "Researching" },
  { value: "blocked", label: "Blocked" },
  { value: "approved", label: "Approved" },
  { value: "done", label: "Done" },
] as const;

const RISK_LEVELS = [
  { value: "low", label: "Low", color: "text-emerald-400" },
  { value: "medium", label: "Medium", color: "text-amber-400" },
  { value: "high", label: "High", color: "text-red-400" },
] as const;

const ITEM_TYPES = [
  { value: "project", label: "Project" },
  { value: "professional_service", label: "Professional Service" },
  { value: "estimate", label: "Estimate" },
  { value: "contract", label: "Contract" },
] as const;

// ============================================================
// HELPERS
// ============================================================

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatCellValue(type: SheetColumn["type"], value: WorkbookRow[string]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "currency_cents") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      numeric / 100,
    );
  }
  if (type === "datetime" || type === "date") {
    const asDate = new Date(String(value));
    if (!Number.isNaN(asDate.getTime())) return asDate.toLocaleString();
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

function centsToEditableString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

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

function getStatusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    open: { variant: "secondary", label: "Open" },
    researching: { variant: "default", label: "Researching" },
    blocked: { variant: "destructive", label: "Blocked" },
    approved: { variant: "outline", label: "Approved" },
    done: { variant: "outline", label: "Done" },
  };
  return map[status] ?? { variant: "secondary" as const, label: status };
}

function getExecutionClassBadge(executionClass: string) {
  const map: Record<string, { color: string; label: string }> = {
    must_now: { color: "bg-red-500/15 text-red-400 ring-red-500/30", label: "Must Now" },
    future_tbd: { color: "bg-amber-500/15 text-amber-400 ring-amber-500/30", label: "Future TBD" },
    option: { color: "bg-blue-500/15 text-blue-400 ring-blue-500/30", label: "Option" },
  };
  return map[executionClass] ?? { color: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30", label: executionClass };
}

function getRiskBadge(riskLevel: string) {
  const map: Record<string, { color: string; label: string }> = {
    low: { color: "text-emerald-400", label: "Low" },
    medium: { color: "text-amber-400", label: "Medium" },
    high: { color: "text-red-400", label: "High" },
  };
  return map[riskLevel] ?? { color: "text-zinc-400", label: riskLevel };
}

// ============================================================
// BUDGET ITEM LIST VIEW
// ============================================================

function BudgetItemListView({
  items,
  summary,
  loading,
  searchQuery,
  setSearchQuery,
  executionFilter,
  setExecutionFilter,
  statusFilter,
  setStatusFilter,
  onSelectItem,
  onAddItem,
  onRefresh,
  refreshing,
}: {
  items: BudgetItem[];
  summary: BudgetItemsResponse["summary"] | null;
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  executionFilter: string;
  setExecutionFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  onSelectItem: (item: BudgetItem) => void;
  onAddItem: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (item.description?.toLowerCase().includes(q) ?? false) ||
          (item.owner?.toLowerCase().includes(q) ?? false),
      );
    }
    if (executionFilter) {
      result = result.filter((item) => item.executionClass === executionFilter);
    }
    if (statusFilter) {
      result = result.filter((item) => item.status === statusFilter);
    }
    return result;
  }, [items, searchQuery, executionFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryChip label="Total Active" value={summary.totalActive} />
          <SummaryChip label="Must Now" value={summary.mustNow} color="text-red-400" />
          <SummaryChip label="Future TBD" value={summary.futureTbd} color="text-amber-400" />
          <SummaryChip label="Options" value={summary.options} color="text-blue-400" />
          <SummaryChip label="Bottlenecks" value={summary.bottlenecks} color="text-orange-400" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search items…"
            className="h-9 pl-9"
          />
        </div>
        <select
          value={executionFilter}
          onChange={(e) => setExecutionFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Classes</option>
          {EXECUTION_CLASSES.map((ec) => (
            <option key={ec.value} value={ec.value}>
              {ec.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            Refresh
          </Button>
          <Button size="sm" onClick={onAddItem}>
            <Plus className="mr-2 size-4" />
            Add Item
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading budget items…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Database className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No budget items found.</p>
            <Button size="sm" onClick={onAddItem}>
              <Plus className="mr-2 size-4" />
              Add your first item
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <BudgetItemCard key={item.id} item={item} onClick={() => onSelectItem(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
    </div>
  );
}

function BudgetItemCard({ item, onClick }: { item: BudgetItem; onClick: () => void }) {
  const execBadge = getExecutionClassBadge(item.executionClass);
  const statusBadge = getStatusBadge(item.status);
  const riskInfo = getRiskBadge(item.riskLevel);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-lg border border-border/40 bg-card/60 p-4 text-left transition-all hover:border-border hover:bg-card/80 hover:ring-1 hover:ring-ring/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">{item.title}</h3>
            {item.isBottleneck && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                Bottleneck
              </Badge>
            )}
            {item.isDraft && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                Draft
              </Badge>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
          )}

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1", execBadge.color)}>
              {execBadge.label}
            </span>
            <Badge variant={statusBadge.variant} className="text-[10px]">
              {statusBadge.label}
            </Badge>
            <span className={cn("text-[10px] font-medium", riskInfo.color)}>
              {riskInfo.label} risk
            </span>
            {item.owner && (
              <span className="text-[10px] text-muted-foreground">
                · {item.owner}
              </span>
            )}
            {item.rooms.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                · {item.rooms.map((r) => r.roomName).join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Cost range + arrow */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            {(item.estimatedLowCents !== null || item.estimatedHighCents !== null) ? (
              <>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCents(item.estimatedLowCents)}
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  to {formatCents(item.estimatedHighCents)}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No estimate</p>
            )}
          </div>
          <ChevronRight className="size-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        </div>
      </div>
    </button>
  );
}

// ============================================================
// BUDGET ITEM DETAIL FORM
// ============================================================

type FormDraft = {
  title: string;
  description: string;
  itemType: string;
  executionClass: string;
  status: string;
  riskLevel: string;
  isBottleneck: boolean;
  bottleneckReason: string;
  estimatedLowCents: string;
  estimatedHighCents: string;
  optionGroup: string;
  optionKey: string;
  scenarioId: string;
  owner: string;
  aiRationale: string;
};

function itemToFormDraft(item: BudgetItem | null): FormDraft {
  if (!item) {
    return {
      title: "",
      description: "",
      itemType: "project",
      executionClass: "must_now",
      status: "open",
      riskLevel: "medium",
      isBottleneck: false,
      bottleneckReason: "",
      estimatedLowCents: "",
      estimatedHighCents: "",
      optionGroup: "",
      optionKey: "",
      scenarioId: "",
      owner: "",
      aiRationale: "",
    };
  }
  return {
    title: item.title,
    description: item.description ?? "",
    itemType: item.itemType,
    executionClass: item.executionClass,
    status: item.status,
    riskLevel: item.riskLevel,
    isBottleneck: item.isBottleneck,
    bottleneckReason: item.bottleneckReason ?? "",
    estimatedLowCents: centsToEditableString(item.estimatedLowCents),
    estimatedHighCents: centsToEditableString(item.estimatedHighCents),
    optionGroup: item.optionGroup ?? "",
    optionKey: item.optionKey ?? "",
    scenarioId: item.scenarioId ?? "",
    owner: item.owner ?? "",
    aiRationale: item.aiRationale ?? "",
  };
}

function BudgetItemDetailForm({
  item,
  onSave,
  onDelete,
  onCancel,
}: {
  item: BudgetItem | null;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onCancel: () => void;
}) {
  const isNew = item === null;
  const [draft, setDraft] = useState<FormDraft>(() => itemToFormDraft(item));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateField = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        itemType: draft.itemType,
        executionClass: draft.executionClass,
        status: draft.status,
        riskLevel: draft.riskLevel,
        isBottleneck: draft.isBottleneck,
        bottleneckReason: draft.bottleneckReason.trim() || null,
        estimatedLowCents: parseCurrencyInputToCents(draft.estimatedLowCents),
        estimatedHighCents: parseCurrencyInputToCents(draft.estimatedHighCents),
        optionGroup: draft.optionGroup.trim() || null,
        optionKey: draft.optionKey.trim() || null,
        scenarioId: draft.scenarioId.trim() || null,
        owner: draft.owner.trim() || null,
        aiRationale: draft.aiRationale.trim() || null,
        changedBy: "homeowner",
        changeSource: "budget_tracker_ui",
      };
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    setDeleting(true);
    try {
      await onDelete(item.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onCancel} className="gap-1.5">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <h2 className="text-lg font-semibold">
          {isNew ? "Add Budget Item" : "Edit Budget Item"}
        </h2>
        {item && (
          <span className="text-xs text-muted-foreground ml-auto">
            Rev {item.revisionNumber} · Track {item.trackId.slice(0, 8)}…
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core info */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Core Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={draft.title}
                onChange={(e) => updateField("title", e.currentTarget.value)}
                placeholder="e.g. French drains across backyard"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                value={draft.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Detailed scope and rationale…"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="itemType">Item Type</Label>
              <select
                id="itemType"
                value={draft.itemType}
                onChange={(e) => updateField("itemType", e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">Owner</Label>
              <Input
                id="owner"
                value={draft.owner}
                onChange={(e) => updateField("owner", e.currentTarget.value)}
                placeholder="e.g. homeowner, contractor"
              />
            </div>
          </CardContent>
        </Card>

        {/* Classification */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Classification & Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="executionClass">Execution Class</Label>
              <select
                id="executionClass"
                value={draft.executionClass}
                onChange={(e) => updateField("executionClass", e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {EXECUTION_CLASSES.map((ec) => (
                  <option key={ec.value} value={ec.value}>{ec.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                value={draft.status}
                onChange={(e) => updateField("status", e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="riskLevel">Risk Level</Label>
              <select
                id="riskLevel"
                value={draft.riskLevel}
                onChange={(e) => updateField("riskLevel", e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {RISK_LEVELS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Bottleneck */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Bottleneck</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.isBottleneck}
                onChange={(e) => updateField("isBottleneck", e.target.checked)}
                className="size-4 rounded border border-input accent-primary"
              />
              <span className="text-sm">Flag as bottleneck</span>
            </label>
            {draft.isBottleneck && (
              <div className="space-y-1.5">
                <Label htmlFor="bottleneckReason">Bottleneck Reason</Label>
                <textarea
                  id="bottleneckReason"
                  value={draft.bottleneckReason}
                  onChange={(e) => updateField("bottleneckReason", e.target.value)}
                  placeholder="Why does this block other work?"
                  rows={2}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost estimates */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Cost Estimates</CardTitle>
            <CardDescription>Enter dollar amounts (e.g. 45000). Stored as cents internally.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="estimatedLow">Estimated Low ($)</Label>
              <Input
                id="estimatedLow"
                value={draft.estimatedLowCents}
                onChange={(e) => updateField("estimatedLowCents", e.currentTarget.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimatedHigh">Estimated High ($)</Label>
              <Input
                id="estimatedHigh"
                value={draft.estimatedHighCents}
                onChange={(e) => updateField("estimatedHighCents", e.currentTarget.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
          </CardContent>
        </Card>

        {/* Option & Scenario grouping */}
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Option & Scenario Grouping</CardTitle>
            <CardDescription>Group items into option paths and variance scenarios.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="optionGroup">Option Group</Label>
              <Input
                id="optionGroup"
                value={draft.optionGroup}
                onChange={(e) => updateField("optionGroup", e.currentTarget.value)}
                placeholder="e.g. kitchen_path"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="optionKey">Option Key</Label>
              <Input
                id="optionKey"
                value={draft.optionKey}
                onChange={(e) => updateField("optionKey", e.currentTarget.value)}
                placeholder="e.g. ikea_cabinets"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scenarioId">Scenario ID</Label>
              <Input
                id="scenarioId"
                value={draft.scenarioId}
                onChange={(e) => updateField("scenarioId", e.currentTarget.value)}
                placeholder="Optional"
              />
            </div>
          </CardContent>
        </Card>

        {/* AI Rationale */}
        {(draft.aiRationale || isNew) && (
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">AI Rationale</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                value={draft.aiRationale}
                onChange={(e) => updateField("aiRationale", e.target.value)}
                placeholder="Auto-generated reasoning or manual notes…"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {isNew ? "Creating…" : "Saving…"}
              </>
            ) : (
              <>
                <Save className="mr-2 size-4" />
                {isNew ? "Create Item" : "Save Changes"}
              </>
            )}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>

          {!isNew && (
            <div className="ml-auto">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">Are you sure?</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Trash2 className="mr-1 size-3" />}
                    Confirm Delete
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-1 size-3" />
                  Mark as Deleted
                </Button>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

// ============================================================
// WORKBOOK TABS (unchanged, preserved from original)
// ============================================================

function WorkbookTabsSection({
  tabs,
  activeTab,
  setActiveTab,
  workbook,
  draftWorkbook,
  dirtyCells,
  flashedCells,
  updateCell,
  addRow,
}: {
  tabs: WorkbookTabDefinition[];
  activeTab: string;
  setActiveTab: (tab: string) => void;
  workbook: WorkbookPayload | null;
  draftWorkbook: WorkbookPayload | null;
  dirtyCells: Record<string, true>;
  flashedCells: Record<string, true>;
  updateCell: (tab: WorkbookTabDefinition, rowIndex: number, column: SheetColumn, value: WorkbookRow[string]) => void;
  addRow: () => void;
}) {
  const activeTabDefinition = useMemo(
    () => tabs.find((tab) => tab.tab === activeTab) || tabs[0] || null,
    [activeTab, tabs],
  );

  const workbookForRender = draftWorkbook || workbook;
  const activeRows = useMemo(() => {
    if (!activeTabDefinition || !workbookForRender?.tabs) return [] as WorkbookRow[];
    return workbookForRender.tabs[activeTabDefinition.tab] || [];
  }, [activeTabDefinition, workbookForRender?.tabs]);

  // Filter out Budget_Items since that's handled by the new list view
  const filteredTabs = useMemo(
    () => tabs.filter((tab) => tab.tab !== "Budget_Items"),
    [tabs],
  );

  if (filteredTabs.length === 0) return null;

  return (
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
          {filteredTabs.map((tab) => (
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

        {activeTabDefinition && activeTabDefinition.tab !== "Budget_Items" ? (
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
        ) : null}
      </CardContent>
    </Card>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export function BudgetTrackerApp() {
  // ---------- View state ----------
  type ViewMode = "list" | "detail" | "add";
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedItem, setSelectedItem] = useState<BudgetItem | null>(null);

  // ---------- Budget items from dedicated API ----------
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetItemsResponse["summary"] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsRefreshing, setItemsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [executionFilter, setExecutionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // ---------- Workbook/sync state (preserved) ----------
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tabs, setTabs] = useState<WorkbookTabDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<string>("Itemized_Expenses");
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

  // ---------- Budget items API ----------
  const fetchBudgetItems = useCallback(async () => {
    try {
      const res = await fetch("/api/budget-tracker/items");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BudgetItemsResponse;
      setBudgetItems(data.items);
      setBudgetSummary(data.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load budget items");
    }
  }, []);

  const refreshBudgetItems = useCallback(async () => {
    setItemsRefreshing(true);
    await fetchBudgetItems();
    setItemsRefreshing(false);
  }, [fetchBudgetItems]);

  // ---------- Workbook sync helpers (preserved) ----------
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

      if (nextTabs) setTabs(nextTabs);

      if (flashChanges && nextWorkbook && workbookRef.current) {
        const definitions = nextTabs || tabsRef.current;
        if (definitions.length > 0) {
          const changedKeys = computeChangedCellKeys(workbookRef.current, nextWorkbook, definitions);
          flashCells(changedKeys);
        }
      }

      setWorkbook(nextWorkbook);
      workbookRef.current = nextWorkbook;

      if (resetDraft) setDraftWorkbook(deepCloneWorkbook(nextWorkbook));
      if (clearDirty) clearDirtyState();
    },
    [clearDirtyState, flashCells],
  );

  const loadTemplateAndWorkbook = useCallback(async () => {
    const response = await fetch("/api/sync/google-sheets/template?includeWorkbook=true");
    const payload = (await response.json()) as TemplateResponse;
    if (!response.ok) throw new Error(payload.error || "Failed to load workbook template");

    applyIncomingWorkbook(payload.workbook || null, payload.template || [], {
      flashChanges: false,
      resetDraft: true,
      clearDirty: true,
    });
    setReferenceSheets(payload.referenceSheets || []);

    if (payload.template?.[0]?.tab) {
      setActiveTab((current) => {
        // Default to first non-Budget_Items tab
        if (current === "Budget_Items") {
          const alt = payload.template!.find((t) => t.tab !== "Budget_Items");
          return alt?.tab ?? current;
        }
        return current;
      });
    }
  }, [applyIncomingWorkbook]);

  const loadSyncStatus = useCallback(async () => {
    const response = await fetch("/api/sync/google-sheets/status");
    const payload = (await response.json()) as SyncStatusResponse;
    if (!response.ok) throw new Error(payload.error || "Failed to load sync status");
    setSyncStatus(payload);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadTemplateAndWorkbook(), loadSyncStatus(), fetchBudgetItems()]);
  }, [loadSyncStatus, loadTemplateAndWorkbook, fetchBudgetItems]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setItemsLoading(true);
      try {
        await loadAll();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load budget tracker");
      } finally {
        setLoading(false);
        setItemsLoading(false);
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
      await Promise.all([loadSyncStatus(), fetchBudgetItems()]);
      toast.success("Workbook refreshed from D1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh workbook");
    } finally {
      setRefreshing(false);
    }
  }, [applyIncomingWorkbook, loadSyncStatus, fetchBudgetItems]);

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

  // ---------- Workbook cell updates (preserved) ----------
  const workbookForRender = draftWorkbook || workbook;

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
    if (!response.ok) throw new Error(payload.error || "Failed to refresh workbook in realtime");
    applyIncomingWorkbook(payload.workbook || null, payload.template || [], {
      flashChanges: true,
      resetDraft: true,
      clearDirty: true,
    });
    setReferenceSheets(payload.referenceSheets || []);
    await Promise.all([loadSyncStatus(), fetchBudgetItems()]);
  }, [applyIncomingWorkbook, loadSyncStatus, fetchBudgetItems]);

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

  const activeTabDefinition = useMemo(
    () => tabs.find((tab) => tab.tab === activeTab) || tabs[0] || null,
    [activeTab, tabs],
  );

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
        headers: { "Content-Type": "application/json" },
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

  // ---------- Item CRUD handlers ----------
  const handleSaveItem = useCallback(
    async (patch: Record<string, unknown>) => {
      if (viewMode === "add") {
        // CREATE
        const res = await fetch("/api/budget-tracker/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await res.json()) as { item?: BudgetItem; error?: string };
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
        toast.success("Budget item created");
      } else if (selectedItem) {
        // UPDATE
        const res = await fetch(`/api/budget-tracker/items/${selectedItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || !payload.success) throw new Error(payload.error || `HTTP ${res.status}`);
        toast.success("Budget item updated");
      }
      await fetchBudgetItems();
      setViewMode("list");
      setSelectedItem(null);
    },
    [viewMode, selectedItem, fetchBudgetItems],
  );

  const handleDeleteItem = useCallback(
    async (id: number) => {
      // Soft-delete by patching isActive → false via status change
      const res = await fetch(`/api/budget-tracker/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "deleted",
          changedBy: "homeowner",
          changeSource: "budget_tracker_ui",
        }),
      });
      const payload = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !payload.success) throw new Error(payload.error || `HTTP ${res.status}`);
      toast.success("Budget item marked as deleted");
      await fetchBudgetItems();
      setViewMode("list");
      setSelectedItem(null);
    },
    [fetchBudgetItems],
  );

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading budget tracker…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header card with sync controls */}
      <Card className="ring-1 ring-border/40">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-2xl">Budget + Scenario Tracker</CardTitle>
            <CardDescription>
              Budget items managed directly. Other tabs mirrored to Google Sheets.
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

      {/* Info strip */}
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

      {/* Budget Items — List or Detail */}
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Budget Items</CardTitle>
          <CardDescription>
            Manage budget line items directly. Click a row to view and edit details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {viewMode === "list" ? (
            <BudgetItemListView
              items={budgetItems}
              summary={budgetSummary}
              loading={itemsLoading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              executionFilter={executionFilter}
              setExecutionFilter={setExecutionFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              onSelectItem={(item) => {
                setSelectedItem(item);
                setViewMode("detail");
              }}
              onAddItem={() => {
                setSelectedItem(null);
                setViewMode("add");
              }}
              onRefresh={refreshBudgetItems}
              refreshing={itemsRefreshing}
            />
          ) : (
            <BudgetItemDetailForm
              item={viewMode === "add" ? null : selectedItem}
              onSave={handleSaveItem}
              onDelete={handleDeleteItem}
              onCancel={() => {
                setViewMode("list");
                setSelectedItem(null);
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Mirrored workbook tabs (non-Budget_Items) */}
      <WorkbookTabsSection
        tabs={tabs}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        workbook={workbook}
        draftWorkbook={draftWorkbook}
        dirtyCells={dirtyCells}
        flashedCells={flashedCells}
        updateCell={updateCell}
        addRow={addRow}
      />

      {/* Reference sheets */}
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
