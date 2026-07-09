/**
 * @fileoverview 0017 — MCP Ops "Logs" tab (NEW).
 *
 * A terminal-style, full-width log viewer over `/api/mcp-ops/invocations`. Each
 * tool invocation is a log line: timestamp, a colored level dot (info = sky,
 * error = destructive, derived from the `ok` flag), tool name, truncated
 * session id, a message (tool + ok/error, with an error snippet when present),
 * and duration.
 *
 * Filters:
 *   - A Select toggles between "all" and "errors only". "errors only" refetches
 *     the endpoint with `?ok=false` so the server does the heavy filtering.
 *   - A free-text Input filters client-side over tool name + message.
 *
 * Clicking a row opens a Dialog (Base-UI-backed — controlled via open /
 * onOpenChange, no Radix-only props) showing identifiers plus the full args /
 * result / error payloads in <pre> blocks styled like the Sessions transcript.
 *
 * Clicking the session id calls `onOpenSession`, letting the root switch to the
 * Sessions tab with that session pre-selected.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  apiGet,
  EmptyState,
  ErrorState,
  fmtDate,
  isOk,
  type Invocation,
  PanelLoading,
  prettyJson,
} from "./shared";

type LevelFilter = "all" | "errors";

/** Build the terse message string shown in the log line and dialog subtitle. */
function invMessage(inv: Invocation): string {
  const ok = isOk(inv.ok);
  if (!ok) {
    const snippet = (inv.errorText ?? "").trim().replace(/\s+/g, " ");
    return snippet
      ? `${inv.toolName} failed — ${snippet}`
      : `${inv.toolName} failed`;
  }
  return `${inv.toolName} ok`;
}

export function LogsTab({
  onOpenSession,
}: {
  onOpenSession?: (sessionId: string) => void;
}) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [rows, setRows] = useState<Invocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Invocation | null>(null);

  const load = useCallback(async (lvl: LevelFilter) => {
    setLoading(true);
    setError(null);
    try {
      // "errors only" pushes the filter to the server via ?ok=false.
      const path =
        lvl === "errors"
          ? "/api/mcp-ops/invocations?ok=false"
          : "/api/mcp-ops/invocations";
      const data = await apiGet<{ count: number; invocations: Invocation[] }>(
        path,
      );
      setRows(data.invocations ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(level);
  }, [load, level]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((inv) => {
      const hay = `${inv.toolName} ${invMessage(inv)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Level</span>
          <Select
            value={level}
            onValueChange={(v) => setLevel((v ?? "all") as LevelFilter)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="errors">Errors only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by tool or message…"
          className="h-9 w-full max-w-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(level)}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <PanelLoading />
      ) : error ? (
        <ErrorState message={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Terminal}
          title={rows && rows.length > 0 ? "No matching log lines" : "No logs yet"}
          hint={
            rows && rows.length > 0
              ? "No invocations match the current filter. Clear the search or switch the level filter."
              : "Tool invocations logged by the MCP server will stream in here."
          }
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ScrollArea className="h-[32rem]">
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                  <tr className="text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Time</th>
                    <th className="px-3 py-2 font-semibold">Level</th>
                    <th className="hidden px-3 py-2 font-semibold sm:table-cell">
                      Tool
                    </th>
                    <th className="hidden px-3 py-2 font-semibold lg:table-cell">
                      Session
                    </th>
                    <th className="px-3 py-2 font-semibold">Message</th>
                    <th className="px-3 py-2 text-right font-semibold">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((inv) => {
                    const ok = isOk(inv.ok);
                    return (
                      <tr
                        key={inv.id}
                        onClick={() => setSelected(inv)}
                        className="cursor-pointer align-top transition-colors hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {fmtDate(inv.createdAt)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                ok ? "bg-sky-400" : "bg-destructive",
                              )}
                            />
                            <span
                              className={cn(
                                ok ? "text-sky-400" : "text-destructive",
                              )}
                            >
                              {ok ? "info" : "error"}
                            </span>
                          </span>
                        </td>
                        <td className="hidden px-3 py-2 text-foreground sm:table-cell">
                          {inv.toolName}
                        </td>
                        <td className="hidden px-3 py-2 lg:table-cell">
                          {inv.sessionId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenSession?.(inv.sessionId);
                              }}
                              className="text-sky-400 hover:underline"
                              title={inv.sessionId}
                            >
                              {inv.sessionId.slice(0, 8)}…
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "line-clamp-2 break-words",
                              ok ? "text-foreground/90" : "text-destructive",
                            )}
                          >
                            {invMessage(inv)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                          {inv.durationMs != null ? inv.durationMs : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </Card>
      )}

      <LogDetailDialog
        inv={selected}
        onClose={() => setSelected(null)}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}

function LogDetailDialog({
  inv,
  onClose,
  onOpenSession,
}: {
  inv: Invocation | null;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const args = prettyJson(inv?.argsJson);
  const result = prettyJson(inv?.resultJson);

  return (
    <Dialog open={inv != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {inv ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">
                {inv.toolName}
              </DialogTitle>
              <DialogDescription>{invMessage(inv)}</DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-2">
                {/* Identifiers */}
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">ID</dt>
                  <dd className="break-all font-mono text-foreground/90">
                    {inv.id}
                  </dd>
                  <dt className="text-muted-foreground">Session</dt>
                  <dd className="break-all font-mono">
                    {inv.sessionId ? (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSession?.(inv.sessionId);
                        }}
                        className="text-sky-400 hover:underline"
                      >
                        {inv.sessionId}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Tool</dt>
                  <dd className="break-all font-mono text-foreground/90">
                    {inv.toolName}
                  </dd>
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="text-foreground/90">{fmtDate(inv.createdAt)}</dd>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="text-foreground/90">
                    {inv.durationMs != null ? `${inv.durationMs} ms` : "—"}
                  </dd>
                </dl>

                {inv.errorText ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
                      Error
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-destructive/10 p-3 font-mono text-xs text-destructive">
                      {inv.errorText}
                    </pre>
                  </div>
                ) : null}
                {args ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Arguments
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground/90 ring-1 ring-border/40">
                      {args}
                    </pre>
                  </div>
                ) : null}
                {result ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Result
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground/90 ring-1 ring-border/40">
                      {result}
                    </pre>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
