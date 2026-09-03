/**
 * @fileoverview Budget command center — "Decision inbox" tab.
 *
 * Ranked list of open decisions, highest financial exposure first. The
 * server does the ranking (`ORDER BY exposure DESC` in
 * `GET /api/budget/inbox`) — this component only renders what it receives.
 */

import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  BudgetApiError,
  formatCents,
  getInbox,
  type InboxItem,
  useBudgetQuery,
} from "@/lib/budget-api";

const SEVERITY_META = {
  block: {
    label: "block",
    icon: AlertOctagon,
    dot: "bg-destructive",
    chipClassName: "",
    variant: "destructive" as const,
  },
  warn: {
    label: "warn",
    icon: AlertTriangle,
    dot: "bg-amber-500",
    chipClassName: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    variant: "outline" as const,
  },
  info: {
    label: "info",
    icon: Info,
    dot: "bg-muted-foreground",
    chipClassName: "",
    variant: "outline" as const,
  },
} as const;

const ACTION_LABEL: Record<InboxItem["actionKind"], string> = {
  review_contract: "Review contract",
  request_change_order: "Request change order",
  reconcile: "Reconcile",
  mark_resolved: "Mark resolved",
};

function DecisionCard({ item }: { item: InboxItem }) {
  const severity = SEVERITY_META[item.severity];
  const SeverityIcon = severity.icon;

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center"
      data-severity={item.severity}
    >
      <span
        aria-hidden="true"
        className={`hidden size-2 shrink-0 rounded-full sm:block ${severity.dot}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{item.title}</span>
          <Badge variant={severity.variant} className={severity.chipClassName}>
            <SeverityIcon className="size-3" aria-hidden="true" />
            {severity.label}
          </Badge>
        </div>
        {item.detail ? <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p> : null}
        {item.contextLabel ? (
          <div className="mt-1.5">
            <Badge variant="outline" className="text-muted-foreground">
              {item.contextLabel}
            </Badge>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        <span
          className="font-mono text-sm font-medium text-foreground"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatCents(item.exposureCents)}
        </span>
        <Button size="sm" render={<a href={item.actionHref} />}>
          {ACTION_LABEL[item.actionKind]}
        </Button>
      </div>
    </li>
  );
}

export function InboxTab() {
  const { data, isLoading, error, refetch } = useBudgetQuery(getInbox, []);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold leading-snug text-foreground">Decision inbox</h2>
        <p className="text-xs text-muted-foreground">
          Ranked by financial exposure. Resolve top-down.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading decisions…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Couldn't load the decision inbox
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof BudgetApiError ? `HTTP ${error.status} — ` : ""}
                {error.message}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 className="size-6 text-emerald-500" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Nothing waiting on you</p>
            <p className="text-xs text-muted-foreground">
              Every decision is resolved. New exposure will show up here first.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {data.items.map((item) => (
              <DecisionCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default InboxTab;
