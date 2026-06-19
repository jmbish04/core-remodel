/**
 * @fileoverview Markdown chunking for Vectorize embedding pipeline.
 *
 * Splits markdown text into chunks that respect the token limit of
 * @cf/baai/bge-large-en-v1.5 (512 tokens ≈ ~2000 chars conservatively).
 *
 * Strategy:
 *   1. Split on section headers (## or ###) for semantic boundaries
 *   2. If a section exceeds the limit, split on paragraph breaks
 *   3. If a paragraph still exceeds, split on sentence boundaries
 *   4. Apply overlap to preserve context across chunk boundaries
 */

import type { ChunkResult } from "../types";

/** Conservative char limit per chunk (512 tokens ≈ ~2000 chars) */
const MAX_CHUNK_CHARS = 1800;

/** Overlap between consecutive chunks for context continuity */
const OVERLAP_CHARS = 200;

/**
 * Chunk a markdown document into embedding-safe text segments.
 *
 * @param markdown  Raw markdown text
 * @returns         Array of text chunks with estimated token count
 */
export function chunkMarkdown(markdown: string): ChunkResult {
  if (!markdown || markdown.trim().length === 0) {
    return { chunks: [], totalTokensEstimate: 0 };
  }

  // Split on section headers (## or ###), keeping the header with its content
  const sections = splitOnHeaders(markdown);

  const chunks: string[] = [];

  for (const section of sections) {
    if (section.length <= MAX_CHUNK_CHARS) {
      chunks.push(section.trim());
    } else {
      // Section too long — split on paragraph breaks
      const paragraphChunks = splitOnParagraphs(section);
      chunks.push(...paragraphChunks);
    }
  }

  // Apply overlap between chunks
  const overlappedChunks = applyOverlap(chunks);

  // Filter out empty or trivially small chunks
  const finalChunks = overlappedChunks.filter((c) => c.trim().length > 50);

  // Rough token estimate (1 token ≈ 4 chars for English text)
  const totalTokensEstimate = finalChunks.reduce(
    (acc, c) => acc + Math.ceil(c.length / 4),
    0,
  );

  return { chunks: finalChunks, totalTokensEstimate };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function splitOnHeaders(text: string): string[] {
  // Split on lines that start with ## or ### (keeping the header line)
  const headerPattern = /^(?=#{2,3}\s)/m;
  const parts = text.split(headerPattern);
  return parts.filter((p) => p.trim().length > 0);
}

function splitOnParagraphs(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current.trim().length > 0) {
    // If still too long, split on sentences
    if (current.length > MAX_CHUNK_CHARS) {
      chunks.push(...splitOnSentences(current));
    } else {
      chunks.push(current.trim());
    }
  }

  return chunks;
}

function splitOnSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

function applyOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;

  const result: string[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const prevChunk = chunks[i - 1];
    const overlapText = prevChunk.slice(-OVERLAP_CHARS);
    result.push(overlapText + "\n" + chunks[i]);
  }

  return result;
}
