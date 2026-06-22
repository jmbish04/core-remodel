import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  productImages,
  productSpecs,
  showroomImages,
  showroomStoreCategory,
  showroomStoreCategoryMapping,
  showroomStoreRatings,
  showroomStores,
  storeProductResearch,
  storeRating,
  storeResearch,
} from "@backend/db/schema/showroom/index";
import { extractJson, extractMarkdown } from "@backend/ai/tools/browser-rendering";
import { chunkMarkdown } from "@backend/ai/agents/ResearchAgent/methods/chunk-markdown";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";
import {
  createResearchMcpToolConfig,
  runDeepResearchForCitationPlan,
  type DeepResearchMcpScope,
} from "@backend/services/gemini/deep-research";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import {
  buildProductResearchPrompt,
  loadProductPromptContext,
} from "./prompt-context";
import type {
  BrowserSourceExtraction,
  DeepSweepCategoryInput,
  DeepSweepProductInput,
  DeepSweepStoreInput,
  ExtractedFinding,
  ExtractedImageCandidate,
  ExtractedSpec,
  ShowroomCitationPlan,
  ShowroomSweepResult,
  ShowroomSweepTargetType,
} from "../types";

type ProgressReporter = (message: string, progress?: number) => void;

const DEFAULT_MAX_SOURCES = 5;
const MAX_IMAGE_UPLOADS_PER_SOURCE = 4;
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;
const DEFAULT_DEEP_RESEARCH_WAIT_MS = 90_000;

function clampMaxSources(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_MAX_SOURCES;
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function clampDeepResearchWaitMs(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_DEEP_RESEARCH_WAIT_MS;
  return Math.max(15_000, Math.min(240_000, Math.trunc(value)));
}

function emptyResult(
  targetType: ShowroomSweepTargetType,
  targetId: number,
): ShowroomSweepResult {
  return {
    success: true,
    targetType,
    targetId,
    citationsFound: 0,
    sourcesProcessed: 0,
    findingsWritten: 0,
    imagesWritten: 0,
    specsWritten: 0,
    vectorsWritten: 0,
    warnings: [],
  };
}

function pushWarning(result: ShowroomSweepResult, message: string) {
  result.warnings.push(message);
}

function cleanupModelJson(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(cleanupModelJson(raw)) as T;
  } catch {
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (!objectMatch) return fallback;
    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {
      return fallback;
    }
  }
}

function addUniqueUrl(urls: string[], rawUrl: string | null | undefined, baseUrl?: string) {
  const text = rawUrl?.trim();
  if (!text || text.startsWith("data:")) return;
  try {
    const normalized = new URL(text, baseUrl).toString();
    if (!urls.includes(normalized)) urls.push(normalized);
  } catch {
    // Ignore malformed URLs from model/source extraction.
  }
}

function takeUniqueUrls(urls: string[], limit: number): string[] {
  const result: string[] = [];
  for (const url of urls) {
    addUniqueUrl(result, url);
    if (result.length >= limit) break;
  }
  return result;
}

function bulletList(values: string[]): string {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  if (clean.length === 0) return "- none";

  let output = "";
  for (const value of clean) {
    output = `${output}- ${value}
`;
  }
  return output.trimEnd();
}

function findingLines(findings: ExtractedFinding[] | undefined): string {
  if (!findings || findings.length === 0) return "- none";

  let output = "";
  for (const finding of findings) {
    output = `${output}- [${finding.sentiment ?? "neutral"}] ${finding.finding}
`;
  }
  return output.trimEnd();
}

function specLines(specs: ExtractedSpec[] | undefined): string {
  if (!specs || specs.length === 0) return "- none";

  let output = "";
  for (const spec of specs) {
    output = `${output}- ${spec.key}: ${spec.value}${spec.unit ? ` ${spec.unit}` : ""}
`;
  }
  return output.trimEnd();
}

function warrantyLines(notes: string[] | undefined): string {
  return bulletList(notes ?? []);
}

function normalizeSentiment(value: string | undefined): "good" | "bad" | "neutral" {
  if (value === "good" || value === "bad" || value === "neutral") return value;
  return "neutral";
}

function normalizeConfidence(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 70;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function sourceExtractionPrompt(targetLabel: string, sourceUrl: string): string {
  return `Extract structured sourcing evidence from this rendered page.

Target:
${targetLabel}

Source URL:
${sourceUrl}

Return concise JSON with:
- title
- description
- canonicalUrl
- openGraphImage
- images: high-resolution semantic product/storefront/showroom images with URL, altText, kind, width, height
- specs: key/value product specifications with unit and confidence
- findings: concise review, warranty, installation, compatibility, lead time, pricing, or sourcing findings
- ratings: source, rating, comment, ratingCreated when visible
- warrantyNotes
- reviewSummary
- summary

Prefer official product/manufacturer/store evidence, warranty documents, visible Open Graph metadata, and images that are useful to a homeowner comparing real products.`;
}

function citationDiscoveryPrompt(
  reviewedPrompt: string,
  fallbackUrls: string[],
  negativeConstraints: string[],
): string {
  return `You are a sourcing research planner for a home remodel system.

Reviewed research prompt:
${reviewedPrompt}

Known fallback URLs:
${bulletList(fallbackUrls)}

Negative constraints:
${bulletList(negativeConstraints)}

Find citation URLs that should be rendered and extracted for source-backed product/showroom research. Prioritize official manufacturer pages, store product pages, warranty or installation documents, review pages, and high-resolution image pages.

Return JSON only in this shape:
{
  "citationUrls": ["https://example.com/source"],
  "searchQueries": ["query text"],
  "researchIntent": "short reason"
}`;
}

async function discoverCitationPlan(
  env: Env,
  reviewedPrompt: string,
  fallbackUrls: string[],
  negativeConstraints: string[],
  maxSources: number,
  options: {
    researchMode?: "quick" | "deep";
    deepResearchWaitMs?: number;
    enableMcpBridge?: boolean;
    mcpServerUrl?: string | null;
    mcpScope?: DeepResearchMcpScope;
  } = {},
): Promise<ShowroomCitationPlan> {
  if (options.researchMode === "deep") {
    const tools: Array<Record<string, unknown>> = [
      { type: "google_search" },
      { type: "url_context" },
      { type: "code_execution" },
    ];

    if (options.enableMcpBridge && options.mcpScope) {
      const mcpTool = await createResearchMcpToolConfig(env, {
        serverUrl: options.mcpServerUrl,
        scope: options.mcpScope,
      });
      if (mcpTool) tools.push(mcpTool as unknown as Record<string, unknown>);
    }

    try {
      const deepResearch = await runDeepResearchForCitationPlan(
        env,
        `Run Deep Research for a remodel sourcing sweep.

Research target prompt:
${reviewedPrompt}

Known fallback URLs:
${bulletList(fallbackUrls)}

Negative constraints:
${bulletList(negativeConstraints)}

Return a cited Markdown report. Prioritize official source URLs, high-resolution product or storefront image pages, warranty pages, installation documents, source-backed reviews, and pricing or lead-time evidence.`,
        {
          mode: "standard",
          tools,
          maxWaitMs: clampDeepResearchWaitMs(options.deepResearchWaitMs),
        },
      );

      const urls = takeUniqueUrls(
        [...deepResearch.citationUrls, ...fallbackUrls],
        maxSources,
      );

      if (urls.length > 0) {
        return {
          citationUrls: urls,
          searchQueries: [],
          researchIntent: deepResearch.reportMarkdown.slice(0, 1200),
        };
      }
    } catch (error) {
      console.warn("Deep Research citation discovery fell back to quick planner:", error);
    }
  }

  const ai = await createGeminiAiGatewayClient(env);
  const response = (await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: citationDiscoveryPrompt(
              reviewedPrompt,
              fallbackUrls,
              negativeConstraints,
            ),
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  } as any)) as { text?: string };

  const parsed = safeParseJson<ShowroomCitationPlan>(response.text ?? "", {
    citationUrls: [],
    searchQueries: [],
    researchIntent: "No valid Gemini citation plan returned.",
  });

  const urls = takeUniqueUrls(
    [...(parsed.citationUrls ?? []), ...fallbackUrls],
    maxSources,
  );

  return {
    citationUrls: urls,
    searchQueries: parsed.searchQueries ?? [],
    researchIntent: parsed.researchIntent ?? "Sourcing sweep",
  };
}

async function extractSource(
  env: Env,
  url: string,
  targetLabel: string,
): Promise<{ extraction: BrowserSourceExtraction; markdown: string }> {
  const extraction = await extractJson<BrowserSourceExtraction>(env, url, {
    prompt: sourceExtractionPrompt(targetLabel, url),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "showroom_source_extraction",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            canonicalUrl: { type: "string" },
            openGraphImage: { type: "string" },
            images: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  altText: { type: "string" },
                  kind: { type: "string" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
              },
            },
            specs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                  unit: { type: "string" },
                  confidence: { type: "number" },
                },
              },
            },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  finding: { type: "string" },
                  sentiment: { type: "string" },
                },
              },
            },
            ratings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  source: { type: "string" },
                  rating: { type: "number" },
                  comment: { type: "string" },
                  ratingCreated: { type: "string" },
                },
              },
            },
            warrantyNotes: { type: "array", items: { type: "string" } },
            reviewSummary: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
    },
  });

  let markdown = "";
  try {
    markdown = await extractMarkdown(env, url);
  } catch {
    markdown = extraction.summary ?? extraction.description ?? "";
  }

  return { extraction, markdown };
}

async function createImageProcessor(env: Env): Promise<ImageProcessorService> {
  const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(env);
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  const [primaryToken, ...fallbackApiTokens] = apiTokens;
  if (!primaryToken) throw new Error("Cloudflare Images token is not configured");
  return new ImageProcessorService(env, accountId, primaryToken, { fallbackApiTokens });
}

function collectImageCandidates(
  extraction: BrowserSourceExtraction,
  sourceUrl: string,
): ExtractedImageCandidate[] {
  const urls: string[] = [];
  const candidates: ExtractedImageCandidate[] = [];

  for (const image of extraction.images ?? []) {
    const before = urls.length;
    addUniqueUrl(urls, image.url, sourceUrl);
    if (urls.length > before) {
      candidates.push({ ...image, url: urls[urls.length - 1] });
    }
  }

  const beforeOg = urls.length;
  addUniqueUrl(urls, extraction.openGraphImage, sourceUrl);
  if (urls.length > beforeOg) {
    candidates.push({
      url: urls[urls.length - 1],
      altText: extraction.title ?? "Open Graph image",
      kind: "unknown",
    });
  }

  return candidates.slice(0, MAX_IMAGE_UPLOADS_PER_SOURCE);
}

async function fetchImageBlob(
  imageUrl: string,
): Promise<{ blob: Blob; mimeType: string }> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image fetch failed ${response.status}`);
  }
  const mimeType = response.headers.get("content-type") || "image/jpeg";
  if (!mimeType.toLowerCase().startsWith("image/")) {
    throw new Error(`Unsupported image content type ${mimeType}`);
  }
  return { blob: await response.blob(), mimeType };
}

function filenameForImage(url: string, mimeType: string): string {
  const extension = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
  } catch {
    // Fall through to generated name.
  }
  return `showroom-source.${extension}`;
}

async function upsertProductImage(
  env: Env,
  productId: number,
  sourcePageUrl: string,
  candidate: ExtractedImageCandidate,
  extraction: BrowserSourceExtraction,
  processor: ImageProcessorService,
): Promise<boolean> {
  const db = drizzle(env.DB);
  const { blob, mimeType } = await fetchImageBlob(candidate.url);
  const upload = await processor.uploadToCloudflareImages(
    blob,
    undefined,
    filenameForImage(candidate.url, mimeType),
  );
  const deliveryUrl = processor.getDeliveryUrl(upload, upload.result.id);
  const imageKind =
    candidate.kind === "lifestyle" ||
    candidate.kind === "spec" ||
    candidate.kind === "packaging" ||
    candidate.kind === "product"
      ? candidate.kind
      : "unknown";

  await db
    .insert(productImages)
    .values({
      storeProductId: productId,
      sourceUrl: candidate.url,
      sourcePageUrl,
      cfImageId: upload.result.id,
      deliveryUrl,
      altText: candidate.altText ?? null,
      imageKind,
      width: candidate.width ? Math.trunc(candidate.width) : null,
      height: candidate.height ? Math.trunc(candidate.height) : null,
      mimeType,
      ogTitle: extraction.title ?? null,
      ogDescription: extraction.description ?? null,
      metadataJson: JSON.stringify({ source: "showroom-deep-sweep" }),
    })
    .onConflictDoUpdate({
      target: [productImages.storeProductId, productImages.sourceUrl],
      set: {
        sourcePageUrl,
        cfImageId: upload.result.id,
        deliveryUrl,
        altText: candidate.altText ?? null,
        imageKind,
        width: candidate.width ? Math.trunc(candidate.width) : null,
        height: candidate.height ? Math.trunc(candidate.height) : null,
        mimeType,
        ogTitle: extraction.title ?? null,
        ogDescription: extraction.description ?? null,
        metadataJson: JSON.stringify({ source: "showroom-deep-sweep" }),
        updatedAt: new Date(),
      },
    });

  return true;
}

async function upsertShowroomImage(
  env: Env,
  storeId: number,
  sourcePageUrl: string,
  candidate: ExtractedImageCandidate,
  extraction: BrowserSourceExtraction,
  processor: ImageProcessorService,
): Promise<boolean> {
  const db = drizzle(env.DB);
  const { blob, mimeType } = await fetchImageBlob(candidate.url);
  const upload = await processor.uploadToCloudflareImages(
    blob,
    undefined,
    filenameForImage(candidate.url, mimeType),
  );
  const deliveryUrl = processor.getDeliveryUrl(upload, upload.result.id);
  const imageKind =
    candidate.kind === "storefront" ||
    candidate.kind === "showroom" ||
    candidate.kind === "logo" ||
    candidate.kind === "map"
      ? candidate.kind
      : "unknown";

  await db
    .insert(showroomImages)
    .values({
      storeId,
      sourceUrl: candidate.url,
      sourcePageUrl,
      cfImageId: upload.result.id,
      deliveryUrl,
      altText: candidate.altText ?? null,
      imageKind,
      width: candidate.width ? Math.trunc(candidate.width) : null,
      height: candidate.height ? Math.trunc(candidate.height) : null,
      mimeType,
      ogTitle: extraction.title ?? null,
      ogDescription: extraction.description ?? null,
      metadataJson: JSON.stringify({ source: "showroom-deep-sweep" }),
    })
    .onConflictDoUpdate({
      target: [showroomImages.storeId, showroomImages.sourceUrl],
      set: {
        sourcePageUrl,
        cfImageId: upload.result.id,
        deliveryUrl,
        altText: candidate.altText ?? null,
        imageKind,
        width: candidate.width ? Math.trunc(candidate.width) : null,
        height: candidate.height ? Math.trunc(candidate.height) : null,
        mimeType,
        ogTitle: extraction.title ?? null,
        ogDescription: extraction.description ?? null,
        metadataJson: JSON.stringify({ source: "showroom-deep-sweep" }),
        updatedAt: new Date(),
      },
    });

  return true;
}

async function upsertSpecs(
  env: Env,
  productId: number,
  specs: ExtractedSpec[] | undefined,
  sourceUrl: string,
): Promise<number> {
  if (!specs || specs.length === 0) return 0;

  const db = drizzle(env.DB);
  let written = 0;
  for (const spec of specs) {
    const key = spec.key?.trim();
    const value = spec.value?.trim();
    if (!key || !value) continue;

    await db
      .insert(productSpecs)
      .values({
        storeProductId: productId,
        specKey: key,
        specValue: value,
        unit: spec.unit ?? null,
        sourceUrl,
        confidence: normalizeConfidence(spec.confidence),
        metadataJson: JSON.stringify({ source: "showroom-deep-sweep" }),
      })
      .onConflictDoUpdate({
        target: [
          productSpecs.storeProductId,
          productSpecs.specKey,
          productSpecs.sourceUrl,
        ],
        set: {
          specValue: value,
          unit: spec.unit ?? null,
          confidence: normalizeConfidence(spec.confidence),
          metadataJson: JSON.stringify({ source: "showroom-deep-sweep" }),
          updatedAt: new Date(),
        },
      });
    written += 1;
  }
  return written;
}

async function insertProductFindings(
  env: Env,
  productId: number,
  findings: ExtractedFinding[] | undefined,
  sourceUrl: string,
): Promise<number> {
  if (!findings || findings.length === 0) return 0;

  const db = drizzle(env.DB);
  let written = 0;
  for (const finding of findings) {
    const text = finding.finding?.trim();
    if (!text) continue;
    const [existing] = await db
      .select({ id: storeProductResearch.id })
      .from(storeProductResearch)
      .where(
        and(
          eq(storeProductResearch.storeProductId, productId),
          eq(storeProductResearch.finding, text),
          eq(storeProductResearch.findingUrl, sourceUrl),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(storeProductResearch).values({
      storeProductId: productId,
      finding: text,
      findingUrl: sourceUrl,
      sentiment: normalizeSentiment(finding.sentiment),
    });
    written += 1;
  }
  return written;
}

async function insertStoreFindings(
  env: Env,
  storeId: number,
  findings: ExtractedFinding[] | undefined,
  sourceUrl: string,
): Promise<number> {
  if (!findings || findings.length === 0) return 0;

  const db = drizzle(env.DB);
  let written = 0;
  for (const finding of findings) {
    const text = finding.finding?.trim();
    if (!text) continue;
    const [existing] = await db
      .select({ id: storeResearch.id })
      .from(storeResearch)
      .where(
        and(
          eq(storeResearch.storeId, storeId),
          eq(storeResearch.finding, text),
          eq(storeResearch.findingUrl, sourceUrl),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(storeResearch).values({
      storeId,
      finding: text,
      findingUrl: sourceUrl,
      sentiment: normalizeSentiment(finding.sentiment),
    });
    written += 1;
  }
  return written;
}

async function insertStoreRatings(
  env: Env,
  storeId: number,
  extraction: BrowserSourceExtraction,
): Promise<number> {
  if (!extraction.ratings || extraction.ratings.length === 0) return 0;

  const db = drizzle(env.DB);
  let written = 0;
  for (const rating of extraction.ratings) {
    const source = rating.source?.trim();
    const normalizedRating = Math.max(1, Math.min(5, Math.round(rating.rating)));
    if (!source || !Number.isFinite(normalizedRating)) continue;

    const [existing] = await db
      .select({ id: showroomStoreRatings.id })
      .from(showroomStoreRatings)
      .where(
        and(
          eq(showroomStoreRatings.storeId, storeId),
          eq(showroomStoreRatings.source, source),
          eq(showroomStoreRatings.comment, rating.comment ?? ""),
        ),
      )
      .limit(1);
    if (existing) continue;

    await db.insert(showroomStoreRatings).values({
      storeId,
      source,
      rating: normalizedRating,
      comment: rating.comment ?? null,
      ratingCreated: rating.ratingCreated ?? null,
    });
    written += 1;
  }
  return written;
}

function synthesisText(
  sourceUrl: string,
  extraction: BrowserSourceExtraction,
  markdown: string,
): string {
  const markdownPreview =
    markdown.length > 4000
      ? `${markdown.slice(0, 4000)}

[source markdown truncated]`
      : markdown;

  return `Source URL: ${sourceUrl}
Title: ${extraction.title ?? "unknown"}
Description: ${extraction.description ?? "none"}
Summary: ${extraction.summary ?? "none"}
Review summary: ${extraction.reviewSummary ?? "none"}

Findings:
${findingLines(extraction.findings)}

Specifications:
${specLines(extraction.specs)}

Warranty notes:
${warrantyLines(extraction.warrantyNotes)}

Rendered markdown excerpt:
${markdownPreview}`;
}

async function stableHash(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes.slice(0, 8)) {
    hex = `${hex}${byte.toString(16).padStart(2, "0")}`;
  }
  return hex;
}

async function embedSourceText(
  env: Env,
  params: {
    namespace: string;
    targetType: ShowroomSweepTargetType;
    targetId: number;
    productId?: number;
    storeId?: number;
    categoryId?: number;
    sourceUrl: string;
    text: string;
  },
): Promise<number> {
  const { chunks } = chunkMarkdown(params.text);
  if (chunks.length === 0) return 0;

  const hash = await stableHash(params.sourceUrl);
  let written = 0;
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const embeddingResult = (await env.AI.run(
      EMBED_MODEL,
      { text: batch },
      { gateway: { id: env.AI_GATEWAY_ID } },
    )) as { data: number[][] };

    const vectors = embeddingResult.data.map((values, offset) => {
      const chunkIndex = i + offset;
      const metadata: Record<string, string | number | boolean> = {
        namespace: params.namespace,
        targetType: params.targetType,
        targetId: params.targetId,
        sourceUrl: params.sourceUrl,
        chunkIndex,
        textPreview: batch[offset].slice(0, 240),
      };
      if (params.productId !== undefined) metadata.productId = params.productId;
      if (params.storeId !== undefined) metadata.storeId = params.storeId;
      if (params.categoryId !== undefined) metadata.categoryId = params.categoryId;

      return {
        id: `${params.namespace}:${hash}:${chunkIndex}`,
        values,
        namespace: params.namespace,
        metadata,
      };
    });
    await env.RESEARCH_INDEX.upsert(vectors);
    written += vectors.length;
  }
  return written;
}

async function processProductSource(
  env: Env,
  productId: number,
  sourceUrl: string,
  targetLabel: string,
  processor: ImageProcessorService,
  result: ShowroomSweepResult,
) {
  const { extraction, markdown } = await extractSource(env, sourceUrl, targetLabel);
  result.findingsWritten += await insertProductFindings(
    env,
    productId,
    extraction.findings,
    sourceUrl,
  );
  result.specsWritten += await upsertSpecs(env, productId, extraction.specs, sourceUrl);

  for (const candidate of collectImageCandidates(extraction, sourceUrl)) {
    try {
      if (
        await upsertProductImage(
          env,
          productId,
          sourceUrl,
          candidate,
          extraction,
          processor,
        )
      ) {
        result.imagesWritten += 1;
      }
    } catch (error) {
      pushWarning(
        result,
        `Image skipped for product ${productId} from ${candidate.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  result.vectorsWritten += await embedSourceText(env, {
    namespace: `showroom:product:${productId}`,
    targetType: "product",
    targetId: productId,
    productId,
    sourceUrl,
    text: synthesisText(sourceUrl, extraction, markdown),
  });
}

async function processStoreSource(
  env: Env,
  storeId: number,
  sourceUrl: string,
  targetLabel: string,
  processor: ImageProcessorService,
  result: ShowroomSweepResult,
) {
  const { extraction, markdown } = await extractSource(env, sourceUrl, targetLabel);
  result.findingsWritten += await insertStoreFindings(
    env,
    storeId,
    extraction.findings,
    sourceUrl,
  );
  result.findingsWritten += await insertStoreRatings(env, storeId, extraction);

  for (const candidate of collectImageCandidates(extraction, sourceUrl)) {
    try {
      if (
        await upsertShowroomImage(
          env,
          storeId,
          sourceUrl,
          candidate,
          extraction,
          processor,
        )
      ) {
        result.imagesWritten += 1;
      }
    } catch (error) {
      pushWarning(
        result,
        `Image skipped for store ${storeId} from ${candidate.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  result.vectorsWritten += await embedSourceText(env, {
    namespace: `showroom:store:${storeId}`,
    targetType: "store",
    targetId: storeId,
    storeId,
    sourceUrl,
    text: synthesisText(sourceUrl, extraction, markdown),
  });
}

export async function deepSweepProduct(
  env: Env,
  input: DeepSweepProductInput,
  progress?: ProgressReporter,
): Promise<ShowroomSweepResult> {
  const result = emptyResult("product", input.productId);
  const maxSources = clampMaxSources(input.maxSources);
  const context = await loadProductPromptContext(
    env,
    input.productId,
    input.negativeConstraints ?? [],
  );
  const prompt = input.prompt?.trim() || buildProductResearchPrompt(context);
  const fallbackUrls = context.store?.websiteUrl ? [context.store.websiteUrl] : [];
  progress?.("Discovering product citation URLs", 10);

  const plan = await discoverCitationPlan(
    env,
    prompt,
    fallbackUrls,
    context.negativeConstraints,
    maxSources,
    {
      researchMode: input.researchMode,
      deepResearchWaitMs: input.deepResearchWaitMs,
      enableMcpBridge: input.enableMcpBridge,
      mcpServerUrl: input.mcpServerUrl,
      mcpScope: {
        type: "product",
        id: input.productId,
        productId: input.productId,
        storeId: context.store?.id,
      },
    },
  );
  result.citationsFound = plan.citationUrls.length;

  const processor = await createImageProcessor(env);
  const targetLabel = `Product ${context.product.itemName} at ${context.store?.name ?? "unknown store"}`;

  let index = 0;
  for (const sourceUrl of plan.citationUrls) {
    index += 1;
    progress?.(`Processing product source ${index}/${plan.citationUrls.length}`, 20 + index * 10);
    try {
      await processProductSource(
        env,
        input.productId,
        sourceUrl,
        targetLabel,
        processor,
        result,
      );
      result.sourcesProcessed += 1;
    } catch (error) {
      pushWarning(
        result,
        `Source skipped for product ${input.productId} (${sourceUrl}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  progress?.("Product deep sweep complete", 100);
  return result;
}

export async function deepSweepStore(
  env: Env,
  input: DeepSweepStoreInput,
  progress?: ProgressReporter,
): Promise<ShowroomSweepResult> {
  const result = emptyResult("store", input.storeId);
  const db = drizzle(env.DB);
  const [store] = await db
    .select()
    .from(showroomStores)
    .where(eq(showroomStores.id, input.storeId))
    .limit(1);
  if (!store) throw new Error(`Showroom store ${input.storeId} not found`);

  const prompt =
    input.prompt?.trim() ||
    `Research this showroom/store for a high-end San Francisco remodel.

Store: ${store.name}
Website: ${store.websiteUrl ?? "none"}
Address: ${store.locationAddress ?? "none"}
Description: ${store.description ?? "none"}
Inventory focus: ${store.inventoryFocus ?? "none"}
Target demographic: ${store.targetDemographic ?? "none"}

Find citation URLs for reputation, product quality, customer experience, storefront/showroom images, warranty/service policies, and location-specific visit planning.

Negative constraints:
${bulletList(input.negativeConstraints ?? [])}`;

  progress?.("Discovering store citation URLs", 10);
  const plan = await discoverCitationPlan(
    env,
    prompt,
    store.websiteUrl ? [store.websiteUrl] : [],
    input.negativeConstraints ?? [],
    clampMaxSources(input.maxSources),
    {
      researchMode: input.researchMode,
      deepResearchWaitMs: input.deepResearchWaitMs,
      enableMcpBridge: input.enableMcpBridge,
      mcpServerUrl: input.mcpServerUrl,
      mcpScope: {
        type: "store",
        id: input.storeId,
        storeId: input.storeId,
      },
    },
  );
  result.citationsFound = plan.citationUrls.length;

  const processor = await createImageProcessor(env);
  const targetLabel = `Showroom store ${store.name}`;

  let index = 0;
  for (const sourceUrl of plan.citationUrls) {
    index += 1;
    progress?.(`Processing store source ${index}/${plan.citationUrls.length}`, 20 + index * 10);
    try {
      await processStoreSource(
        env,
        input.storeId,
        sourceUrl,
        targetLabel,
        processor,
        result,
      );
      result.sourcesProcessed += 1;
    } catch (error) {
      pushWarning(
        result,
        `Source skipped for store ${input.storeId} (${sourceUrl}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  progress?.("Store deep sweep complete", 100);
  return result;
}

export async function deepSweepCategory(
  env: Env,
  input: DeepSweepCategoryInput,
  progress?: ProgressReporter,
): Promise<ShowroomSweepResult> {
  const result = emptyResult("category", input.categoryId);
  const db = drizzle(env.DB);
  const [category] = await db
    .select()
    .from(showroomStoreCategory)
    .where(eq(showroomStoreCategory.id, input.categoryId))
    .limit(1);
  if (!category) throw new Error(`Showroom category ${input.categoryId} not found`);

  const mappedStores = await db
    .select({
      storeId: showroomStores.id,
      name: showroomStores.name,
      websiteUrl: showroomStores.websiteUrl,
      rating: storeRating.rating,
      ratingNotes: storeRating.ratingNotes,
    })
    .from(showroomStoreCategoryMapping)
    .innerJoin(
      showroomStores,
      eq(showroomStoreCategoryMapping.storeId, showroomStores.id),
    )
    .leftJoin(
      storeRating,
      and(
        eq(storeRating.storeId, showroomStores.id),
        eq(storeRating.isActive, true),
      ),
    )
    .where(eq(showroomStoreCategoryMapping.categoryId, input.categoryId))
    .orderBy(desc(showroomStores.createdAt));

  const fallbackUrls: string[] = [];
  const storeContext: string[] = [];
  const rejectionConstraints = [...(input.negativeConstraints ?? [])];
  for (const row of mappedStores) {
    if (row.websiteUrl) fallbackUrls.push(row.websiteUrl);
    storeContext.push(`${row.name} (${row.websiteUrl ?? "no website"}) rating=${row.rating ?? "none"} notes=${row.ratingNotes ?? "none"}`);
    if ((row.rating ?? 5) <= 1 && row.ratingNotes?.trim()) {
      rejectionConstraints.push(row.ratingNotes.trim());
    }
  }

  const prompt =
    input.prompt?.trim() ||
    `Research stronger showroom/vendor candidates for this under-covered sourcing category.

Category: ${category.name}
Description: ${category.description ?? "none"}

Existing mapped stores:
${bulletList(storeContext)}

Negative constraints from homeowner rejection reasons:
${bulletList(rejectionConstraints)}

Find citation URLs for Bay Area or shippable vendors that could satisfy this category without repeating rejected traits. Prioritize official vendor pages, showroom pages, product-line pages, reviews, and high-resolution storefront/product evidence.`;

  progress?.("Discovering category citation URLs", 10);
  const plan = await discoverCitationPlan(
    env,
    prompt,
    fallbackUrls,
    rejectionConstraints,
    clampMaxSources(input.maxSources),
    {
      researchMode: input.researchMode,
      deepResearchWaitMs: input.deepResearchWaitMs,
      enableMcpBridge: input.enableMcpBridge,
      mcpServerUrl: input.mcpServerUrl,
      mcpScope: {
        type: "category",
        id: input.categoryId,
        categoryId: input.categoryId,
      },
    },
  );
  result.citationsFound = plan.citationUrls.length;

  let index = 0;
  for (const sourceUrl of plan.citationUrls) {
    index += 1;
    progress?.(`Processing category source ${index}/${plan.citationUrls.length}`, 20 + index * 10);
    try {
      const { extraction, markdown } = await extractSource(
        env,
        sourceUrl,
        `Showroom category ${category.name}`,
      );
      result.vectorsWritten += await embedSourceText(env, {
        namespace: `showroom:category:${input.categoryId}`,
        targetType: "category",
        targetId: input.categoryId,
        categoryId: input.categoryId,
        sourceUrl,
        text: synthesisText(sourceUrl, extraction, markdown),
      });
      result.sourcesProcessed += 1;
    } catch (error) {
      pushWarning(
        result,
        `Source skipped for category ${input.categoryId} (${sourceUrl}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(showroomStoreCategoryMapping)
    .where(eq(showroomStoreCategoryMapping.categoryId, input.categoryId));
  if (Number(count ?? 0) <= 1) {
    pushWarning(result, `Category has weak showroom coverage: ${Number(count ?? 0)} mapped showroom(s).`);
  }

  progress?.("Category deep sweep complete", 100);
  return result;
}
