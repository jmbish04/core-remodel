/**
 * @fileoverview 0035 Phase 4 budget workbench — the /admin/budget/inbox island.
 *
 * Two stacked read surfaces over the Phase 4 backend
 * (`src/backend/api/routes/budget-workbench.ts`):
 *  - Decision inbox: `GET /api/budget/inbox` — derived alerts ("what needs my
 *    attention"), already severity-sorted server-side (`services/budget/inbox.ts`).
 *  - Room finances: `GET /api/budget/rooms-finance` — committed vs spent vs
 *    remaining per room (`services/budget/rooms-finance.ts`).
 *
 * Both are read-only rollups; this island has no mutations of its own — an
 * alert's action button just navigates to the surface that can fix it.
 */
import { CircleAlert, Inbox, Info, TriangleAlert } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { api } from "@/components/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─── API shapes (mirror src/backend/services/budget/{inbox,rooms-finance}.ts) ─

type AlertSeverity = "critical" | "warning" | "info" | (string & {});
type BudgetAlert = {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  entity: Record<string, unknown>;
  action: { label: string; target: string };
};
type BudgetInbox = { alerts: BudgetAlert[] };

type RiskLevel = "over" | "watch" | "ok" | (string & {});
type RoomFinance = {
  roomId: number;
  roomName: string;
  committedCents: number;
  spentCents: number;
  remainingCents: number;
  openMaterials: number;
  riskLevel: RiskLevel;
};
type RoomsFinance = {
  rooms: RoomFinance[];
  totals: {
    committedCents: number;
    spentCents: number;
    remainingCents: number;
    openMaterials: number;
  };
};

/** Format an integer cents value as `$1,234.56`. Local copy — mirrors the same helper in services/budget/inbox.ts. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Best-effort entity chip text — falls back to the entity's own `type` when there's no id/name to show. */
function entityLabel(entity: Record<string, unknown>): string {
  const name = entity.name ?? entity.id;
  const type = typeof entity.type === "string" ? entity.type.replace(/_/g, " ") : "entity";
  return name != null ? `${type} · ${String(name)}` : type;
}

// ─── Decision inbox ─────────────────────────────────────────────────────────

/** Severity -> icon + Badge styling. Anything other than critical/warning (e.g. "info", or a future type) falls back to muted — never assume only two severities exist. */
function severityMeta(severity: AlertSeverity): {
  icon: typeof TriangleAlert;
  badgeVariant: "destructive" | "outline" | "secondary";
  badgeClassName?: string;
  cardClassName: string;
} {
  switch (severity) {
    case "critical":
      return {
        icon: CircleAlert,
        badgeVariant: "destructive",
        cardClassName: "border-destructive/30 bg-destructive/5",
      };
    case "warning":
      return {
        icon: TriangleAlert,
        badgeVariant: "outline",
        badgeClassName: "text-amber-500",
        cardClassName: "border-amber-500/30 bg-amber-500/5",
      };
    default:
      return {
        icon: Info,
        badgeVariant: "secondary",
        cardClassName: "border-border bg-card/40",
      };
  }
}

function AlertCard({ alert }: { alert: BudgetAlert }) {
  const meta = severityMeta(alert.severity);
  const Icon = meta.icon;
  return (
    <Card className={cn("gap-3 py-4", meta.cardClassName)}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-1">
              <span className="font-medium leading-snug">{alert.title}</span>
              <span className="text-sm text-muted-foreground">{alert.detail}</span>
            </div>
          </div>
          <Badge
            variant={meta.badgeVariant}
            className={cn("shrink-0", meta.badgeClassName)}
            aria-label={`Severity: ${alert.severity}`}
          >
            {alert.severity}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-2 pl-6">
          <Badge variant="outline" className="text-muted-foreground">
            {entityLabel(alert.entity)}
          </Badge>
          <Button size="sm" variant="outline" render={<a href={alert.action.target} />}>
            {alert.action.label}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionInbox() {
  const [inbox, setInbox] = React.useState<BudgetInbox | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<BudgetInbox>("/api/budget/inbox")
      .then((res) => {
        if (!cancelled) setInbox(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load the decision inbox";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (error && !inbox) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
        <TriangleAlert aria-hidden className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const alerts = inbox?.alerts ?? [];
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <Inbox aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No alerts — all clear.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} />
      ))}
    </div>
  );
}

// ─── Room finances ──────────────────────────────────────────────────────────

/** Risk level -> Badge styling. Text always backs the color (badge label), never color-only. */
function riskBadge(risk: RiskLevel) {
  switch (risk) {
    case "over":
      return (
        <Badge variant="destructive" aria-label="Risk: over budget">
          over
        </Badge>
      );
    case "watch":
      return (
        <Badge variant="outline" className="text-amber-500" aria-label="Risk: watch">
          watch
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-emerald-500" aria-label={`Risk: ${risk}`}>
          {risk}
        </Badge>
      );
  }
}

function RoomFinances() {
  const [data, setData] = React.useState<RoomsFinance | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<RoomsFinance>("/api/budget/rooms-finance")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load room finances";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
        <TriangleAlert aria-hidden className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const rooms = data?.rooms ?? [];
  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No active rooms yet.</p>
      </div>
    );
  }

  const totals = data?.totals ?? {
    committedCents: 0,
    spentCents: 0,
    remainingCents: 0,
    openMaterials: 0,
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Room</TableHead>
            <TableHead className="text-right">Committed</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">Open materials</TableHead>
            <TableHead>Risk</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rooms.map((room) => (
            <TableRow key={room.roomId}>
              <TableCell className="font-medium">{room.roomName}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(room.committedCents)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(room.spentCents)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono tabular-nums",
                  room.remainingCents < 0 && "text-destructive",
                )}
              >
                {formatCents(room.remainingCents)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{room.openMaterials}</TableCell>
              <TableCell>{riskBadge(room.riskLevel)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">Totals</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatCents(totals.committedCents)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatCents(totals.spentCents)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-mono tabular-nums",
                totals.remainingCents < 0 && "text-destructive",
              )}
            >
              {formatCents(totals.remainingCents)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{totals.openMaterials}</TableCell>
            <TableCell aria-hidden />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// ─── Main app ───────────────────────────────────────────────────────────────

export function BudgetInboxApp() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Decision inbox</h2>
        <DecisionInbox />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Room finances</h2>
        <RoomFinances />
      </section>
    </div>
  );
}
