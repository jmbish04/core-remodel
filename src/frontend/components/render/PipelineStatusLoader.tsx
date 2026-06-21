import { Activity, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { PipelineStatus, PipelineStatusMessage } from "./types";

interface PipelineStatusLoaderProps {
  /**
   * WebSocket URL (e.g. "/api/render/realtime"). A relative path is upgraded to
   * ws/wss against the current origin. Per the implementation plan §9 this WS is
   * terminated by a Durable Object on the backend.
   */
  socketUrl: string;
  className?: string;
}

function toAbsoluteWsUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  if (typeof window === "undefined") return url;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (url.startsWith("/")) {
    return `${proto}//${window.location.host}${url}`;
  }
  return `${proto}//${window.location.host}/${url}`;
}

function badgeVariantForStatus(
  status: PipelineStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "RUNNING":
      return "default";
    case "DONE":
      return "secondary";
    case "FAILED":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * PipelineStatusLoader — connects to a realtime WebSocket and renders a status
 * card with a stage Badge, a progress bar, and a streaming log line. Returns
 * null while the pipeline is IDLE so it stays out of the way until work starts.
 */
export function PipelineStatusLoader({
  socketUrl,
  className,
}: PipelineStatusLoaderProps) {
  const [message, setMessage] = useState<PipelineStatusMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  useEffect(() => {
    closedByUs.current = false;

    const connect = () => {
      if (typeof window === "undefined") return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(toAbsoluteWsUrl(socketUrl));
      } catch {
        // Schedule a retry if the socket cannot be constructed.
        reconnectTimer.current = setTimeout(connect, 4000);
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as
            | Partial<PipelineStatusMessage>
            | undefined;
          if (!parsed || typeof parsed.status !== "string") return;
          setMessage({
            status: parsed.status as PipelineStatus,
            stage: parsed.stage ?? "",
            progress:
              typeof parsed.progress === "number"
                ? Math.max(0, Math.min(100, parsed.progress))
                : 0,
            message: parsed.message ?? "",
          });
        } catch {
          /* ignore malformed frames */
        }
      };

      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (!closedByUs.current) {
          reconnectTimer.current = setTimeout(connect, 4000);
        }
      };

      socket.onerror = () => {
        // onclose handles the reconnect.
        socket.close();
      };
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [socketUrl]);

  const status: PipelineStatus = message?.status ?? "IDLE";

  const statusIcon = useMemo(() => {
    switch (status) {
      case "RUNNING":
      case "QUEUED":
        return <Loader2 className="size-4 animate-spin text-blue-400" />;
      case "DONE":
        return <CheckCircle2 className="size-4 text-emerald-400" />;
      case "FAILED":
        return <AlertTriangle className="size-4 text-destructive" />;
      default:
        return <Activity className="size-4 text-muted-foreground" />;
    }
  }, [status]);

  // Stay out of the way until there is something to show.
  if (status === "IDLE") {
    return null;
  }

  const progress = message?.progress ?? 0;

  return (
    <Card className={cn("ring-1 ring-border/40", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          {statusIcon}
          <CardTitle className="text-sm">Pipeline Status</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {message?.stage && (
            <Badge variant="outline" className="text-[10px]">
              {message.stage}
            </Badge>
          )}
          <Badge variant={badgeVariantForStatus(status)} className="text-[10px]">
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Tailwind-only progress bar (no extra dependency). */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              status === "FAILED" ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {message?.message || "Waiting for updates..."}
          </p>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {Math.round(progress)}%
          </span>
        </div>
        {!connected && (
          <p className="text-[11px] text-amber-400/80">
            Reconnecting to live updates...
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default PipelineStatusLoader;
