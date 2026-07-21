import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "healthy" | "degraded" | "unhealthy" | "unknown";

const STYLE: Record<Status, { label: string; ring: string; dot: string; Icon: typeof CheckCircle2 }> = {
  healthy: {
    label: "High Performance",
    ring: "ring-emerald-500/25 hover:ring-emerald-500/50",
    dot: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Inconsistent / Gaps",
    ring: "ring-amber-500/25 hover:ring-amber-500/50",
    dot: "bg-amber-500",
    Icon: AlertTriangle,
  },
  unhealthy: {
    label: "Degraded",
    ring: "ring-rose-500/25 hover:ring-rose-500/50",
    dot: "bg-rose-500",
    Icon: ShieldAlert,
  },
  unknown: {
    label: "Unknown",
    ring: "ring-border hover:ring-muted-foreground/40",
    dot: "bg-muted-foreground",
    Icon: HelpCircle,
  },
};

/**
 * Global data-quality badge.
 *
 * Reads the SAME endpoint as /admin/system/health, optionally narrowed to one
 * vertical, so a page-level badge can never disagree with the health page it
 * links to — a badge that contradicts its own detail view is worse than none.
 *
 * Renders nothing while loading and nothing on error: a monitoring widget that
 * shows a broken state for its own fetch failure trains people to ignore it.
 * A real problem shows up as a status, not as a spinner.
 */
export function HealthBadge({
  title = "System Health",
  vertical,
  className,
}: {
  title?: string;
  /** Narrow to one product area, e.g. "brands". Omit for the whole system. */
  vertical?: string;
  className?: string;
}) {
  const [data, setData] = useState<{ status: Status; score: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = vertical
      ? `/api/system/health?vertical=${encodeURIComponent(vertical)}`
      : "/api/system/health";

    fetch(url, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ overall?: { status: Status; score: number } }>) : null))
      .then((json) => {
        if (!cancelled && json?.overall) setData(json.overall);
      })
      .catch(() => {
        /* silent — see the note above */
      });

    return () => {
      cancelled = true;
    };
  }, [vertical]);

  if (!data) return null;

  const style = STYLE[data.status] ?? STYLE.unknown;

  return (
    <a
      href="/admin/system/health"
      className={cn(
        "group inline-flex items-center gap-3 rounded-lg bg-card px-3 py-2 ring-1 transition-all",
        style.ring,
        className,
      )}
      title={`${title}: ${style.label} — view all health checks`}
    >
      <span className="relative flex size-2 shrink-0">
        {/* Pulse only when something is wrong; a healthy badge should be quiet. */}
        {data.status !== "healthy" && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-60",
              style.dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", style.dot)} />
      </span>

      <span className="min-w-0">
        <span className="block text-xs font-medium leading-tight">{title}</span>
        <span className="block text-[11px] leading-tight text-muted-foreground">
          {style.label}
        </span>
      </span>

      <span className="ml-1 font-mono text-sm font-semibold tabular-nums">{data.score}%</span>
    </a>
  );
}
