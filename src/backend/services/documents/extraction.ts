/**
 * @fileoverview Document extraction + embedding pipeline (Phase 2, P2-02).
 *
 * `extractAndEmbedDocument(env, documentId)` is the single entry point, invoked
 * post-upload via `c.executionCtx.waitUntil(...)` from
 * `src/backend/api/routes/supporting-documents.ts` (and re-triggerable via the
 * `POST /:id/reextract` route). It never throws — all failures are captured
 * into `extractionStatus: "failed"` plus `metadata.extractionError` so the
 * fire-and-forget caller can't crash the request/response cycle.
 *
 * PDF/office parsing note:
 * The original P2 roadmap spec named `@llamaindex/liteparse` for PDF parsing.
 * That package ships native N-API binaries (per-platform `.node` files under
 * `optionalDependencies`) and CANNOT run in the Cloudflare Workers V8 isolate
 * (no filesystem, no native addons). We use the Workers AI `env.AI.toMarkdown()`
 * binding instead — it is purpose-built for exactly this (PDF/DOCX/XLSX/HTML →
 * markdown) and runs entirely inside the Workers AI service, no native deps.
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { supportingDocuments } from "@backend/db";

/** Workers AI vision OCR model — used for image sourceType documents. */
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct" as const;

/** Workers AI text embedding model — matches the house style in embed-chunks.ts. */
const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/** Approximate chunk size (chars) for embedding, with overlap — mirrors embed-chunks.ts sizing intent. */
const CHUNK_SIZE = 1_000;
const CHUNK_OVERLAP = 150;

/** Hard cap on chunks embedded per document, to bound Vectorize/AI usage. */
const MAX_CHUNKS_PER_DOC = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Split `text` into ~CHUNK_SIZE character windows with CHUNK_OVERLAP overlap
 * between consecutive chunks, capped at MAX_CHUNKS_PER_DOC chunks total.
 */
function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    const end = Math.min(start + CHUNK_SIZE, trimmed.length);
    const chunk = trimmed.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= trimmed.length) break;
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }
  return chunks;
}

/**
 * OCR an image buffer using the Workers AI vision model. Prompt/params are the
 * exact house-mandated OCR invocation — do not "improve" the prompt without
 * updating callers that depend on plain extracted text.
 */
async function extractTextFromImage(env: Env, buf: ArrayBuffer): Promise<string> {
  const imageArray = [...new Uint8Array(buf)];
  const prompt =
    "Act as an OCR engine. Extract all readable text from this image exactly as it appears. Do not summarize, interpret, or add conversational filler. Maintain layout spacing where possible.";

  const aiResponse = (await env.AI.run(VISION_MODEL, {
    image: imageArray,
    prompt,
    max_tokens: 1024,
  } as Parameters<typeof env.AI.run>[1])) as { description?: string; response?: string };

  return aiResponse.description || aiResponse.response || "";
}

/**
 * Convert a PDF/office-document buffer to markdown text via the Workers AI
 * `toMarkdown` service. This is the Workers-native substitute for
 * `@llamaindex/liteparse` (see file header note).
 */
async function extractTextFromDocument(
  env: Env,
  name: string,
  mimeType: string,
  buf: ArrayBuffer,
): Promise<string> {
  const blob = new Blob([buf], { type: mimeType });
  const result = await env.AI.toMarkdown({ name, blob });
  if (result.format === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * Embed up to MAX_CHUNKS_PER_DOC chunks of `text` and upsert them into
 * VECTOR_INDEX (the general-purpose `remodel-embeddings` index — distinct
 * from RESEARCH_INDEX and PHOTO_INDEX). Vector id scheme: `doc:{documentId}:{chunkIdx}`.
 */
async function embedAndUpsertDocumentChunks(
  env: Env,
  documentId: string,
  title: string,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  const embeddingResult = (await env.AI.run(EMBEDDING_MODEL, {
    text: chunks,
  })) as { data: number[][] };

  const vectors = embeddingResult.data.map((values, chunkIdx) => ({
    id: `doc:${documentId}:${chunkIdx}`,
    values,
    metadata: {
      kind: "document",
      documentId,
      title,
      chunkIdx,
    },
  }));

  await env.VECTOR_INDEX.upsert(vectors);
  return vectors.length;
}

/**
 * Extract text (OCR for images, toMarkdown for PDFs/office docs) from a
 * supporting document's R2 object, store it on the row, and embed it into
 * Vectorize. Never throws — all errors are swallowed into
 * `extractionStatus: "failed"` + `metadata.extractionError`.
 */
export async function extractAndEmbedDocument(env: Env, documentId: string): Promise<void> {
  const db = drizzle(env.DB);

  const doc = await db
    .select()
    .from(supportingDocuments)
    .where(eq(supportingDocuments.id, documentId))
    .get();

  if (!doc) {
    // Nothing to do — document may have been deleted between enqueue and run.
    return;
  }

  // Nothing to extract: no R2 object, or the source is a bare URL/video (not
  // fetchable text content for this pipeline).
  if (!doc.r2ObjectKey || doc.sourceType === "url" || doc.sourceType === "video") {
    await db
      .update(supportingDocuments)
      .set({ extractionStatus: "skipped", datetimeUpdated: new Date() })
      .where(eq(supportingDocuments.id, documentId))
      .run();
    return;
  }

  await db
    .update(supportingDocuments)
    .set({ extractionStatus: "processing", datetimeUpdated: new Date() })
    .where(eq(supportingDocuments.id, documentId))
    .run();

  try {
    const object = await env.ARTIFACTS_BUCKET.get(doc.r2ObjectKey);
    if (!object) {
      throw new Error(`R2 object not found: ${doc.r2ObjectKey}`);
    }
    const buf = await object.arrayBuffer();
    const mimeType = doc.mimeType || object.httpMetadata?.contentType || "application/octet-stream";

    let text: string;
    if (mimeType.startsWith("image/")) {
      text = await extractTextFromImage(env, buf);
    } else {
      text = await extractTextFromDocument(env, doc.title, mimeType, buf);
    }

    await db
      .update(supportingDocuments)
      .set({
        extractedText: text || null,
        extractionStatus: "complete",
        datetimeUpdated: new Date(),
      })
      .where(eq(supportingDocuments.id, documentId))
      .run();

    if (text && text.trim()) {
      // Embedding failures should not roll back a successful extraction — log
      // into metadata but keep extractionStatus "complete".
      try {
        await embedAndUpsertDocumentChunks(env, documentId, doc.title, text);
      } catch (embedError) {
        const metadata = parseMetadata(doc.metadata);
        metadata.embeddingError =
          embedError instanceof Error ? embedError.message : "Unknown embedding error";
        await db
          .update(supportingDocuments)
          .set({ metadata: JSON.stringify(metadata), datetimeUpdated: new Date() })
          .where(eq(supportingDocuments.id, documentId))
          .run();
      }
    }
  } catch (error) {
    const metadata = parseMetadata(doc.metadata);
    metadata.extractionError = error instanceof Error ? error.message : "Unknown extraction error";
    await db
      .update(supportingDocuments)
      .set({
        extractionStatus: "failed",
        metadata: JSON.stringify(metadata),
        datetimeUpdated: new Date(),
      })
      .where(eq(supportingDocuments.id, documentId))
      .run();
  }
}
