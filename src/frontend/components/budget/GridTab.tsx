/**
 * @fileoverview Budget Command Center — "Grid" tab.
 *
 * Time-phased budget grid: phase-grouped line items × month columns, from
 * `GET /api/budget/grid` (`docs/plans/budget-command-center/screens/1-budget-grid.html`,
 * `API-CONTRACT.md` §2). The Estimate / Actuals / Variance toggle switches
 * which number each month cell (and the Total column) shows; the trailing
 * "Variance" column is a fixed per-row summary that doesn't change with the
 * toggle. Dashed cells are editable planned amounts — committed inline via
 * `PATCH /api/budget/plan-schedule`, applied optimistically and rolled back
 * (with a visible error) if the request fails.
 *
 * ZERO SQL here — all data comes from `@/lib/budget-api`.
 */
import { Check, CircleAlert, Loader2, Minus, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parsePriceCents } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatCents,
  getGrid,
  patchPlanSchedule,
  useBudgetQuery,
  type BudgetGrid,
  type BudgetGridCell,
  type BudgetGridRow,
  type BudgetGridView,
} from "@/lib/budget-api";
import { cn } from "@/lib/utils";

const VIEWS: Array<{ key: BudgetGridView; label: string }> = [
  { key: "estimate", label: "Estimate" },
  { key: "actuals", label: "Actuals" },
  { key: "variance", label: "Variance" },
];

/** No date picker in this pass — 2 months back, 3 ahead of today. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const key = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  return { from: key(-2), to: key(3) };
}

type CellKey = `${number}:${string}`;
const cellKey = (lineItemId: number, month: string): CellKey => `${lineItemId}:${month}`;

/** `+$1,234` / `-$1,234` / `$0` — used wherever the number's sign is the point. */
function formatSigned(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${cents > 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

/** Mirrors `varianceColorClass` in BudgetWorkbench.tsx: positive = over (amber), negative = under (green). */
function varianceMeta(varianceCents: number) {
  if (varianceCents > 0) {
    return {
      label: `${formatCents(varianceCents)} over`,
      className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
      Icon: TriangleAlert,
    };
  }
  if (varianceCents < 0) {
    return {
      label: `${formatCents(Math.abs(varianceCents))} under`,
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
      Icon: Check,
    };
  }
  return {
    label: "On estimate",
    className: "border-border text-muted-foreground",
    Icon: Minus,
  };
}

interface CellDisplay {
  text: string;
  editable: boolean;
  variance: boolean;
}

function cellDisplay(
  view: BudgetGridView,
  cell: BudgetGridCell,
  plannedOverride: number | null | undefined,
): CellDisplay {
  const planned = plannedOverride !== undefined ? plannedOverride : cell.plannedCents;

  if (view === "variance") {
    if (cell.actualCents == null || planned == null) {
      return { text: "—", editable: false, variance: false };
    }
    return { text: formatSigned(cell.actualCents - planned), editable: false, variance: true };
  }

  if (view === "estimate") {
    return {
      text: planned == null ? "—" : formatCents(planned),
      editable: cell.isEditable,
      variance: false,
    };
  }

  // actuals: show the posted actual when there is one; otherwise fall back to
  // the (editable) planned amount, same as the design's "Actuals" mock.
  if (cell.actualCents != null) {
    return { text: formatCents(cell.actualCents), editable: false, variance: false };
  }
  return {
    text: planned == null ? "—" : formatCents(planned),
    editable: cell.isEditable,
    variance: false,
  };
}

export function GridTab() {
  const [view, setView] = useState<BudgetGridView>("actuals");
  const [range] = useState(defaultRange);
  const [overrides, setOverrides] = useState<Map<CellKey, number | null>>(new Map());
  const [editing, setEditing] = useState<CellKey | null>(null);
  const [draft, setDraft] = useState("");
  const [savingKey, setSavingKey] = useState<CellKey | null>(null);
  const [cellError, setCellError] = useState<{ key: CellKey; message: string } | null>(null);

  const { data, error, isLoading, refetch } = useBudgetQuery<BudgetGrid>(
    (signal) => getGrid({ ...range, view }, signal),
    [range.from, range.to, view],
  );

  function startEdit(row: BudgetGridRow, month: string, cell: BudgetGridCell) {
    const key = cellKey(row.lineItemId, month);
    const planned = overrides.has(key) ? overrides.get(key)! : cell.plannedCents;
    setEditing(key);
    setDraft(planned == null ? "" : (planned / 100).toFixed(2));
    setCellError(null);
  }

  async function commitEdit(row: BudgetGridRow, month: string, cell: BudgetGridCell) {
    const key = cellKey(row.lineItemId, month);
    const previous = overrides.has(key) ? overrides.get(key)! : cell.plannedCents;
    const parsed = draft.trim() === "" ? null : parsePriceCents(draft);
    setEditing(null);
    if (parsed === previous) return;

    setOverrides((m) => new Map(m).set(key, parsed));
    setSavingKey(key);
    try {
      await patchPlanSchedule({ lineItemId: row.lineItemId, month, plannedCents: parsed });
      // ponytail: not refetching here — useBudgetQuery's refetch flips isLoading
      // and blanks the whole grid mid-edit. The edited cell is already correct
      // via `overrides`; Total/subtotal/Variance catch up on the next natural
      // refetch (tab revisit). Upgrade to a silent background refresh if that
      // staleness matters in practice.
    } catch (err) {
      setOverrides((m) => new Map(m).set(key, previous)); // rollback
      setCellError({
        key,
        message: `${row.title} · ${month}: ${err instanceof Error ? err.message : "Failed to save"}`,
      });
    } finally {
      setSavingKey(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border bg-card p-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading budget grid…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-10 text-center">
        <CircleAlert aria-hidden className="size-6 text-destructive" />
        <p className="text-sm font-medium text-destructive">Couldn't load the budget grid</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const phases = data?.phases ?? [];
  const months = data?.months ?? [];
  const hasRows = phases.some((p) => p.rows.length > 0);

  if (!hasRows) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No budget line items in this range.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(value) => setView(String(value) as BudgetGridView)}>
          <TabsList aria-label="Budget grid view">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.key} value={v.key}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {cellError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>Couldn't save {cellError.message}</span>
          <button
            type="button"
            onClick={() => setCellError(null)}
            className="rounded-sm p-0.5 hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="sticky left-0 z-10 min-w-52 bg-card">
                Line item
              </TableHead>
              {months.map((m) => (
                <TableHead key={m.key} scope="col" className="text-right font-mono tabular-nums">
                  {m.label}
                </TableHead>
              ))}
              <TableHead scope="col" className="text-right font-mono tabular-nums">
                Total
              </TableHead>
              <TableHead scope="col" className="min-w-40">
                Variance
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {phases.map((phase) => (
              <PhaseGroup
                key={phase.phaseId}
                phase={phase}
                months={months}
                view={view}
                overrides={overrides}
                editing={editing}
                draft={draft}
                savingKey={savingKey}
                onStartEdit={startEdit}
                onDraftChange={setDraft}
                onCommit={commitEdit}
                onCancel={() => setEditing(null)}
              />
            ))}
          </TableBody>
        </Table>

        {data?.footer && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border px-3.5 py-2.5">
            <div className="text-xs text-muted-foreground">
              Available budget{" "}
              <span className="ml-1.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatCents(data.footer.availableBudgetCents)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Net burn{" "}
              <span className="ml-1.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatCents(data.footer.netBurnCents)}/mo
              </span>
            </div>
            <div className="ml-auto text-[11px] text-muted-foreground">
              Dashed cells are editable planned amounts
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface PhaseGroupProps {
  phase: BudgetGrid["phases"][number];
  months: BudgetGrid["months"];
  view: BudgetGridView;
  overrides: Map<CellKey, number | null>;
  editing: CellKey | null;
  draft: string;
  savingKey: CellKey | null;
  onStartEdit: (row: BudgetGridRow, month: string, cell: BudgetGridCell) => void;
  onDraftChange: (value: string) => void;
  onCommit: (row: BudgetGridRow, month: string, cell: BudgetGridCell) => void;
  onCancel: () => void;
}

function PhaseGroup({
  phase,
  months,
  view,
  overrides,
  editing,
  draft,
  savingKey,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
}: PhaseGroupProps) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableHead
          scope="rowgroup"
          className="sticky left-0 z-10 bg-muted/40 text-xs font-semibold text-foreground"
        >
          {phase.name}
        </TableHead>
        <TableCell colSpan={Math.max(months.length, 1)} aria-hidden="true" />
        <TableCell className="text-right font-mono text-xs font-semibold tabular-nums text-muted-foreground">
          {formatCents(phase.subtotalCents)}
        </TableCell>
        <TableCell aria-hidden="true" />
      </TableRow>
      {phase.rows.map((row) => (
        <GridRow
          key={row.lineItemId}
          row={row}
          phaseLabel={phase.name}
          months={months}
          view={view}
          overrides={overrides}
          editing={editing}
          draft={draft}
          savingKey={savingKey}
          onStartEdit={onStartEdit}
          onDraftChange={onDraftChange}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ))}
    </>
  );
}

interface GridRowProps {
  row: BudgetGridRow;
  phaseLabel: string;
  months: BudgetGrid["months"];
  view: BudgetGridView;
  overrides: Map<CellKey, number | null>;
  editing: CellKey | null;
  draft: string;
  savingKey: CellKey | null;
  onStartEdit: (row: BudgetGridRow, month: string, cell: BudgetGridCell) => void;
  onDraftChange: (value: string) => void;
  onCommit: (row: BudgetGridRow, month: string, cell: BudgetGridCell) => void;
  onCancel: () => void;
}

function GridRow({
  row,
  phaseLabel,
  months,
  view,
  overrides,
  editing,
  draft,
  savingKey,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
}: GridRowProps) {
  const vMeta = varianceMeta(row.varianceCents);
  const totalText =
    view === "variance" ? formatSigned(row.totalCents) : formatCents(row.totalCents);

  return (
    <TableRow>
      <TableHead
        scope="row"
        className="sticky left-0 z-10 bg-card align-top font-normal whitespace-normal"
      >
        <div className="font-medium text-foreground">{row.title}</div>
        {row.vendorLabel && <div className="text-xs text-muted-foreground">{row.vendorLabel}</div>}
        <Badge variant="outline" className="mt-1.5 text-muted-foreground">
          {phaseLabel}
        </Badge>
        {row.note && <div className="mt-1 text-[10.5px] text-muted-foreground">{row.note}</div>}
      </TableHead>

      {months.map((m) => {
        const cell = row.cells[m.key];
        const key = cellKey(row.lineItemId, m.key);
        if (!cell) {
          return (
            <TableCell
              key={m.key}
              className="text-right font-mono text-sm tabular-nums text-muted-foreground"
            >
              —
            </TableCell>
          );
        }

        const override = overrides.get(key);
        const display = cellDisplay(view, cell, override);
        const isEditingThis = editing === key;
        const isSaving = savingKey === key;

        return (
          <TableCell key={m.key} className="text-right">
            {isEditingThis ? (
              <Input
                autoFocus
                type="text"
                inputMode="decimal"
                value={draft}
                aria-label={`Planned amount for ${row.title}, ${m.label}`}
                className="h-7 w-24 rounded-md px-1.5 text-right font-mono text-sm tabular-nums"
                onChange={(e) => onDraftChange(e.target.value)}
                onBlur={() => onCommit(row, m.key, cell)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onCancel();
                  }
                }}
              />
            ) : display.editable ? (
              <button
                type="button"
                onClick={() => onStartEdit(row, m.key, cell)}
                disabled={isSaving}
                aria-label={`Edit planned amount for ${row.title}, ${m.label}: ${display.text}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm border-b border-dashed border-muted-foreground/40 font-mono text-sm tabular-nums text-foreground hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSaving && "opacity-60",
                )}
              >
                {isSaving && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                {display.text}
              </button>
            ) : (
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  display.text === "—" ? "text-muted-foreground" : "text-foreground",
                  display.variance && display.text.startsWith("+") && "text-amber-500",
                  display.variance && display.text.startsWith("-") && "text-emerald-500",
                )}
              >
                {display.text}
              </span>
            )}
          </TableCell>
        );
      })}

      <TableCell className="text-right font-mono text-sm font-medium tabular-nums">
        {totalText}
      </TableCell>

      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className={cn("w-fit gap-1", vMeta.className)}>
            <vMeta.Icon aria-hidden="true" />
            {vMeta.label}
          </Badge>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default GridTab;
