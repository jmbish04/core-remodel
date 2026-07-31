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
 * request/response tool call (the text-chat path) passes through untouched, so this
 * cannot regress normal-chat MCP. Uses a ReadableStream controller (not a second
 * WritableStream writer) so the pump and the heartbeat never race on a pending write.
 */

/** Heartbeat cadence — 15s, matching the a2a-v2 keepalive (#313); well under the ~30s idle-kill window. */
const INTERVAL_MS = 15_000;

/** The minimal handler shape OAuthProvider's `apiHandlers` accept. */
export interface FetchHandler {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
}

/**
 * Wrap an MCP api-handler so its SSE responses carry a periodic `: ping` heartbeat.
 * Non-SSE responses are returned unchanged.
 */
export function withSseHeartbeat(inner: FetchHandler): FetchHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const res = await inner.fetch(request, env, ctx);
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.body || !contentType.includes("text/event-stream")) return res;

      const encoder = new TextEncoder();
      const reader = res.body.getReader();
      let timer: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // enqueue() is synchronous and safe to call from both the pump and the
          // timer — it just appends to the internal queue (no pending-write race).
          timer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              // Stream already closed — the pump's finally will clear the timer.
            }
          }, INTERVAL_MS);

          void (async () => {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) controller.enqueue(value);
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            } finally {
              if (timer) clearInterval(timer);
            }
          })();
        },
        cancel(reason) {
          if (timer) clearInterval(timer);
          void reader.cancel(reason).catch(() => {});
        },
      });

      // Preserve status + headers; the body is the heartbeat-spliced stream.
      return new Response(stream, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    },
  };
}
