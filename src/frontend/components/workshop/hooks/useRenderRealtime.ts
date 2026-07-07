// ---------------------------------------------------------------------------
// useRenderRealtime — session-keyed realtime subscription (reuse of the render
// realtime channel; see render/PipelineStatusLoader.tsx for the socket idiom).
//
// The DO is keyed PER SESSION: a session-less connection receives nothing, so
// this only connects while `sessionId` is non-null and reconnects/closes as it
// changes. Frames are `{ type:'realtime_event', payload:{ status, stage,
// progress, message }, timestamp }` — status lives at `payload.status`, and the
// terminal values are SUCCESS / FAILED (there is NO 'DONE'). onFrame fires for
// every frame (progress narration); onComplete fires once on SUCCESS or FAILED.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

export type RealtimeStatus = "PROCESSING" | "SUCCESS" | "FAILED";

export interface RealtimeFramePayload {
  status: RealtimeStatus;
  stage: string;
  progress: number;
  message: string;
}

interface UseRenderRealtimeOptions {
  onFrame?: (frame: RealtimeFramePayload) => void;
  onComplete?: (status: "SUCCESS" | "FAILED") => void;
}

function toAbsoluteWsUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

/**
 * Subscribe to a render session's realtime frames. Pass `null` to stay
 * disconnected (e.g. when no recipe is running).
 */
export function useRenderRealtime(
  sessionId: string | null,
  options: UseRenderRealtimeOptions,
): void {
  // Keep the latest callbacks without re-opening the socket on every render.
  const onFrameRef = useRef(options.onFrame);
  const onCompleteRef = useRef(options.onComplete);
  onFrameRef.current = options.onFrame;
  onCompleteRef.current = options.onComplete;

  useEffect(() => {
    if (typeof window === "undefined" || !sessionId) return;

    let closedByUs = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const url = toAbsoluteWsUrl(
        `/api/render/realtime?session=${encodeURIComponent(sessionId)}`,
      );
      try {
        socket = new WebSocket(url);
      } catch {
        reconnectTimer = setTimeout(connect, 4000);
        return;
      }

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            payload?: Partial<RealtimeFramePayload>;
          };
          const status = msg.payload?.status;
          if (!status) return;
          const frame: RealtimeFramePayload = {
            status: status as RealtimeStatus,
            stage: msg.payload?.stage ?? "",
            progress:
              typeof msg.payload?.progress === "number"
                ? Math.max(0, Math.min(100, msg.payload.progress))
                : 0,
            message: msg.payload?.message ?? "",
          };
          onFrameRef.current?.(frame);
          if (frame.status === "SUCCESS" || frame.status === "FAILED") {
            onCompleteRef.current?.(frame.status);
          }
        } catch {
          /* ignore malformed frames */
        }
      };

      socket.onclose = () => {
        socket = null;
        if (!closedByUs) reconnectTimer = setTimeout(connect, 4000);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
    };
  }, [sessionId]);
}
