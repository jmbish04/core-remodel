import { DurableObject } from "cloudflare:workers";

/**
 * Durable Object realtime fan-out hub for the discovery finder (0032 D2 / 0022
 * §14.5).
 *
 * One instance per search slug (`getByName("search:<slug>")`): a browser viewing
 * `/admin/shopping/showrooms/finder/<slug>` opens a WebSocket to that room and
 * receives every event the worker broadcasts while the search runs/refines —
 * `search_status`, `revision_added`, `results_ready`. The finder engine
 * (discovery-search.ts) is the producer: after each write it POSTs a small event
 * to `/emit`, so an open finder page updates live without polling (a poll fallback
 * still covers a dropped socket).
 *
 * Same Hibernatable-WebSockets pattern as EstimateCollabHub: `ctx.acceptWebSocket`
 * + the `webSocket*` handlers + `ctx.getWebSockets()`. The DO can hibernate (stop
 * being billed for wall-clock) while idle sockets stay open, and there is no
 * in-memory socket set to lose on eviction. It carries NO alarm and no growing
 * storage, so it is outside the DO-alarm cost-safety surface entirely.
 *
 * @see https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */
export class DiscoveryHub extends DurableObject<Env> {
  /**
   * HTTP entrypoint. Handles three shapes:
   * - WebSocket upgrade  → accept the socket into the hibernation pool.
   * - `POST .../emit`    → broadcast the JSON body to every socket in the room.
   * - `GET  .../health`  → report the live socket count.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Hand the server socket to the runtime; it owns the lifecycle from here and
      // will call webSocketMessage/Close/Error on this DO even after hibernation.
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/emit") && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const delivered = this.broadcast(
        JSON.stringify({
          type: "realtime_event",
          payload,
          timestamp: new Date().toISOString(),
        }),
      );
      return Response.json({ success: true, delivered });
    }

    if (url.pathname.endsWith("/health")) {
      return Response.json({ status: "ok", sockets: this.ctx.getWebSockets().length });
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Application-level keepalive. Clients send the literal string `"ping"` and
   * expect `"pong"` back. (Protocol-level pings are answered by the runtime
   * automatically without waking the DO.)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      ws.send("pong");
    }
  }

  /** Connection closed — the socket has already left ctx.getWebSockets(); close() is a safeguard. */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closing — ignore
    }
  }

  /** Non-disconnection error on a socket; close it so it leaves the pool. */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("DiscoveryHub websocket error", error);
    try {
      ws.close(1011, "internal error");
    } catch {
      // noop
    }
  }

  /**
   * Fan `message` out to every live socket in this room.
   * @returns the number of sockets the message was delivered to.
   */
  private broadcast(message: string): number {
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        delivered += 1;
      } catch {
        // Socket is mid-close; the runtime drops it from getWebSockets().
      }
    }
    return delivered;
  }
}
