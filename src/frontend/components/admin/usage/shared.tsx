/**
 * @fileoverview Shared primitives for the Admin · Integrations usage sections
 * (Maps / Gemini / AI Gateway). Monolith styling: rings not 1px borders,
 * mono tabular numerals, high-contrast foreground text.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Shared number formatter (thousands separators). */
export const nf = new Intl.NumberFormat("en-US");

/** Compact formatter for large token counts (e.g. 1.2M, 84k). */
export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `${n}`;
}

/** Format an ISO "2026-07" month key as "July 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const year = Number(y);
  const monthIdx = Number(m) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return month;
  }
  return new Date(Date.UTC(year, monthIdx, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A single headline statistic (big mono number + micro label). */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const valueColor =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-300"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${valueColor}`}>
          {value}
        </div>
        {sub ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Thin Monolith meter bar (div-based, no borders). */
export function MeterBar({
  fraction,
  tone = "default",
}: {
  fraction: number;
  tone?: "default" | "warn" | "danger";
}) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const fill =
    tone === "danger"
      ? "hsl(var(--destructive))"
      : tone === "warn"
        ? "rgb(245 158 11)"
        : "hsl(var(--chart-1))";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: fill }}
      />
    </div>
  );
}

/** Per-section loading skeleton. */
export function SectionLoading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10"
          />
        ))}
      </div>
      <div className="h-52 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
    </div>
  );
}

/** Per-section error state with retry. */
export function SectionError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="ring-1 ring-destructive/30">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

/** Small inline "Refresh" button used in each section header. */
export function RefreshButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={loading} className="gap-1.5">
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      Refresh
    </Button>
  );
}

/** Generic fetch-JSON helper with credentials + error normalization. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Section header row: title + description on the left, actions on the right. */
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
