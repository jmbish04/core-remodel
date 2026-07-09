/**
 * @fileoverview 0017 — MCP Ops "Sessions" tab.
 *
 * Master/detail view of MCP client sessions. The left rail lists sessions from
 * `/api/mcp-ops/sessions`; clicking one loads its tool-call transcript from
 * `/api/mcp-ops/sessions/:id` on the right (each invocation expands to show
 * args / result JSON and error text).
 *
 * `focusSessionId` lets a sibling tab (Logs) hand off a session id so this tab
 * opens pre-selected — used when the operator clicks a session link in the log
 * table.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  type SessionRow,
} from "./shared";

export function SessionsTab({
  focusSessionId,
}: {
  focusSessionId?: string | null;
}) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    focusSessionId ?? null,
  );

  // When a sibling tab hands off a session id, adopt it as the selection.
  useEffect(() => {
    if (focusSessionId) setSelectedId(focusSessionId);
  }, [focusSessionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ count: number; sessions: SessionRow[] }>(
        "/api/mcp-ops/sessions",
      );
      setRows(data.sessions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={Terminal}
        title="No MCP sessions yet"
        hint="Sessions appear here once a client connects to the MCP server and issues tool calls."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* Session list */}
      <Card className="overflow-hidden py-0">
        <ScrollArea className="h-[28rem]">
          <div className="divide-y divide-border/40">
            {rows.map((s) => {
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                    active ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground">
                      {s.principal ?? s.id}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {s.toolCallCount} calls
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {s.transport ? (
                      <Badge variant="secondary" className="px-1.5 py-0">
                        {s.transport}
                      </Badge>
                    ) : null}
                    <span className="truncate">{fmtDate(s.lastSeenAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      {/* Transcript */}
      <div>
        {selectedId ? (
          <TranscriptPanel sessionId={selectedId} />
        ) : (
          <EmptyState
            icon={Terminal}
            title="Select a session"
            hint="Pick a session on the left to view its tool-call transcript."
          />
        )}
      </div>
    </div>
  );
}

function TranscriptPanel({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [invocations, setInvocations] = useState<Invocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await apiGet<{
          session: SessionRow;
          invocations: Invocation[];
        }>(`/api/mcp-ops/sessions/${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        setSession(data.session);
        setInvocations(data.invocations ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="gap-1 bg-muted/30 px-4 py-3">
        <CardTitle className="font-mono text-sm">
          {session?.principal ?? session?.id ?? sessionId}
        </CardTitle>
        <CardDescription className="text-xs">
          {session?.transport ? `${session.transport} · ` : ""}
          {invocations?.length ?? 0} invocations ·{" "}
          {fmtDate(session?.firstSeenAt)} → {fmtDate(session?.lastSeenAt)}
        </CardDescription>
      </CardHeader>
      <ScrollArea className="h-[24rem]">
        {invocations && invocations.length > 0 ? (
          <div className="divide-y divide-border/40">
            {invocations.map((inv) => (
              <InvocationRow key={inv.id} inv={inv} />
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No tool invocations recorded for this session.
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

function InvocationRow({ inv }: { inv: Invocation }) {
  const [open, setOpen] = useState(false);
  const ok = isOk(inv.ok);
  const args = prettyJson(inv.argsJson);
  const result = prettyJson(inv.resultJson);
  const hasDetail = Boolean(args || result || inv.errorText);

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {hasDetail ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="font-mono text-sm text-foreground">{inv.toolName}</span>
        <Badge variant={ok ? "outline" : "destructive"} className="shrink-0">
          {ok ? "ok" : "error"}
        </Badge>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {inv.durationMs != null ? `${inv.durationMs} ms` : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {fmtDate(inv.createdAt)}
        </span>
      </button>

      {open && hasDetail ? (
        <div className="mt-3 space-y-3 pl-6">
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
      ) : null}
    </div>
  );
}
