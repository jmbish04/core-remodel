import { DurableObject } from "cloudflare:workers";

import {
  inboundMessageSchema,
  wallTouchMessageSchema,
  type ErrorMessage,
  type OutboundMessage,
} from "./floorplan-messages";

/**
 * Per-connection metadata, attached to each socket via `serializeAttachment` so it
 * survives Durable Object hibernation (there is no in-memory map to lose).
 */
interface FloorplanConnection {
  /** Opaque id assigned on connect; echoed as `senderId` on broadcasts. */
  connId: string;
  /** Role from the `?source=` connect param, e.g. "phone" | "claude". */
  source: string;
}

/**
 * FloorplanSessionDO — real-time synchronization room for the collaborative floor plan.
 *
 * One instance per room name (the Worker routes via `env.FLOORPLAN_SESSION.getByName(room)`,
 * so the same room name always lands on the same instance). Every WebSocket client in a
 * room receives a `WALL_TOUCH` the moment any OTHER client in that room sends one, which
 * drives the bidirectional highlight loop between the phone app and Claude (via the MCP
 * bridge).
 *
 * Built on the **Hibernatable WebSockets API** (`ctx.acceptWebSocket` + the `webSocket*`
 * handlers + `ctx.getWebSockets()`) — the Cloudflare-recommended pattern: idle rooms
 * hibernate (no wall-clock billing) while their sockets stay open, and the runtime wakes
 * the DO only to deliver a message. `ctx.getWebSockets()` is the source of truth for live
 * sockets, so nothing is lost across eviction/wake.
 *
 * Heartbeats: protocol-level ping frames are answered automatically by the runtime, and
 * an app-level `"ping"` → `"pong"` is wired via `setWebSocketAutoResponse` so keepalives
 * never wake the DO.
 *
 * @see https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */
export class FloorplanSessionDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // App-level keepalive answered without waking the DO: clients may send the literal
    // string "ping" on an interval and the runtime replies "pong" for them.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /**
   * HTTP entrypoint (the Worker forwards the original request here):
   *  - WebSocket upgrade → accept the socket into the hibernation pool.
   *  - `GET .../health`  → report the live socket count for this room.
   *
   * NOTE: forwarding the real upgrade request to the DO via `stub.fetch(request)` and
   * accepting it here is the correct DO WebSocket pattern (this is NOT the `stub.fetch`
   * RPC anti-pattern, which is about hand-built synthetic requests to Agents).
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      if (url.pathname.endsWith("/health")) {
        return Response.json({ status: "ok", sockets: this.ctx.getWebSockets().length });
      }
      return new Response("Expected a WebSocket Upgrade request", { status: 426 });
    }

    // Identify the participant so broadcasts can be labelled by source ("phone"/"claude").
    const source = (url.searchParams.get("source") || "unknown").slice(0, 32);
    const connId = crypto.randomUUID();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Persist identity on the socket itself — survives hibernation, no in-memory map.
    server.serializeAttachment({ connId, source } satisfies FloorplanConnection);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A message arrived from a client. Validate it with Zod, then fan it out to every
   * OTHER socket in the room (never echo back to the sender).
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // We only speak JSON text frames. ("ping" is handled by the auto-responder above,
    // but answer defensively in case auto-response is ever disabled.)
    if (typeof message !== "string") return;
    if (message === "ping") {
      ws.send("pong");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.sendError(ws, "invalid_json");
      return;
    }

    const result = inboundMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.sendError(ws, "invalid_message");
      return;
    }

    const conn = (ws.deserializeAttachment() as FloorplanConnection | null) ?? {
      connId: "unknown",
      source: "unknown",
    };

    const outbound: OutboundMessage = {
      type: result.data.type,
      elementId: result.data.elementId,
      senderId: conn.connId,
      source: conn.source,
      ts: Date.now(),
    };
    this.broadcast(JSON.stringify(outbound), ws);
  }

  /**
   * Inject a `WALL_TOUCH` into the room from a NON-socket source — the measurement MCP
   * bridge (i.e. Claude). The `highlight_wall` MCP tool calls this over the DO stub
   * (`env.FLOORPLAN_SESSION.getByName(room).injectTouch(...)`): the server-side half of
   * the bidirectional highlight loop, so a wall lights up (amber, "Claude is pointing
   * here") on every connected screen — phone + desktop — without Claude holding a socket.
   *
   * This is the blessed DO **RPC** pattern (a public method on the stub), NOT the
   * `stub.fetch` synthetic-request anti-pattern. `elementId` is validated with the SAME
   * Zod schema as a client message; there is no sender to exclude, so it broadcasts to
   * every live socket. If the DO is hibernating, the RPC wakes it and `getWebSockets()`
   * returns the still-open sockets.
   *
   * @param elementId SVG segment id, e.g. `upper_wall_segment_12` / `lower_wall_segment_3`.
   * @param source    Role label echoed on the broadcast envelope (defaults to "claude").
   * @returns the number of connected screens the touch was delivered to.
   */
  async injectTouch(elementId: string, source = "claude"): Promise<number> {
    const parsed = wallTouchMessageSchema.safeParse({ type: "WALL_TOUCH", elementId });
    if (!parsed.success) {
      throw new Error(`invalid elementId: ${String(elementId).slice(0, 64)}`);
    }
    const outbound: OutboundMessage = {
      type: parsed.data.type,
      elementId: parsed.data.elementId,
      senderId: `server:${source}`.slice(0, 64),
      source: source.slice(0, 32),
      ts: Date.now(),
    };
    return this.broadcast(JSON.stringify(outbound), null);
  }

  /**
   * Connection closed. With `compatibility_date` ≥ 2026-05-17 the runtime has already
   * completed the close handshake (`web_socket_auto_reply_to_close`); closing here is a
   * harmless safeguard. No bookkeeping needed — the socket has left `getWebSockets()`.
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closing — ignore
    }
  }

  /** Non-disconnection error on a socket; close it so it leaves the pool. */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("FloorplanSessionDO websocket error", error);
    try {
      ws.close(1011, "internal error");
    } catch {
      // noop
    }
  }

  /** Send a structured error frame back to a single client. */
  private sendError(ws: WebSocket, error: string): void {
    try {
      ws.send(JSON.stringify({ type: "ERROR", error } satisfies ErrorMessage));
    } catch {
      // socket gone — ignore
    }
  }

  /**
   * Fan `message` out to every live socket in this room, optionally excluding one.
   * Pass the sender's socket to avoid echoing a client message back to itself, or
   * `null` to reach everyone (server-injected touches have no sender socket).
   * @returns the number of sockets the message was delivered to.
   */
  private broadcast(message: string, exclude: WebSocket | null): number {
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (exclude && socket === exclude) continue;
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
