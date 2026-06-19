/**
 * @fileoverview Vectorize embedding pipeline for research chunks.
 *
 * Generates embeddings via Workers AI (@cf/baai/bge-large-en-v1.5)
 * using the `env.AI.run()` pattern, then upserts into the existing
 * `remodel-embeddings` Vectorize index with a session-scoped namespace.
 */

import type { EmbedResult } from "../types";

/** Max chunks per embedding batch (Workers AI limit) */
const BATCH_SIZE = 100;

/**
 * Embed text chunks and upsert into Vectorize.
 *
 * @param env        Worker environment bindings
 * @param chunks     Array of text chunks to embed
 * @param sessionId  Research session ID for namespace isolation
 * @returns          Embed result with chunk count and namespace
 */
export async function embedAndUpsertChunks(
  env: Env,
  chunks: string[],
  sessionId: number,
): Promise<EmbedResult> {
  const namespace = `research:${sessionId}`;

  if (chunks.length === 0) {
    return { chunkCount: 0, namespace };
  }

  // Process in batches to respect Workers AI limits
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Generate embeddings via Workers AI — strict env.AI.run() pattern
    const embeddingResult = (await env.AI.run(
      "@cf/baai/bge-large-en-v1.5",
      { text: batch },
    )) as { data: number[][] };

    // Build Vectorize vectors with metadata
    const vectors = embeddingResult.data.map((vector, batchIdx) => ({
      id: `research-${sessionId}-chunk-${i + batchIdx}`,
      values: vector,
      namespace,
      metadata: {
        sessionId,
        chunkIndex: i + batchIdx,
        textPreview: batch[batchIdx].slice(0, 200),
      },
    }));

    // Upsert into the shared remodel-embeddings Vectorize index
    await env.RESEARCH_INDEX.upsert(vectors);
  }

  return { chunkCount: chunks.length, namespace };
}

/**
 * Delete all vectors for a given research session from Vectorize.
 *
 * @param env        Worker environment bindings
 * @param sessionId  Research session ID
 * @param chunkCount Total number of chunks to delete
 */
export async function deleteSessionVectors(
  env: Env,
  sessionId: number,
  chunkCount: number,
): Promise<void> {
  const ids = Array.from(
    { length: chunkCount },
    (_, i) => `research-${sessionId}-chunk-${i}`,
  );

  if (ids.length > 0) {
    await env.RESEARCH_INDEX.deleteByIds(ids);
  }
}
