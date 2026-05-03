/**
 * @fileoverview Synchronous chat task — single-turn AI response.
 */

import type { ChatMessage } from "../providers";
import { getModelRegistry } from "../models";
import { getProvider } from "../providers";

export type { ChatMessage };

export async function chat(
  env: Env,
  opts: {
    messages: ChatMessage[];
    cacheTtl?: number;
  },
): Promise<string> {
  const provider = getProvider(env);
  const model = getModelRegistry(env).chat;
  const result = await provider.invokeModel(
    model,
    {
      messages: opts.messages,
      temperature: 0.3,
    },
    { cacheTtl: opts.cacheTtl },
  );

  return result.response;
}
