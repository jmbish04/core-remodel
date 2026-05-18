/**
 * Durable Object realtime fanout hub for estimate/contract collaboration events.
 *
 * One Durable Object instance is created per "room" name (via idFromName(room)).
 * WebSocket clients connect to that room instance and receive broadcast messages.
 */
export class EstimateCollabHub {
  private readonly sockets = new Set<WebSocket>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade();
    }

    if (url.pathname.endsWith("/emit") && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      this.broadcast(
        JSON.stringify({
          type: "realtime_event",
          payload,
          timestamp: new Date().toISOString(),
        }),
      );
      return Response.json({ success: true, delivered: this.sockets.size });
    }

    if (url.pathname.endsWith("/health")) {
      return Response.json({
        status: "ok",
        sockets: this.sockets.size,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.sockets.add(server);

    server.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data === "ping") {
        server.send("pong");
      }
    });

    const removeSocket = () => {
      this.sockets.delete(server);
      try {
        server.close();
      } catch {
        // noop
      }
    };

    server.addEventListener("close", removeSocket);
    server.addEventListener("error", removeSocket);

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(message: string) {
    const stale: WebSocket[] = [];
    for (const socket of this.sockets) {
      try {
        socket.send(message);
      } catch {
        stale.push(socket);
      }
    }
    for (const socket of stale) {
      this.sockets.delete(socket);
      try {
        socket.close();
      } catch {
        // noop
      }
    }
  }
}
