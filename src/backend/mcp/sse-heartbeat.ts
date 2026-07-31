/**
 * @fileoverview MCP SSE keepalive (0032 K1) — app-level heartbeat on the connector.
 *
 * THE PROBLEM (0022 §14.4 / P7-INFRA-01): MCP tools report "down" during Claude
 * real-time VOICE sessions but work in normal text chat. The connector's only
 * keepalive is the `agents` library's ~30s SSE ping, which is slow enough that a
 * cellular NAT or iOS can idle-kill the long-lived `/mcp/sse` (and streamable-HTTP
 * streaming) socket during the sparse gaps between voice tool calls — the same
 * failure PR #313 fixed for the a2a-v2 stream.
 *
 * THE FIX: wrap the MCP api-handlers and, for any `text/event-stream` response,
 * splice a `: ping` SSE comment frame into the stream every `INTERVAL_MS`. Comment
 * lines (`:`-prefixed) are ignored by every SSE client, so this is invisible to the
 * protocol but keeps the socket warm. It rules out transport idle-kill as the cause;
 * if voice still drops, the remaining suspects (DO hibernation between calls, OAuth
 * token expiry) are the next spike — documented, not yet needed.
 *
 * SAFETY: only `text/event-stream` responses are wrapped. A normal JSON
 * request/response tool call (the text-chat path) is returned as the SAME Response
 * object, untouched, so this cannot regress normal-chat MCP. Uses a ReadableStream
 * controller (not a second WritableStream writer) so the pump and the heartbeat never
 * race on a pending write. Both `/mcp` (streamable HTTP — which itself uses SSE
 * framing for streaming responses) and `/mcp/sse` are wrapped, since a voice session
 * can ride either transport.
 */

/** Heartbeat cadence — 15s, matching the a2a-v2 keepalive (#313); well under the ~30s idle-kill window. */
const INTERVAL_MS = 15_000;

/** The minimal handler shape OAuthProvider's `apiHandlers` accept. */
export interface FetchHandler {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
}

/**
 * Wrap an MCP api-handler so its SSE responses carry a periodic `: ping` heartbeat.
 * Non-SSE responses are returned unchanged (the identical Response object).
 */
export function withSseHeartbeat(inner: FetchHandler): FetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const res = await inner.fetch(request, env, ctx);
      // Header values are case-insensitive — lowercase before matching so a
      // `Text/Event-Stream` content-type is still recognised as a stream.
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      // NON-SSE PASS-THROUGH: return the original Response verbatim (a provable
      // no-op — same object, no header/body rewrite), so a normal JSON tool call
      // on /mcp is never touched.
      if (!res.body || !contentType.includes("text/event-stream")) return res;

      const encoder = new TextEncoder();
      const reader = res.body.getReader();
      let timer: ReturnType<typeof setInterval> | undefined;
      // Once the consumer cancels, the controller is already closed — any further
      // close()/error() on it throws. This flag makes the pump skip those calls.
      let cancelled = false;

      const clearTimer = () => {
        if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // enqueue() is synchronous and safe to call from both the pump and the
          // timer — it just appends to the internal queue (no pending-write race).
          timer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              // Stream already closed/errored — stop pinging so the timer can't leak.
              clearTimer();
            }
          }, INTERVAL_MS);

          // The pump handles its own errors; the trailing .catch() is a belt-and-
          // suspenders guard so nothing floats even if controller.error() throws.
          void (async () => {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) controller.enqueue(value);
              }
              if (!cancelled) controller.close();
            } catch (err) {
              // A post-cancellation close()/enqueue() throws on an already-closed
              // controller — only surface a genuine upstream error, and even then
              // guard error() itself (it throws if the controller is already gone).
              if (!cancelled) {
                try {
                  controller.error(err);
                } catch {
                  /* controller already closed — nothing to surface */
                }
              }
            } finally {
              clearTimer();
            }
          })().catch(() => {
            /* unreachable in practice — the IIFE swallows its own errors */
          });
        },
        cancel(reason) {
          cancelled = true;
          clearTimer();
          // Return the cancellation promise so the runtime awaits reader cleanup
          // (a bare fire-and-forget could leave the reader locked if the isolate
          // is reclaimed first).
          return reader.cancel(reason).catch(() => {});
        },
      });

      // Strip framing headers that describe the ORIGINAL body: the heartbeat stream
      // has no fixed length and isn't re-encoded, so a propagated Content-Length /
      // Content-Encoding would make the client stop early or wait for bytes that
      // never come.
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");

      return new Response(stream, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    },
  };
}
