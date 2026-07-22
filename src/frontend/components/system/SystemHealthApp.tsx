import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, RefreshCw, ScrollText, ShieldAlert, Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Mirrors the HealthResult contract in src/backend/services/health/registry.ts. */
interface HealthStat {
  label: string;
  value: number | string;
  problem?: boolean;
}

interface ServiceHealth {
  slug: string;
  name: string;
  vertical: string;
  description: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  summary: string;
  score: number;
  stats: HealthStat[];
  auditUrl: string;
  logsUrl: string;
  actionUrl?: string;
  actionLabel?: string;
}

interface HealthResponse {
  checkedAt: string;
  overall: { status: ServiceHealth["status"]; score: number; label: string };
  services: ServiceHealth[];
  verticals: string[];
}

/**
 * Status presentation, kept in one place so the row badge, the icon and the
 * score bar can never disagree about what a status looks like.
 */
const STATUS_STYLE: Record<
  ServiceHealth["status"],
  { label: string; badge: string; bar: string; Icon: typeof CheckCircle2 }
> = {
  healthy: {
    label: "High Performance",
    badge: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25",
    bar: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Inconsistent / Gaps",
    badge: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/25",
    bar: "bg-amber-500",
    Icon: AlertTriangle,
  },
  unhealthy: {
    label: "Degraded",
    badge: "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/25",
    bar: "bg-rose-500",
    Icon: ShieldAlert,
  },
  unknown: {
    label: "Unknown",
    badge: "bg-muted text-muted-foreground ring-1 ring-border",
    bar: "bg-muted-foreground",
    Icon: HelpCircle,
  },
};

export function SystemHealthApp() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system/health", { credentials: "include" });
      if (!res.ok) throw new Error(`Health API returned ${res.status}`);
      setData((await res.json()) as HealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-sm">
          <p className="text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="mr-1.5 size-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const overall = STATUS_STYLE[data.overall.status];

  return (
    <div className="space-y-6">
      {/* Overall — the same numbers the global badge shows. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <overall.Icon
              className={cn(
                "size-8",
                data.overall.status === "healthy" && "text-emerald-400",
                data.overall.status === "degraded" && "text-amber-400",
                data.overall.status === "unhealthy" && "text-rose-400",
                data.overall.status === "unknown" && "text-muted-foreground",
              )}
            />
            <div>
              <p className="text-lg font-semibold tracking-tight">{data.overall.label}</p>
              <p className="text-sm text-muted-foreground">
                {data.services.length} check
                {data.services.length === 1 ? "" : "s"} across{" "}
                {data.verticals.length} area{data.verticals.length === 1 ? "" : "s"} ·{" "}
                checked {new Date(data.checkedAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-mono text-3xl font-semibold tabular-nums">
                {data.overall.score}%
              </p>
              <p className="text-xs text-muted-foreground">overall quality</p>
            </div>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 size-3.5", loading && "animate-spin")} />
              Re-run
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* One row per registered check, grouped by product area. */}
      {data.verticals.map((vertical) => (
        <section key={vertical} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {vertical}
          </h2>
          <div className="space-y-3">
            {data.services
              .filter((s) => s.vertical === vertical)
              .map((service) => (
                <ServiceRow key={service.slug} service={service} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ServiceRow({ service }: { service: ServiceHealth }) {
  const style = STATUS_STYLE[service.status];

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <style.Icon className="size-4 shrink-0 text-muted-foreground" />
              <h3 className="font-medium">{service.name}</h3>
              <Badge className={cn("font-mono text-[10px] uppercase tracking-widest", style.badge)}>
                {style.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{service.summary}</p>
          </div>
          <p className="font-mono text-2xl font-semibold tabular-nums">{service.score}%</p>
        </div>

        {/* Score bar — the same colour as the badge, so the row reads at a glance. */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", style.bar)}
            style={{ width: `${service.score}%` }}
          />
        </div>

        {/* The stats that JUSTIFY the status; problem stats are highlighted. */}
        {service.stats.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {service.stats.map((stat) => (
              <div key={stat.label}>
                <p
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    stat.problem ? "font-semibold text-amber-400" : "text-foreground",
                  )}
                >
                  {stat.value}
                </p>
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Filters are preset from the row and NOT sticky — coming back here
              and picking a service always resets them. */}
          <Button size="sm" variant="outline" render={<a href={service.auditUrl} />}><Table2 className="mr-1.5 size-3.5" /> Audit log</Button>
          <Button size="sm" variant="outline" render={<a href={service.logsUrl} />}><ScrollText className="mr-1.5 size-3.5" /> Logs</Button>
          {service.actionUrl && (
            <Button size="sm" render={<a href={service.actionUrl} />}>{service.actionLabel ?? "Fix"}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
