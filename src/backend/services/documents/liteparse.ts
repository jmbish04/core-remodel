/**
 * @fileoverview LiteParse WASM PDF processor for Cloudflare Workers.
 *
 * Uses `@llamaindex/liteparse-wasm` — a Rust-compiled WASM binary that runs
 * entirely inside the Worker's V8 isolate. No external API calls, no native
 * binaries, no env.AI dependency for PDF text extraction.
 *
 * The WASM module is imported as a pre-compiled `WebAssembly.Module` via
 * Wrangler's `CompiledWasm` rule and initialized once per isolate lifetime
 * via `initSync()`.
 *
 * Usage:
 *   const markdown = await parsePdfToMarkdown(pdfBytes);
 *   const result  = await parsePdf(pdfBytes);  // full structured result
 */

import { initSync, LiteParse } from "@llamaindex/liteparse-wasm";
import wasmModule from "@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm";

import type { ParseResult, LiteParseConfig } from "@llamaindex/liteparse-wasm";

// ── Singleton initialization ─────────────────────────────────────────────

let initialized = false;

/**
 * Ensure the WASM module is initialized. Safe to call multiple times —
 * only the first call performs the synchronous instantiation.
 */
function ensureInit(): void {
  if (initialized) return;
  initSync({ module: wasmModule });
  initialized = true;
}

// ── Public API ───────────────────────────────────────────────────────────

/** Default config — markdown output, no OCR (Workers doesn't have Tesseract). */
const DEFAULT_CONFIG: LiteParseConfig = {
  outputFormat: "markdown",
  ocrEnabled: false,
  imageMode: "off",
  quiet: true,
};

/**
 * Parse a PDF buffer and return the full structured ParseResult.
 *
 * Contains per-page text, markdown, text items with bounding boxes.
 * Useful for downstream spatial analysis (e.g. invoice table extraction).
 */
export async function parsePdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  config?: Partial<LiteParseConfig>,
): Promise<ParseResult> {
  ensureInit();

  const parser = new LiteParse({
    ...DEFAULT_CONFIG,
    ...config,
  });

  try {
    const data =
      pdfBytes instanceof Uint8Array
        ? pdfBytes
        : new Uint8Array(pdfBytes);

    return await parser.parse(data);
  } finally {
    parser.free();
  }
}

/**
 * Parse a PDF buffer and return concatenated markdown text.
 *
 * This is the drop-in replacement for `env.AI.toMarkdown()` — same input
 * (ArrayBuffer/Uint8Array), same output (string of markdown text), but
 * runs locally in the WASM sandbox instead of hitting Workers AI.
 */
export async function parsePdfToMarkdown(
  pdfBytes: ArrayBuffer | Uint8Array,
  config?: Partial<LiteParseConfig>,
): Promise<string> {
  const result = await parsePdf(pdfBytes, config);
  return result.text || result.pages.map((p) => p.markdown || p.text).join("\n\n");
}

/**
 * Parse a PDF and return per-page markdown with page numbers.
 *
 * Useful for contracts where page references matter for clause attribution.
 */
export async function parsePdfPerPage(
  pdfBytes: ArrayBuffer | Uint8Array,
  config?: Partial<LiteParseConfig>,
): Promise<Array<{ pageNum: number; markdown: string }>> {
  const result = await parsePdf(pdfBytes, config);
  return result.pages.map((p) => ({
    pageNum: p.pageNum,
    markdown: p.markdown || p.text,
  }));
}
