import { TriangleAlert } from "lucide-react";
/**
 * @fileoverview Budget Command Center — workbench shell.
 *
 * Header (project + KPIs + "N decisions waiting" + Log expense) and the
 * six-tab shell from `docs/plans/budget-command-center/screens/6-workbench-shell.html`.
 * Fetches `getWorkbenchSummary()` once and hands KPI + tab-count data down;
 * each tab fetches its own data. Only the active tab's component mounts.
 * Tab state lives in the `?tab=` query string so tabs deep-link and back
 * works.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatCents,
  getWorkbenchSummary,
  useBudgetQuery,
  type WorkbenchSummary,
} from "@/lib/budget-api";
import { cn } from "@/lib/utils";

import { ComplianceTab } from "./ComplianceTab";
import { EstimatesTab } from "./EstimatesTab";
import { GridTab } from "./GridTab";
import { InboxTab } from "./InboxTab";
import { LogExpenseDialog } from "./LogExpenseDialog";
import { RoomsTab } from "./RoomsTab";
import { SavingsTab } from "./SavingsTab";

const TAB_KEYS = ["grid", "inbox", "estimates", "rooms", "savings", "compliance"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  grid: "Grid",
  inbox: "Inbox",
  estimates: "Estimates",
  rooms: "Rooms",
  savings: "Savings",
  compliance: "Compliance",
};

function isTabKey(value: string | null): value is TabKey {
  return !!value && (TAB_KEYS as readonly string[]).includes(value);
}

function readTabFromUrl(): TabKey {
  if (typeof window === "undefined") return "grid";
  const raw = new URLSearchParams(window.location.search).get("tab");
  return isTabKey(raw) ? raw : "grid";
}

function varianceColorClass(direction: WorkbenchSummary["kpis"]["varianceDirection"]): string {
  if (direction === "over") return "text-amber-500";
  if (direction === "under") return "text-emerald-500";
  return "text-muted-foreground";
}

export function BudgetWorkbench() {
  const [tab, setTab] = useState<TabKey>(() => readTabFromUrl());

  const {
    data: summary,
    error,
    isLoading,
    refetch: refetchSummary,
  } = useBudgetQuery<WorkbenchSummary>((signal) => getWorkbenchSummary(signal), []);

  useEffect(() => {
    const onPopState = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function selectTab(next: string) {
    if (!isTabKey(next)) return;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState({}, "", url);
  }

  const counts = summary?.tabCounts;
  const tabCount: Partial<Record<TabKey, number>> = {
    inbox: counts?.inbox,
    estimates: counts?.estimates,
    rooms: counts?.rooms,
    compliance: counts?.compliance,
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 rounded-xl bg-card px-5 py-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {summary?.project.name ?? (isLoading ? "Loading…" : "—")}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {summary?.project.addressLine ?? ""}
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-500"
          >
            <TriangleAlert />
            {summary?.decisionsWaiting ?? 0} decisions waiting
          </Badge>
          <LogExpenseDialog onLogged={refetchSummary} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load budget summary: {error.message}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total budget"
          value={summary ? formatCents(summary.kpis.totalBudgetCents) : "—"}
          sub={summary ? `${summary.kpis.fundingAccountCount} funding accounts` : undefined}
        />
        <KpiCard
          label="Spent to date"
          value={summary ? formatCents(summary.kpis.spentToDateCents) : "—"}
        >
          {summary && (
            <>
              <Progress
                value={Math.round(summary.kpis.spentPctOfBudget * 100)}
                className="mt-2.5"
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {Math.round(summary.kpis.spentPctOfBudget * 100)}% of budget
              </div>
            </>
          )}
        </KpiCard>
        <KpiCard
          label="Remaining"
          value={summary ? formatCents(summary.kpis.remainingCents) : "—"}
          sub={
            summary?.kpis.runwayMonths != null
              ? `≈ ${summary.kpis.runwayMonths.toFixed(1)} months at current burn`
              : undefined
          }
        />
        <KpiCard
          label="Variance vs estimate"
          value={summary ? formatCents(summary.kpis.varianceVsEstimateCents) : "—"}
          valueClassName={summary ? varianceColorClass(summary.kpis.varianceDirection) : undefined}
        >
          {summary && (
            <div
              className={cn(
                "mt-1.5 text-[11px] font-medium",
                varianceColorClass(summary.kpis.varianceDirection),
              )}
            >
              {summary.kpis.varianceDirection === "over"
                ? "Over estimate"
                : summary.kpis.varianceDirection === "under"
                  ? "Under estimate"
                  : "On estimate"}
            </div>
          )}
        </KpiCard>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(value) => selectTab(String(value))}>
        <TabsList variant="line">
          {TAB_KEYS.map((key) => {
            const count = tabCount[key];
            return (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                {TAB_LABELS[key]}
                {count !== undefined && (
                  <Badge
                    variant={key === "inbox" && count > 0 ? "destructive" : "secondary"}
                    className="h-4 min-w-4 px-1 font-mono text-[10px] tabular-nums"
                  >
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Only the active tab's component mounts */}
      {tab === "grid" && <GridTab />}
      {tab === "inbox" && <InboxTab />}
      {tab === "estimates" && <EstimatesTab />}
      {tab === "rooms" && <RoomsTab />}
      {tab === "savings" && <SavingsTab />}
      {tab === "compliance" && <ComplianceTab />}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  children?: ReactNode;
}

function KpiCard({ label, value, sub, valueClassName, children }: KpiCardProps) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 font-mono text-[22px] leading-none font-semibold tabular-nums tracking-tight",
          valueClassName,
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
      {children}
    </div>
  );
}

export default BudgetWorkbench;
