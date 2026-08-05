/**
 * @fileoverview 0035 time-phased budget grid — the /admin/budget/grid island.
 *
 * A phase -> line-item budget grid with monthly columns and three views
 * (Estimate / Actuals / Variance) computed CLIENT-SIDE from the raw
 * `plan[]`/`actual[]` cent arrays that `GET /api/budget/grid` returns. The pure
 * per-cell + footer math lives in `./budget-grid-view` (self-checked out of the
 * bundle by scripts/tests/test_budget_grid_view.mjs). This file is the React
 * shell: fetch + filters, expand/collapse, inline plan edit, and the
 * Log-expense dialog.
 */
import {
  Loader2,
  Plus,
  Search,
  TriangleAlert,
  Check,
  Info,
  Wallet,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { api } from "@/components/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput, parsePriceCents } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  availableBudget,
  cumulativeVariance,
  formatCell,
  formatSignedUsd,
  formatUsd,
  monthlyVariance,
  netBurn,
  type View,
} from "./budget-grid-view";

// ─── API shape (mirrors src/backend/services/budget/grid.ts) ────────────────

type GridMonth = { period: string; label: string };
type GridFlag = {
  type: "destructive" | "warning" | "success";
  pct: number;
  note: string | null;
} | null;
type GridLine = {
  id: number;
  trackId: string;
  label: string;
  flag: GridFlag;
  plan: number[];
  actual: number[];
};
type GridPhase = {
  id: number;
  name: string;
  tone: string | null;
  progressPct: number;
  plan: number[];
  actual: number[];
  lines: GridLine[];
};
type Grid = {
  months: GridMonth[];
  phases: GridPhase[];
  footer: { fundingCents: number; monthPlanTotals: number[]; monthActualTotals: number[] };
  scorecards: {
    totalBudgetCents: number;
    spentCents: number;
    remainingCents: number;
    estimateCents: number;
    varianceCents: number;
    pctUsed: number;
    lineItemCount: number;
    phaseCount: number;
  };
};

const VIEWS: { id: View; label: string }[] = [
  { id: "estimate", label: "Estimate" },
  { id: "actuals", label: "Actuals" },
  { id: "variance", label: "Variance" },
];

/** Shift a 'YYYY-MM' period by `delta` calendar months (delta may be negative). */
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

/** Functional tone -> text color. Unknown tones (custom phase colors) fall back to muted. */
function toneColor(tone: string | null): string {
  switch (tone) {
    case "emerald":
      return "text-emerald-500";
    case "amber":
      return "text-amber-500";
    case "danger":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function cellToneClass(tone: "plain" | "zero" | "pos" | "neg"): string {
  switch (tone) {
    case "zero":
      return "text-muted-foreground/50";
    case "pos":
      return "text-emerald-500";
    case "neg":
      return "text-destructive";
    default:
      return "text-foreground";
  }
}

// ─── Small presentational pieces ────────────────────────────────────────────

function ProgressRing({
  pct,
  className,
  label,
}: {
  pct: number;
  className?: string;
  label: string;
}) {
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      role="img"
      aria-label={label}
      className={cn("shrink-0", className)}
    >
      <circle
        cx={10}
        cy={10}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={2.5}
      />
      <circle
        cx={10}
        cy={10}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function VarianceBadge({ flag }: { flag: NonNullable<GridFlag> }) {
  const { type, pct, note } = flag;
  const Icon = type === "destructive" ? TriangleAlert : type === "success" ? Check : Info;
  const variant =
    type === "destructive" ? "destructive" : type === "success" ? "secondary" : "outline";
  const direction = pct > 0 ? "under budget" : pct < 0 ? "over budget" : "flagged";
  const label = `${Math.abs(pct)}% ${direction}${note ? ` — ${note}` : ""}`;
  const text = `${pct > 0 ? "+" : ""}${pct}%`;

  const badge = (
    <Badge
      variant={variant}
      aria-label={label}
      className={cn(
        "gap-1 font-mono text-[0.7rem]",
        type === "success" && "text-emerald-500",
        type === "warning" && "text-amber-500",
      )}
    >
      <Icon aria-hidden className="size-3" />
      {text}
    </Badge>
  );

  if (!note) return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{note}</TooltipContent>
    </Tooltip>
  );
}

function Scorecard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card/40 p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      {children}
    </div>
  );
}

// ─── Log-expense dialog ─────────────────────────────────────────────────────

function LogExpenseDialog({
  open,
  onOpenChange,
  lines,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: { trackId: string; label: string; phaseName: string }[];
  onLogged: () => void;
}) {
  const [trackId, setTrackId] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [vendor, setVendor] = React.useState("");
  const [date, setDate] = React.useState("");
  const [amountText, setAmountText] = React.useState("");
  const [amountCents, setAmountCents] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Reset the form whenever the dialog opens fresh. Date defaults to today —
  // it's REQUIRED because computeGridMath skips any expense with a null
  // dateIncurred from Actuals bucketing (while it still counts in "Spent to
  // date"), so a dateless expense would vanish from the line it's meant to hit.
  React.useEffect(() => {
    if (open) {
      setTrackId("");
      setCategory("");
      setVendor("");
      setDate(new Date().toISOString().slice(0, 10));
      setAmountText("");
      setAmountCents(null);
    }
  }, [open]);

  const selectedLine = lines.find((l) => l.trackId === trackId) ?? null;
  const canSubmit =
    Boolean(trackId) &&
    amountCents !== null &&
    amountCents > 0 &&
    category.trim().length > 0 &&
    date.length > 0;

  async function submit() {
    if (!selectedLine || amountCents === null || saving) return;
    setSaving(true);
    try {
      await api("/api/budget-tracker/expenses", {
        method: "POST",
        body: JSON.stringify({
          item: selectedLine.label, // the expense is "for" this line
          category: category.trim(),
          amountCents,
          budgetItemTrackId: trackId, // links the expense into the line's Actuals
          vendorName: vendor.trim() || null,
          dateIncurred: date, // required + defaulted to today, so it always buckets
        }),
      });
      toast.success(`Logged ${formatUsd(amountCents)} to ${selectedLine.label}`);
      onOpenChange(false);
      onLogged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to log expense");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log expense</DialogTitle>
          <DialogDescription>
            Attribute a real cost to a budget line. It rolls straight into that line's Actuals.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expense-line">Budget line</Label>
            <Select value={trackId} onValueChange={(v) => setTrackId(v ?? "")}>
              <SelectTrigger id="expense-line" className="h-9">
                <SelectValue placeholder="Choose a line item" />
              </SelectTrigger>
              <SelectContent>
                {lines.map((line) => (
                  <SelectItem key={line.trackId} value={line.trackId}>
                    {line.label}
                    <span className="ml-1 text-muted-foreground">· {line.phaseName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expense-amount">Amount</Label>
            <CurrencyInput
              id="expense-amount"
              aria-label="Expense amount"
              value={amountText}
              onValueChange={(text, cents) => {
                setAmountText(text);
                setAmountCents(cents);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expense-category">Category</Label>
              <Input
                id="expense-category"
                placeholder="e.g. Fixtures"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expense-vendor">Vendor (optional)</Label>
            <Input
              id="expense-vendor"
              placeholder="e.g. Ferguson"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            Log expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main app ───────────────────────────────────────────────────────────────

export function BudgetGridApp() {
  const [grid, setGrid] = React.useState<Grid | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [view, setView] = React.useState<View>("variance");
  const [searchInput, setSearchInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [phase, setPhase] = React.useState("all");
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null);

  const [collapsed, setCollapsed] = React.useState<Set<number>>(new Set());
  const [logOpen, setLogOpen] = React.useState(false);

  // Inline plan edit (Estimate view only): which cell is open + its draft text.
  const [editing, setEditing] = React.useState<{ trackId: string; monthIdx: number } | null>(null);
  const [editText, setEditText] = React.useState("");

  // Roving-tabindex refs for the view tablist (arrow-key navigation).
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End")
      return;
    e.preventDefault();
    const last = VIEWS.length - 1;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? last
          : e.key === "ArrowRight"
            ? (index + 1) % VIEWS.length
            : (index - 1 + VIEWS.length) % VIEWS.length;
    setView(VIEWS[next].id);
    tabRefs.current[next]?.focus();
  }

  // Debounce the search box into the query that drives the fetch.
  React.useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (phase !== "all") params.set("phase", phase);
      if (range) {
        params.set("from", range.from);
        params.set("to", range.to);
      }
      const qs = params.toString();
      const res = await api<{ grid: Grid }>(`/api/budget/grid${qs ? `?${qs}` : ""}`);
      setGrid(res.grid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load budget grid");
    } finally {
      setLoading(false);
    }
  }, [query, phase, range]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const searchActive = query.length > 0;
  const isCollapsed = React.useCallback(
    (phaseId: number) => !searchActive && collapsed.has(phaseId),
    [collapsed, searchActive],
  );

  function togglePhase(phaseId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  function expandAll() {
    setCollapsed(new Set());
  }
  function collapseAll() {
    if (grid) setCollapsed(new Set(grid.phases.map((p) => p.id)));
  }

  // Month-range stepper: initialize from the current window if the user hasn't
  // pinned one yet, then pan both ends by ±1 month.
  function stepRange(delta: number) {
    if (!grid || grid.months.length === 0) return;
    const base = range ?? {
      from: grid.months[0].period,
      to: grid.months[grid.months.length - 1].period,
    };
    setRange({ from: shiftPeriod(base.from, delta), to: shiftPeriod(base.to, delta) });
  }

  // Optimistic inline plan edit -> PATCH /api/budget/plan-schedule.
  async function commitEdit(line: GridLine, monthIdx: number, cents: number, text: string) {
    setEditing(null);
    if (!grid) return;
    const period = grid.months[monthIdx].period;
    const prev = line.plan[monthIdx];
    if (cents === prev) return;

    // Optimistic: patch the local grid so the cell (and its phase total) update now.
    setGrid((g) => {
      if (!g) return g;
      return {
        ...g,
        phases: g.phases.map((p) => ({
          ...p,
          lines: p.lines.map((l) =>
            l.trackId === line.trackId
              ? { ...l, plan: l.plan.map((v, i) => (i === monthIdx ? cents : v)) }
              : l,
          ),
        })),
      };
    });

    try {
      await api("/api/budget/plan-schedule", {
        method: "PATCH",
        body: JSON.stringify({
          trackId: line.trackId,
          period,
          plannedCents: cents,
          plannedText: text || undefined,
        }),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save plan — reverting");
      void load(); // reload authoritative values
    }
  }

  const months = grid?.months ?? [];
  const flatLines = React.useMemo(
    () =>
      (grid?.phases ?? []).flatMap((p) =>
        p.lines.map((l) => ({ trackId: l.trackId, label: l.label, phaseName: p.name })),
      ),
    [grid],
  );

  // Footer rollup rows for the active view.
  const footerRows = React.useMemo(() => {
    if (!grid) return null;
    const { fundingCents, monthPlanTotals, monthActualTotals } = grid.footer;
    if (view === "variance") {
      return [
        {
          label: "Cumulative variance",
          values: cumulativeVariance(monthPlanTotals, monthActualTotals),
          signed: true,
        },
        {
          label: "Monthly variance",
          values: monthlyVariance(monthPlanTotals, monthActualTotals),
          signed: true,
        },
      ];
    }
    return [
      {
        // Signed: a negative available balance (burn past funding) must read
        // as negative, and turn red via the signed footer styling.
        label: "Available budget",
        values: availableBudget(fundingCents, monthActualTotals),
        signed: true,
      },
      { label: "Net burn", values: netBurn(monthActualTotals), signed: true },
    ];
  }, [grid, view]);

  const rangeLabel =
    months.length > 0 ? `${months[0].label} – ${months[months.length - 1].label}` : "No months";

  // ── Loading ──
  if (loading && !grid) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  // ── Error ──
  if (error && !grid) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-10 text-center">
        <TriangleAlert aria-hidden className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  const sc = grid?.scorecards;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {/* Scorecards */}
        {sc ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Scorecard
              label="Total budget"
              value={formatUsd(sc.totalBudgetCents)}
              sub={`${sc.phaseCount} phases · ${sc.lineItemCount} line items`}
            />
            <Scorecard label="Spent to date" value={formatUsd(sc.spentCents)}>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${sc.pctUsed}% of budget spent`}
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    sc.pctUsed > 100 ? "bg-destructive" : "bg-primary",
                  )}
                  style={{ width: `${Math.min(100, sc.pctUsed)}%` }}
                />
              </div>
              <span className="mt-1 text-xs text-muted-foreground">{sc.pctUsed}% used</span>
            </Scorecard>
            <Scorecard
              label="Remaining"
              value={formatSignedUsd(sc.remainingCents)}
              sub={
                sc.totalBudgetCents === 0 ? (
                  // No funding configured — there's no budget to be "over".
                  <span className="text-muted-foreground">No funding set</span>
                ) : (
                  <span className={sc.remainingCents < 0 ? "text-destructive" : "text-emerald-500"}>
                    {sc.remainingCents < 0 ? "Over budget" : "On track"}
                  </span>
                )
              }
            />
            <Scorecard
              label="Variance vs estimate"
              value={formatSignedUsd(sc.varianceCents)}
              sub={
                <span className={sc.varianceCents < 0 ? "text-destructive" : "text-emerald-500"}>
                  {sc.estimateCents > 0
                    ? `${Math.round((100 * sc.varianceCents) / sc.estimateCents)}% vs plan`
                    : "No estimate yet"}
                </span>
              }
            />
          </div>
        ) : null}

        {/* Tabs + expand/collapse */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Budget view"
            className="inline-flex rounded-lg border bg-card/40 p-0.5"
          >
            {VIEWS.map((v, idx) => (
              <button
                key={v.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                aria-selected={view === v.id}
                tabIndex={view === v.id ? 0 : -1}
                onClick={() => setView(v.id)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Button variant="ghost" size="sm" onClick={expandAll}>
              Expand all
            </Button>
            <span className="text-muted-foreground">/</span>
            <Button variant="ghost" size="sm" onClick={collapseAll}>
              Collapse all
            </Button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-8"
              placeholder="Search line items"
              aria-label="Search line items"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select value={phase} onValueChange={(v) => setPhase(v ?? "all")}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder="All phases" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All phases</SelectItem>
              {(grid?.phases ?? []).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="inline-flex items-center gap-1 rounded-lg border bg-card/40 px-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Earlier months"
              onClick={() => stepRange(-1)}
              disabled={months.length === 0}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <span className="min-w-[150px] text-center text-sm tabular-nums text-muted-foreground">
              {rangeLabel}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Later months"
              onClick={() => stepRange(1)}
              disabled={months.length === 0}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
          <Button className="ml-auto gap-1.5" onClick={() => setLogOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Log expense
          </Button>
        </div>

        {/* Grid */}
        {months.length === 0 || (grid?.phases.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
            <Wallet aria-hidden className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No budget data in this window</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {searchActive || phase !== "all"
                ? "No line items match the current filters. Clear the search or phase filter."
                : "Seed the plan schedule or log an expense to populate the time-phased grid."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="sticky left-0 z-10 bg-muted/30 px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Line item
                  </th>
                  {months.map((m, i) => (
                    <th
                      key={m.period}
                      className={cn(
                        "px-4 py-2.5 text-right font-medium tabular-nums text-muted-foreground",
                        i === months.length - 1 && "bg-muted/50",
                      )}
                    >
                      {m.label}
                    </th>
                  ))}
                  <th className="w-4" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {(grid?.phases ?? []).map((p) => {
                  const phaseCollapsed = isCollapsed(p.id);
                  return (
                    <React.Fragment key={p.id}>
                      {/* Phase row */}
                      <tr className="border-b bg-card/30 font-medium">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-card/30 px-4 py-2.5 text-left"
                        >
                          <button
                            onClick={() => togglePhase(p.id)}
                            disabled={searchActive}
                            aria-expanded={!phaseCollapsed}
                            className="flex items-center gap-2 text-left disabled:opacity-70"
                          >
                            <ChevronDown
                              aria-hidden
                              className={cn(
                                "size-4 text-muted-foreground transition-transform",
                                phaseCollapsed && "-rotate-90",
                              )}
                            />
                            <span className={toneColor(p.tone)}>
                              <ProgressRing
                                pct={p.progressPct}
                                label={`${p.name} ${p.progressPct}% of plan spent`}
                              />
                            </span>
                            <span className="tabular-nums text-xs text-muted-foreground">
                              {p.progressPct}%
                            </span>
                            <span className="text-foreground">{p.name}</span>
                          </button>
                        </th>
                        {months.map((m, i) => {
                          const c = formatCell(view, p.plan[i], p.actual[i]);
                          return (
                            <td
                              key={m.period}
                              className={cn(
                                "px-4 py-2.5 text-right font-mono tabular-nums",
                                cellToneClass(c.tone),
                                i === months.length - 1 && "bg-muted/30",
                              )}
                            >
                              {c.text}
                            </td>
                          );
                        })}
                        <td aria-hidden />
                      </tr>

                      {/* Line rows */}
                      {!phaseCollapsed &&
                        p.lines.map((line) => (
                          <tr key={line.id} className="border-b border-border/50 last:border-b-0">
                            <td className="sticky left-0 z-10 bg-background py-2 pl-10 pr-4">
                              <div className="flex items-center gap-2 border-l border-border pl-3">
                                <span className="text-muted-foreground">{line.label}</span>
                                {line.flag ? <VarianceBadge flag={line.flag} /> : null}
                              </div>
                            </td>
                            {months.map((m, i) => {
                              const isEditing =
                                view === "estimate" &&
                                editing?.trackId === line.trackId &&
                                editing?.monthIdx === i;
                              const c = formatCell(view, line.plan[i], line.actual[i]);
                              const editable = view === "estimate";
                              return (
                                <td
                                  key={m.period}
                                  className={cn(
                                    "px-4 py-2 text-right font-mono tabular-nums",
                                    cellToneClass(c.tone),
                                    i === months.length - 1 && "bg-muted/20",
                                  )}
                                >
                                  {isEditing ? (
                                    <CurrencyInput
                                      autoFocus
                                      aria-label={`Planned amount for ${line.label}, ${m.label}`}
                                      className="ml-auto w-28"
                                      value={editText}
                                      onValueChange={(text) => setEditText(text)}
                                      onBlur={(e) =>
                                        void commitEdit(
                                          line,
                                          i,
                                          parsePriceCents(e.target.value) ?? line.plan[i],
                                          editText,
                                        )
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          (e.target as HTMLInputElement).blur();
                                        if (e.key === "Escape") setEditing(null);
                                      }}
                                    />
                                  ) : editable ? (
                                    <button
                                      className="ml-auto block w-full rounded px-1 text-right hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label={`Edit planned amount for ${line.label}, ${m.label} (currently ${c.text})`}
                                      onClick={() => {
                                        setEditing({ trackId: line.trackId, monthIdx: i });
                                        setEditText(
                                          line.plan[i]
                                            ? String((line.plan[i] / 100).toFixed(2))
                                            : "",
                                        );
                                      }}
                                    >
                                      {c.text}
                                    </button>
                                  ) : (
                                    c.text
                                  )}
                                </td>
                              );
                            })}
                            <td aria-hidden />
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {footerRows ? (
                <tfoot>
                  {footerRows.map((row) => (
                    <tr key={row.label} className="border-t bg-muted/30 font-medium">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-muted/30 px-4 py-2.5 text-left text-muted-foreground"
                      >
                        {row.label}
                      </th>
                      {row.values.map((v, i) => (
                        <td
                          key={months[i]?.period ?? i}
                          className={cn(
                            "px-4 py-2.5 text-right font-mono tabular-nums",
                            row.signed && v < 0 && "text-destructive",
                            row.signed && v > 0 && "text-emerald-500",
                            i === months.length - 1 && "bg-muted/50",
                          )}
                        >
                          {row.signed ? formatSignedUsd(v) : formatUsd(v)}
                        </td>
                      ))}
                      <td aria-hidden />
                    </tr>
                  ))}
                </tfoot>
              ) : null}
            </table>
          </div>
        )}

        {/* Footer / count */}
        {sc ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Rows per page: <span className="tabular-nums">50</span>
            </span>
            <span className="tabular-nums">
              1–{Math.min(50, flatLines.length)} of {flatLines.length} line items
            </span>
          </div>
        ) : null}
      </div>

      <LogExpenseDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        lines={flatLines}
        onLogged={() => void load()}
      />
    </TooltipProvider>
  );
}
