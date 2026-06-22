import { DurableObject } from "cloudflare:workers";

/**
 * Durable Object realtime fan-out hub for estimate/contract collaboration and
 * upload/processing progress events.
 *
 * One instance exists per "room" name (via `getByName(room)`): WebSocket clients
 * connect to a room and receive every message broadcast to it; producers POST a
 * JSON payload to `/emit` to fan it out to all connected clients in that room.
 *
 * Implemented with the **Hibernatable WebSockets API** (`ctx.acceptWebSocket` +
 * the `webSocket*` handler methods + `ctx.getWebSockets()`), the Cloudflare-
 * recommended pattern: the DO can hibernate (stop being billed for wall-clock)
 * while idle connections stay open, and the runtime wakes it to deliver messages.
 * There is no in-memory socket set to lose when the instance is evicted —
 * `ctx.getWebSockets()` always returns the live sockets, even after waking.
 *
 * @see https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */
export class EstimateCollabHub extends DurableObject<Env> {
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
      // Hand the server socket to the runtime. From here the runtime owns its
      // lifecycle and will call webSocketMessage/Close/Error on this DO — even
      // after it has hibernated.
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
      return Response.json({
        status: "ok",
        sockets: this.ctx.getWebSockets().length,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Application-level keepalive. Clients send the literal string `"ping"` and
   * expect `"pong"` back. (Protocol-level WebSocket pings are answered by the
   * runtime automatically without waking the DO.)
   */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      ws.send("pong");
    }
  }

  /**
   * Connection closed. With `compatibility_date` 2026-05-17 the
   * `web_socket_auto_reply_to_close` flag is on, so the runtime has already
   * completed the close handshake; calling `close()` here is a harmless
   * safeguard for older runtimes. No manual bookkeeping is needed — the socket
   * has already left `ctx.getWebSockets()`.
   */
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closing — ignore
    }
  }

  /** Non-disconnection error on a socket; close it so it leaves the pool. */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("EstimateCollabHub websocket error", error);
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
