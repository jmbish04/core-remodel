/**
 * @fileoverview Tesla streaming-ingest control (0023 PR3).
 *
 * The drive-list header widget that owns the streaming DO's on/off TOGGLE and
 * shows which ingest path is live right now:
 *
 *   • Streaming — the DO holds the Tessie socket (a drive is active in the daytime
 *     window with the toggle on).
 *   • Polling   — the toggle is off (or we're outside the window / no socket) but a
 *     drive is active, so the cheaper cron poller carries ingest.
 *   • Idle      — no active drive, so nothing ingests (and nothing bills).
 *
 * Reads `GET /api/tesla/stream/control` (+ `/status`) and writes the toggle via
 * `POST /api/tesla/stream/control`. Polls every 15s so the pill stays live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Moon, Radio, RefreshCw, Satellite } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface StreamControl {
  enabled: boolean;
  windowStartHour: number;
  windowEndHour: number;
  pollFallbackSeconds: number;
  connected: boolean;
}

interface StreamStatus {
  connected: boolean;
  writesToday?: number;
  breaker?: { tripped: boolean; reason?: string };
}

type Mode = "streaming" | "polling" | "idle";

const REFRESH_MS = 15_000;

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function TeslaStreamControl() {
  const [control, setControl] = useState<StreamControl | null>(null);
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [shouldStream, setShouldStream] = useState(false);
  const [shouldPoll, setShouldPoll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Absent (never configured) → hide the whole widget rather than show a broken card. */
  const [available, setAvailable] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [ctlRes, stRes] = await Promise.all([
        fetch("/api/tesla/stream/control", { credentials: "include" }),
        fetch("/api/tesla/stream/status", { credentials: "include" }),
      ]);
      // The routes only exist once deployed; a 404 means "not on this worker yet".
      if (ctlRes.status === 404) {
        setAvailable(false);
        return;
      }
      if (!ctlRes.ok) {
        setError(`control ${ctlRes.status}`);
        return;
      }
      const ctl = (await ctlRes.json()) as {
        control: StreamControl;
        shouldStream: boolean;
        shouldPoll: boolean;
      };
      setControl(ctl.control);
      setShouldStream(ctl.shouldStream);
      setShouldPoll(ctl.shouldPoll);
      setStatus(stRes.ok ? ((await stRes.json()) as StreamStatus) : null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), REFRESH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const toggle = async (next: boolean) => {
    if (!control) return;
    setSaving(true);
    // Optimistic — reflect the intent immediately, reconcile on the response.
    setControl({ ...control, enabled: next });
    try {
      const res = await fetch("/api/tesla/stream/control", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        const body = (await res.json()) as { control: StreamControl };
        setControl(body.control);
        await load();
      } else {
        setError(`save ${res.status}`);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (!available) return null;

  const connected = status?.connected ?? control?.connected ?? false;
  const mode: Mode = connected ? "streaming" : shouldPoll ? "polling" : "idle";
  const tripped = status?.breaker?.tripped ?? false;

  const modeMeta: Record<Mode, { label: string; icon: typeof Radio; className: string }> = {
    streaming: {
      label: "Streaming",
      icon: Radio,
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    },
    polling: {
      label: "Polling",
      icon: RefreshCw,
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    },
    idle: {
      label: "Idle",
      icon: Moon,
      className: "border-border bg-muted/40 text-muted-foreground",
    },
  };
  const M = modeMeta[mode];

  const windowLabel = control
    ? `${hourLabel(control.windowStartHour)}–${hourLabel(control.windowEndHour)} PT`
    : "";
  const subline = (() => {
    if (tripped) return "Circuit breaker tripped — ingest halted until cleared.";
    if (mode === "streaming") return `Live Tessie stream · window ${windowLabel}.`;
    if (mode === "polling")
      return control?.enabled
        ? `Falling back to polling every ${control.pollFallbackSeconds}s (outside window or socket down).`
        : `Toggle off — polling every ${control?.pollFallbackSeconds ?? 120}s while a drive is active.`;
    // idle
    return shouldStream
      ? `Ready — will stream when a drive is active in ${windowLabel}.`
      : `No active drive. Streaming runs only ${windowLabel}.`;
  })();

  return (
    <Card className={cn("mb-6", tripped && "border-destructive/50")}>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <Satellite className="size-5 text-muted-foreground" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">Tesla telemetry ingest</span>
              <Badge className={cn("gap-1 font-medium", tripped ? "border-destructive/50 bg-destructive/10 text-destructive" : M.className)}>
                {tripped ? (
                  <RefreshCw className="size-3" aria-hidden />
                ) : (
                  <M.icon className={cn("size-3", mode === "streaming" && "animate-pulse")} aria-hidden />
                )}
                {tripped ? "Tripped" : M.label}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{error ? `Error: ${error}` : subline}</p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
          <span className="text-muted-foreground">Live stream</span>
          <Switch
            checked={control?.enabled ?? false}
            onCheckedChange={(next) => void toggle(next)}
            disabled={saving || !control}
            aria-label="Toggle Tesla live streaming (off = poll instead)"
          />
        </label>
      </CardContent>
    </Card>
  );
}
