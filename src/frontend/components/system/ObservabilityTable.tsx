import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Info, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: number;
  timestamp: number | string | null;
  actor: string;
  action: string;
  status: "success" | "error";
  durationMs: number | null;
  detail: string;
}

interface LogEntry {
  id: string;
  timestamp: number | string | null;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

/** D1 timestamps arrive as unix seconds; Date wants ms. */
function formatTs(ts: number | string | null): string {
  if (ts === null || ts === undefined) return "—";
  const n = typeof ts === "string" ? Date.parse(ts) : Number(ts) * 1000;
  if (!Number.isFinite(n)) return String(ts);
  return new Date(n).toLocaleString();
}

const LEVEL_STYLE: Record<LogEntry["level"], { cls: string; Icon: typeof Info }> = {
  info: { cls: "text-muted-foreground", Icon: Info },
  warn: { cls: "text-amber-400", Icon: TriangleAlert },
  error: { cls: "text-rose-400", Icon: AlertCircle },
};

/**
 * Audit / log table over the REAL rows the platform already writes.
 *
 * `serviceSlug` presets the server-side filter. It is NOT sticky — nothing is
 * persisted, and the parent remounts this on slug change — so arriving from a
 * health row always gives the same view for that row.
 */
export function ObservabilityTable({
  kind,
  serviceSlug,
}: {
  kind: "audit" | "logs";
  serviceSlug?: string;
}) {
  const [rows, setRows] = useState<Array<AuditEntry | LogEntry>>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (serviceSlug) params.set("service", serviceSlug);
      if (query.trim()) params.set("q", query.trim());
      if (onlyProblems) params.set(kind === "audit" ? "status" : "level", "error");

      const res = await fetch(
        `/api/system/${kind === "audit" ? "audit" : "logs"}?${params}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as {
        entries: Array<AuditEntry | LogEntry>;
        appliedToolPatterns?: string[];
      };
      setRows(json.entries ?? []);
      setPatterns(json.appliedToolPatterns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [kind, serviceSlug, query, onlyProblems]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={kind === "audit" ? "Search actions…" : "Search messages…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant={onlyProblems ? "default" : "outline"}
            onClick={() => setOnlyProblems((v) => !v)}
          >
            Problems only
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>

        {/* Say WHY these rows and not others — a filtered table that doesn't
            explain its filter reads as missing data. */}
        {patterns.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Showing entries matching{" "}
            {patterns.map((p) => (
              <code key={p} className="mx-0.5 rounded bg-muted px-1 py-0.5">
                {p}
              </code>
            ))}
          </p>
        )}

        {loading && rows.length === 0 ? (
          <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {kind === "audit" ? "audit entries" : "log entries"} match.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 pr-4 font-medium">
                    {kind === "audit" ? "Actor" : "Level"}
                  </th>
                  <th className="pb-2 pr-4 font-medium">
                    {kind === "audit" ? "Action" : "Source"}
                  </th>
                  <th className="pb-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  kind === "audit" ? (
                    <AuditRow key={row.id} entry={row as AuditEntry} />
                  ) : (
                    <LogRow key={row.id} entry={row as LogEntry} />
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatTs(entry.timestamp)}
      </td>
      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{entry.actor}</td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{entry.action}</span>
          <Badge
            variant={entry.status === "success" ? "secondary" : "destructive"}
            className="text-[10px]"
          >
            {entry.status}
          </Badge>
          {entry.durationMs !== null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {entry.durationMs}ms
            </span>
          )}
        </div>
      </td>
      <td className="py-2 text-xs text-muted-foreground">{entry.detail}</td>
    </tr>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const style = LEVEL_STYLE[entry.level] ?? LEVEL_STYLE.info;
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatTs(entry.timestamp)}
      </td>
      <td className="py-2 pr-4">
        <span className={cn("inline-flex items-center gap-1.5 text-xs", style.cls)}>
          <style.Icon className="size-3.5" />
          {entry.level}
        </span>
      </td>
      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{entry.source}</td>
      <td className="py-2 text-xs">{entry.message}</td>
    </tr>
  );
}
