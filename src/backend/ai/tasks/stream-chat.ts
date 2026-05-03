/**
 * @fileoverview Streaming chat task — returns an SSE-formatted ReadableStream
 * suitable for the frontend chat UI.
 */

import type { ChatMessage } from "../providers";
import { streamChat as rawStreamChat } from "../providers";

export type { ChatMessage };

/**
 * Stream chat tokens from the model, wrapped in SSE `data:` frames.
 *
 * Each chunk emits `data: { "token": "..." }\n\n`.
 * The final chunk emits `event: done\ndata: {}\n\n`.
 */
export async function streamChat(
  env: Env,
  opts: {
    messages: ChatMessage[];
    cacheTtl?: number;
  },
): Promise<ReadableStream<Uint8Array>> {
  const source = await rawStreamChat(env, {
    messages: opts.messages,
    temperature: 0.3,
    cacheTtl: opts.cacheTtl,
  });

  return toSseStream(source);
}

// ---------------------------------------------------------------------------
// SSE wrapper
// ---------------------------------------------------------------------------

function toSseStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = source.getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            controller.close();
            break;
          }

          if (value) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ token: decoder.decode(value) })}\n\n`),
            );
          }
        }
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
