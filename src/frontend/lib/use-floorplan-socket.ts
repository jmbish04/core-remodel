/**
 * @fileoverview useFloorplanSocket — client hook for the real-time floor-plan room
 * served by `FloorplanSessionDO` (0006 Phase 2C).
 *
 * Connects to `/api/room/:room/ws`, auto-reconnects with backoff, sends an app-level
 * `"ping"` keepalive (answered by the DO's auto-responder), and surfaces inbound
 * `WALL_TOUCH` broadcasts so the UI can flash the wall/space another participant
 * (the phone, or Claude via MCP) just touched. Mirrors the WS-client conventions used
 * by `EstimatesApp` (protocol detection, reconnect).
 */

import * as React from "react";

export type SocketStatus = "connecting" | "open" | "closed";

/** A wall-touch broadcast received from another participant in the room. */
export interface IncomingWallTouch {
  elementId: string;
  /** Sender role from their connect param, e.g. "phone" | "claude". */
  source: string;
  senderId: string;
}

export interface FloorplanSocket {
  status: SocketStatus;
  /** Broadcast that this client touched `elementId` (fans out to the other peers). */
  sendWallTouch: (elementId: string) => void;
}

const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Subscribe to a floor-plan room. `source` labels this client (e.g. "phone").
 * `onWallTouch` fires for each inbound peer touch — keep it stable or it's fine; the
 * latest is always used via a ref so the socket isn't torn down on every render.
 */
export function useFloorplanSocket(
  room: string,
  source: string,
  onWallTouch: (msg: IncomingWallTouch) => void,
): FloorplanSocket {
  const [status, setStatus] = React.useState<SocketStatus>("connecting");
  const wsRef = React.useRef<WebSocket | null>(null);
  const onTouchRef = React.useRef(onWallTouch);
  onTouchRef.current = onWallTouch;

  React.useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/api/room/${encodeURIComponent(
        room,
      )}/ws?source=${encodeURIComponent(source)}`;
      setStatus("connecting");

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        pingTimer = setInterval(() => {
          try {
            ws.send("ping");
          } catch {
            // socket closing — the close handler will reconnect
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        try {
          const data = JSON.parse(event.data) as {
            type?: string;
            elementId?: string;
            source?: string;
            senderId?: string;
          };
          if (data.type === "WALL_TOUCH" && typeof data.elementId === "string") {
            onTouchRef.current({
              elementId: data.elementId,
              source: data.source ?? "unknown",
              senderId: data.senderId ?? "",
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        setStatus("closed");
        if (disposed) return;
        attempt += 1;
        const delay = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // noop — onclose handles reconnect
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      try {
        wsRef.current?.close();
      } catch {
        // noop
      }
    };
  }, [room, source]);

  const sendWallTouch = React.useCallback((elementId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "WALL_TOUCH", elementId }));
    }
  }, []);

  return React.useMemo(() => ({ status, sendWallTouch }), [status, sendWallTouch]);
}
