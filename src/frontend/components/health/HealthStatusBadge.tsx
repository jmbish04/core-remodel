/**
 * @fileoverview The header health pip.
 *
 * Deliberately tiny: a coloured dot plus one word, linking to `/admin/system/health`.
 * It reads the LAST PERSISTED session (`GET /api/health/badge`) — it never
 * triggers a probe, so putting it in the global header costs one cheap grouped
 * D1 read per page load and nothing else.
 *
 * Renders nothing at all when the request is not an authed admin or no session
 * has ever run: a broken-looking badge on every public page would be worse than
 * no badge.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type TestResult = "SUCCESS" | "DEGRADED" | "FAILURE";

interface BadgePayload {
  status: TestResult | null;
  counts?: { success: number; degraded: number; failure: number };
  timestamp?: string;
}

const TONE: Record<TestResult, { dot: string; text: string; label: string }> = {
  SUCCESS: { dot: "bg-emerald-400", text: "text-emerald-400/90", label: "Healthy" },
  DEGRADED: { dot: "bg-amber-400", text: "text-amber-400/90", label: "Degraded" },
  FAILURE: { dot: "bg-rose-400", text: "text-rose-400/90", label: "Failing" },
};

export function HealthStatusBadge({ className }: { className?: string }) {
  const [payload, setPayload] = useState<BadgePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/badge")
      .then((r) => (r.ok ? (r.json() as Promise<BadgePayload>) : null))
      .then((d) => {
        if (!cancelled) setPayload(d);
      })
      .catch(() => {
        /* the badge is decoration — a failed read simply renders nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!payload?.status) return null;
  const tone = TONE[payload.status];
  const failing = (payload.counts?.failure ?? 0) + (payload.counts?.degraded ?? 0);

  return (
    <a
      href="/admin/system/health"
      title={
        payload.timestamp
          ? `System health · last run ${new Date(payload.timestamp).toLocaleString()}`
          : "System health"
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors hover:bg-foreground/[0.06]",
        tone.text,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", tone.dot)} />
      {tone.label}
      {failing > 0 ? <span className="tabular-nums">{failing}</span> : null}
    </a>
  );
}

export default HealthStatusBadge;
