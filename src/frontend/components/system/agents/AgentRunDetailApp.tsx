/**
 * @fileoverview One agent run — `/admin/system/agents/queue/[id]`.
 *
 * Step trace, the tool calls inside each step, the retry lineage, attributed
 * cost, and the three actions that are real (retry / cancel / approve).
 *
 * Retrofit note: the reference template put an editable "Run Settings" form
 * here — priority, max retries, notify owners. There is no per-run settings
 * store in this system, so that form would silently discard everything typed
 * into it. A form that lies is worse than no form; this renders the run's real
 * facts read-only instead.
 */
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  AttemptBadge,
  ErrorCodeChip,
  RunStatusBadge,
  SurfaceBadge,
  adminGet,
  adminPost,
  formatDuration,
  formatRelative,
  formatUsd,
  type RunStatus,
  type RunSummary,
} from "./shared";

interface ToolCall {
  id: number;
  tool: string;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  durationMs: number | null;
  at: string | null;
  argsJson: unknown;
  resultJson: unknown;
}

interface Step {
  id: number;
  seq: number;
  label: string;
  status: RunStatus;
  errorMessage: string | null;
  durationMs: number | null;
  toolCalls: ToolCall[];
}

interface RunDetailResponse {
  run: RunSummary & {
    inputJson: unknown;
    outputJson: unknown;
    startedAt: string | null;
    endedAt: string | null;
  };
  steps: Step[];
  looseToolCalls: ToolCall[];
  lineage: Array<{ id: number; attempt: number; status: RunStatus; errorCode: string | null; createdAt: string | null }>;
  cost: { totalTokens: number; costUsd: number; calls: number };
}

export function AgentRunDetailApp({ runId }: { runId: string }) {
  const [data, setData] = React.useState<RunDetailResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await adminGet<RunDetailResponse>(`/api/admin/agents/runs/${runId}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Poll only while the run can still change. Polling a settled run forever is
  // pure waste, and this page is left open on a second monitor.
  React.useEffect(() => {
    const live = data?.run.status === "running" || data?.run.status === "queued";
    if (!live) return;
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [data?.run.status, load]);

  const act = async (action: "retry" | "cancel" | "approve") => {
    setBusy(action);
    setNotice(null);
    try {
      const res = await adminPost<{ runId?: number }>(`/api/admin/agents/runs/${runId}/${action}`);
      if (action === "retry" && res?.runId) {
        setNotice(`Retry queued as RUN-${res.runId}.`);
      } else {
        setNotice(`Run ${action}d.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load RUN-{runId}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { run, steps, looseToolCalls, lineage, cost } = data;
  const settled = ["succeeded", "failed", "cancelled"].includes(run.status);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a href="/admin/system/agents/queue" className="text-muted-foreground text-sm hover:underline">
              Run Queue /
            </a>
            <h2 className="text-foreground text-lg font-semibold tracking-tight">RUN-{run.id}</h2>
            <RunStatusBadge status={run.status} />
            <AttemptBadge attempt={run.attempt} />
          </div>
          <p className="text-muted-foreground min-w-0 truncate text-sm">
            {run.agentLabel} · <span className="font-mono">{run.operation}</span>
            {run.targetLabel ? ` · ${run.targetLabel}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SurfaceBadge surface={run.surface} />
          <Separator orientation="vertical" className="my-auto h-4" />
          {run.status === "needs_approval" && (
            <Button size="sm" onClick={() => void act("approve")} disabled={busy !== null}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
          )}
          {!settled && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void act("cancel")}
              disabled={busy !== null}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {settled && (
            <Button size="sm" onClick={() => void act("retry")} disabled={busy !== null}>
              {busy === "retry" ? "Queueing…" : `Retry as attempt ${run.attempt + 1}`}
            </Button>
          )}
        </div>
      </header>

      {notice && (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && data && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {run.status === "failed" && (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            Failed
            <ErrorCodeChip code={run.errorCode} />
          </AlertTitle>
          <AlertDescription>
            {run.errorMessage ?? "No message was recorded — the run failed before it could report one."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* ── Step trace ──────────────────────────────────────────────── */}
        <div className="min-w-0 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Step trace</CardTitle>
              <p className="text-muted-foreground text-xs">
                {steps.length === 0
                  ? "This run declared no steps."
                  : `${steps.filter((s) => s.status === "succeeded").length} of ${steps.length} steps succeeded`}
              </p>
            </CardHeader>
            <CardContent className="space-y-1">
              {steps.length === 0 && looseToolCalls.length === 0 && (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No steps or tool calls were recorded for this run.
                </p>
              )}

              {steps.map((s, i) => (
                <StepRow key={s.id} step={s} last={i === steps.length - 1} />
              ))}

              {looseToolCalls.length > 0 && (
                <div className="pt-3">
                  <p className="text-muted-foreground mb-2 text-xs font-medium">
                    Tool calls outside any step
                  </p>
                  <div className="space-y-2">
                    {looseToolCalls.map((c) => (
                      <ToolCallRow key={c.id} call={c} />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Facts ───────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Run facts</CardTitle>
              <p className="text-muted-foreground text-xs">
                Read-only — this system has no per-run settings store.
              </p>
            </CardHeader>
            <CardContent className="divide-border divide-y">
              <Fact label="Agent" value={run.agentLabel} mono={false} />
              <Fact label="Operation" value={run.operation} />
              <Fact label="Target" value={run.targetLabel ?? run.targetId ?? "—"} mono={false} />
              <Fact label="Triggered by" value={run.triggeredBy ?? "—"} />
              <Fact label="Attempt" value={String(run.attempt)} />
              <Fact label="Started" value={formatRelative(run.startedAt)} mono={false} />
              <Fact label="Duration" value={formatDuration(run.durationMs)} />
              <Fact
                label="Attributed cost"
                value={`${formatUsd(cost.costUsd)} · ${cost.totalTokens.toLocaleString()} tok · ${cost.calls} calls`}
                mono={false}
              />
            </CardContent>
          </Card>

          {lineage.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Attempt chain</CardTitle>
                <p className="text-muted-foreground text-xs">
                  A retry is a new run, so earlier failures are never overwritten.
                </p>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {lineage.map((l) => (
                  <a
                    key={l.id}
                    href={`/admin/system/agents/queue/${l.id}`}
                    className={cn(
                      "hover:bg-muted/40 flex items-center justify-between gap-2 rounded-md px-2 py-1.5",
                      l.id === run.id && "bg-muted/60",
                    )}
                  >
                    <span className="text-muted-foreground text-xs tabular-nums">
                      attempt {l.attempt} · RUN-{l.id}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {l.errorCode && <ErrorCodeChip code={l.errorCode} />}
                      <RunStatusBadge status={l.status} />
                    </span>
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {(run.inputJson !== null || run.outputJson !== null) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Payload</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {run.inputJson !== null && <JsonBlock label="Input (replayable)" value={run.inputJson} />}
                {run.outputJson !== null && <JsonBlock label="Output digest" value={run.outputJson} />}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, last }: { step: Step; last: boolean }) {
  const [open, setOpen] = React.useState(step.status === "failed");
  const failed = step.status === "failed";

  return (
    <div className="relative flex gap-3">
      {/* Timeline rail */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
            step.status === "succeeded" && "bg-primary text-primary-foreground",
            failed && "bg-destructive/15 text-destructive",
            step.status === "running" && "bg-info/15 text-info",
            !["succeeded", "failed", "running"].includes(step.status) && "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {step.status === "succeeded" ? "✓" : failed ? "✕" : step.seq}
        </span>
        {!last && <span className="bg-border mt-1 w-px flex-1" aria-hidden />}
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{step.label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatDuration(step.durationMs)}
          </span>
          {failed && <Badge variant="outline" className="border-destructive/25 bg-destructive/10 text-destructive">failed</Badge>}
        </div>

        {step.errorMessage && (
          <p className="text-destructive mt-1 text-xs">{step.errorMessage}</p>
        )}

        {step.toolCalls.length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs">
              <span className={cn("transition-transform", open && "rotate-90")} aria-hidden>
                ›
              </span>
              {step.toolCalls.length} tool call{step.toolCalls.length === 1 ? "" : "s"}
              {step.toolCalls.some((c) => !c.ok) && (
                <Badge variant="outline" className="border-destructive/25 bg-destructive/10 text-destructive ml-1">
                  {step.toolCalls.filter((c) => !c.ok).length} failed
                </Badge>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {step.toolCalls.map((c) => (
                <ToolCallRow key={c.id} call={c} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCall }) {
  return (
    <div className="bg-muted/30 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-2.5 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground truncate font-mono text-xs font-medium">{call.tool}</span>
        <span className="text-muted-foreground truncate text-xs">
          {call.ok
            ? "ok"
            : `${call.errorCode ?? "error"}${call.errorMessage ? ` — ${call.errorMessage}` : ""}`}
          {call.attempt > 1 ? ` · attempt ${call.attempt}` : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatDuration(call.durationMs)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            call.ok
              ? "border-success/25 bg-success/10 text-success"
              : "border-destructive/25 bg-destructive/10 text-destructive",
          )}
        >
          {call.ok ? "ok" : "failed"}
        </Badge>
      </div>
    </div>
  );
}

function Fact({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
      <span className={cn("min-w-0 truncate text-sm", mono && "font-mono text-xs")} title={value}>
        {value}
      </span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = React.useMemo(() => {
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }, [value]);

  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-1 text-xs font-medium">{label}</p>
      <pre className="bg-muted/40 max-h-48 overflow-auto rounded-md border p-2 text-xs">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default AgentRunDetailApp;
