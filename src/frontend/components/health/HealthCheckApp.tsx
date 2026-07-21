/**
 * @fileoverview HealthCheckApp — the public `/health` page island.
 *
 * On mount it loads the last-known snapshot (GET /api/health). The "Run health
 * checks" button triggers a live screen (POST /api/health/run) that actively
 * probes each core binding on the worker and renders per-service status + latency.
 * Public — no admin cookie needed; the endpoints under /api/health are un-gated.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type HealthStatus = "healthy" | "degraded" | "down";

interface CheckRow {
  serviceName: string;
  status: HealthStatus;
  responseTime: number | null;
  errorMessage: string | null;
}

interface ScreenResult {
  status: HealthStatus;
  timestamp: string;
  responseTime?: number;
  checks: CheckRow[];
}

/** GET /api/health returns services as a keyed map; normalize to CheckRow[]. */
interface HealthSnapshot {
  status: HealthStatus;
  timestamp: string;
  services: Record<string, CheckRow & { timestamp?: number | string }>;
  responseTime?: number;
}

const SERVICE_LABELS: Record<string, string> = {
  api: "API",
  database: "Database (D1)",
  tesla_database: "Tesla telemetry DB (D1)",
  kv_cache: "KV cache",
  r2_artifacts: "R2 artifacts",
  workers_ai: "Workers AI",
};

function label(serviceName: string): string {
  return SERVICE_LABELS[serviceName] ?? serviceName;
}

const STATUS_META: Record<
  HealthStatus,
  { label: string; badge: string; ring: string; Icon: typeof CheckCircle2 }
> = {
  healthy: {
    label: "Healthy",
    badge: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
    ring: "ring-1 ring-emerald-500/30",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    badge: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    ring: "ring-1 ring-amber-500/40",
    Icon: AlertTriangle,
  },
  down: {
    label: "Down",
    badge: "bg-destructive/15 text-destructive ring-1 ring-destructive/30",
    ring: "ring-1 ring-destructive/40",
    Icon: XCircle,
  },
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const meta = STATUS_META[status];
  const { Icon } = meta;
  return (
    <Badge className={`gap-1 ${meta.badge}`}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

function CheckCard({ row }: { row: CheckRow }) {
  const meta = STATUS_META[row.status];
  return (
    <Card className={row.status === "healthy" ? undefined : meta.ring}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{label(row.serviceName)}</CardTitle>
          <StatusBadge status={row.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Latency</span>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {row.responseTime == null ? "—" : `${row.responseTime} ms`}
          </span>
        </div>
        {row.errorMessage ? (
          <p className="text-xs text-destructive">{row.errorMessage}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HealthCheckApp() {
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [overall, setOverall] = useState<HealthStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Last-known snapshot from the table (cheap) — populates the page immediately.
  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as HealthSnapshot;
      const services = Object.values(data.services ?? {}).map((s) => ({
        serviceName: s.serviceName,
        status: s.status,
        responseTime: s.responseTime ?? null,
        errorMessage: s.errorMessage ?? null,
      }));
      setRows(services);
      setOverall(data.status ?? null);
      setCheckedAt(data.timestamp ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load health snapshot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // On-demand live screen — actively probes every binding on the worker.
  const runScreen = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/health/run", { method: "POST" });
      const data = (await res.json()) as ScreenResult;
      if (!Array.isArray(data.checks)) throw new Error("Unexpected response from health screen");
      setRows(data.checks);
      setOverall(data.status);
      setCheckedAt(data.timestamp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health screen failed");
    } finally {
      setRunning(false);
    }
  }, []);

  const checkedAtLabel = useMemo(() => {
    if (!checkedAt) return null;
    try {
      return new Date(checkedAt).toLocaleString();
    } catch {
      return checkedAt;
    }
  }, [checkedAt]);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8 pb-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Activity className="size-6 text-muted-foreground" aria-hidden />
          System Health
        </h1>
        <p className="text-muted-foreground">
          Run a live health screen against the worker&apos;s core services — D1, the Tesla
          telemetry DB, KV, R2 and Workers AI — and see per-service status and latency.
        </p>
      </div>

      {/* Overall + run button */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Overall</span>
          {overall ? <StatusBadge status={overall} /> : <span className="text-sm">—</span>}
          {checkedAtLabel ? (
            <span className="text-xs text-muted-foreground">as of {checkedAtLabel}</span>
          ) : null}
        </div>
        <Button onClick={runScreen} disabled={running} className="gap-1.5">
          {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {running ? "Running checks…" : "Run health checks"}
        </Button>
      </div>

      {error ? (
        <Card className="ring-1 ring-destructive/30">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
          ))}
        </div>
      ) : rows && rows.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <CheckCard key={row.serviceName} row={row} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No checks recorded yet. Click <span className="font-medium">Run health checks</span> to
            probe every service now.
          </CardContent>
        </Card>
      )}
    </main>
  );
}
