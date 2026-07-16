import { getCloudflareImagesToken } from "../../utils/secrets";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ScrapedPage = {
  html: string;
  text: string;
  markdown?: string;
  links: Array<{ href: string; text?: string }>;
  /** Cloudflare Images delivery URL (replaces old R2 key). */
  screenshotUrl?: string;
  /** R2-served URL for the captured PDF of the job posting. */
  pdfUrl?: string;
};

export type JsonExtractionOptions<T = unknown> = {
  /** Natural-language instruction for the AI extractor. */
  prompt?: string;
  /** JSON Schema describing the desired output shape. */
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      schema?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    };
  };
};

// ---------------------------------------------------------------------------
// Helpers — Cloudflare API base URL
// ---------------------------------------------------------------------------

async function brBaseUrl(env: Env) {
  const accountId = await env.CLOUDFLARE_ACCOUNT_ID.get();
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
}

async function brHeaders(env: Env) {
  const token = await env.CF_BROWSER_RENDER_TOKEN.get();
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Screenshot upload → Cloudflare Images
// ---------------------------------------------------------------------------

/**
 * Uploads a base64-encoded screenshot to Cloudflare Images.
 * Returns the public delivery URL (the `/public` variant).
 */
async function uploadScreenshotToImages(
  env: Env,
  base64Data: string,
  metadata?: Record<string, string>,
): Promise<string> {
  const accountId = await env.CLOUDFLARE_ACCOUNT_ID.get();
  const imagesToken = await getCloudflareImagesToken(env);

  // Decode base64 → binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const formData = new FormData();
  formData.append("file", new File([bytes], "screenshot.png", { type: "image/png" }));
  if (metadata) {
    formData.append("metadata", JSON.stringify(metadata));
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${imagesToken}` },
      body: formData,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare Images upload failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    success: boolean;
    result: { id: string; variants: string[] };
  };

  // Return the /public variant URL
  return payload.result.variants.find((v) => v.endsWith("/public")) ?? payload.result.variants[0];
}

// ---------------------------------------------------------------------------
// /snapshot — HTML + screenshot in one request
// ---------------------------------------------------------------------------

/**
 * Scrapes a URL using the Browser Rendering `/snapshot` endpoint: rendered page
 * content + native Markdown + a screenshot in one request. The screenshot is
 * uploaded to Cloudflare Images for persistent storage.
 *
 * TWO API SHAPES THAT BIT US (both silently, for months):
 *  1. `/snapshot` returns the rendered HTML under `result.content` — `html` is the
 *     REQUEST field (render-this-HTML), not the response field. Reading `result.html`
 *     yielded "" for every page, so `text` was always "", so every consumer
 *     (showroom scrape, brand/product research, estimate intake) silently scraped a
 *     blank page while the screenshot kept working.
 *  2. `/snapshot` never returns a `links` array at all, so link discovery has to be
 *     parsed out of the HTML — see {@link extractLinksFromHtml}.
 *
 * `formats` (added 2026-06-11) lets us ask for Markdown rendered by the browser,
 * which preserves link targets and beats stripHtml(). At least two formats are
 * required by the API; we ask for all three we use.
 */
export async function scrapeUrl(env: Env, url: string): Promise<ScrapedPage> {
  const base = await brBaseUrl(env);
  const headers = await brHeaders(env);

  const response = await fetch(`${base}/snapshot`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url,
      formats: ["content", "screenshot", "markdown"],
      // THE actual fix. `waitUntil` defaults to `domcontentloaded`, which fires
      // BEFORE the load event and long before client-side JS renders — so we were
      // capturing the bare SPA shell: real nav <a href>s (which is why link
      // discovery worked) but ~150 chars of text (which is why every extraction
      // saw a blank page). Docs: "For pages that rely on JavaScript to render
      // content, use networkidle0 or networkidle2".
      //
      // networkidle2 (<=2 connections idle 500ms) over networkidle0 (zero): retail
      // sites keep analytics/chat/pixel sockets open that never fully idle, so
      // networkidle0 would burn the full timeout on exactly the sites we need.
      gotoOptions: { waitUntil: "networkidle2", timeout: GOTO_TIMEOUT_MS },
      // Full-page, not viewport-only. Never set before, so every stored
      // "fullpage" screenshot was actually just the fold.
      screenshotOptions: { fullPage: true },
      viewport: { width: 1280, height: 720 },
    }),
    // Must sit ABOVE Browser Run's own timers (goto <=60s, actionTimeout <=5min)
    // or we'd preempt them and turn a slow render into a hard failure.
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Browser Rendering snapshot failed: ${response.status} ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    success: boolean;
    result: {
      /** Rendered HTML. NOT `html` — that is the request-side field. */
      content?: string;
      /** Browser-rendered Markdown (formats: ["markdown"]). */
      markdown?: string;
      screenshot?: string; // base64-encoded PNG
      links?: Array<string | { href?: string; text?: string }>;
    };
  };

  const result = payload.result ?? payload;
  let screenshotUrl: string | undefined;

  // Upload screenshot to Cloudflare Images if present
  if (result.screenshot) {
    try {
      screenshotUrl = await uploadScreenshotToImages(env, result.screenshot, {
        source: "browser-rendering",
        url,
        capturedAt: new Date().toISOString(),
      });
    } catch {
      // Non-fatal — log and continue without screenshot
      console.error("Failed to upload screenshot to Cloudflare Images");
    }
  }

  const html = result.content ?? "";
  const markdown = result.markdown ?? "";

  // The diagnostic that lived here has been removed — it did its job. For the
  // record, what it proved against real sites (davincimarble.com):
  //   contentLen 137945, markdownLen 8462, hasScreenshot true,
  //   linksType "undefined", strippedLen 5243, extractedLinks 31
  // i.e. `result.content` + `result.markdown` are correct and `formats` works;
  // `/snapshot` genuinely never returns `links`, so extractLinksFromHtml is
  // required, not optional. The blank pages were gotoOptions/waitUntil, above.

  return {
    html,
    // MUST be undefined (never "") when absent. Every caller does
    // `scraped.markdown ?? scraped.text` and `??` does NOT fall through on an
    // empty string — returning "" silently discards the text fallback and hands
    // the extractor a blank page. That is exactly what shipped in #139: pages
    // written after the deploy still had ~811-char prompts ending in
    // "PAGE CONTENT:" with nothing after it.
    markdown: markdown || undefined,
    // Prefer the browser's Markdown; fall back to stripped HTML when the account's
    // Browser Rendering ignores/refuses the (recent) `formats` param.
    text: markdown || stripHtml(html),
    // `result.links` is currently never sent; keep honouring it if that ever changes.
    links: result.links ? normalizeLinks(result.links) : extractLinksFromHtml(html, url),
    screenshotUrl,
  };
}

/** Page-load budget handed to Browser Run. Docs cap goToOptions.timeout at 60s. */
const GOTO_TIMEOUT_MS = 45_000;

/**
 * Our own fetch bound. Deliberately ABOVE Browser Run's internal timers
 * (goto <=60s + action time) so the API gets to fail on its own terms with a
 * real error instead of us aborting mid-render.
 */
const SNAPSHOT_TIMEOUT_MS = 120_000;

/** `<a href="...">text</a>` — tolerant of attribute order and multi-line tags. */
const HREF_RE = /<a\b[^>]*?\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Canonicalize a URL for CRAWLING — the single dedupe key shared by every
 * crawler (showroom-scrape, brand-research, product-research).
 *
 * Returns null for anything not worth fetching: empty, fragment-only, and
 * non-http(s) schemes (data:/mailto:/tel:/javascript:).
 *
 * The trailing-slash collapse is the point. `/locations` and `/locations/` are the
 * same page on every real site, but they are DIFFERENT strings — so a `Set` keyed
 * on the raw URL happily keeps both and the crawler renders the page twice. Seen
 * live on rubensteinsupply.com: 10 discovered links contained `/locations` +
 * `/locations/` AND `/eventsnew` + `/eventsnew/`, i.e. 8 unique pages costing 10
 * full networkidle2 renders — and burning 2 of the 10 MAX_PAGES slots that should
 * have gone to brands/about pages.
 *
 * Root is preserved as "/" (collapsing it to "" would produce a different string
 * than the landing URL and reintroduce the duplicate it exists to prevent).
 */
export function normalizeCrawlUrl(raw: string, base?: string): string | null {
  const text = raw?.trim();
  if (!text || text.startsWith("#")) return null;

  const lower = text.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("javascript:")
  ) {
    return null;
  }

  try {
    const u = new URL(text, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extract absolute links from raw HTML, canonicalized via {@link normalizeCrawlUrl}
 * and de-duplicated. Needed because `/snapshot` returns no `links` array — without
 * this the crawler only ever sees the landing page.
 */
export function extractLinksFromHtml(html: string, baseUrl: string): ScrapedPage["links"] {
  if (!html) return [];

  const out: Array<{ href: string; text?: string }> = [];
  const seen = new Set<string>();

  HREF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_RE.exec(html)) !== null) {
    const href = normalizeCrawlUrl(match[1] ?? "", baseUrl);
    if (!href || seen.has(href)) continue;
    seen.add(href);

    const text = match[2]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ href, text: text || undefined });
  }

  return out;
}

// ---------------------------------------------------------------------------
// /pdf — Capture page as PDF
// ---------------------------------------------------------------------------

/**
 * Captures a URL as a PDF using the Browser Rendering `/pdf` endpoint.
 * Returns raw `ArrayBuffer` suitable for R2 upload.
 *
 * Uses `networkidle0` to ensure JS-heavy pages (like Greenhouse) finish
 * rendering before capture.
 */
export async function capturePdf(env: Env, url: string): Promise<ArrayBuffer> {
  const base = await brBaseUrl(env);
  const headers = await brHeaders(env);

  const response = await fetch(`${base}/pdf`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url,
      goToOptions: { waitUntil: "networkidle0" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Browser Rendering /pdf failed: ${response.status} ${await response.text()}`);
  }

  return response.arrayBuffer();
}

/**
 * Uploads a PDF buffer to R2 and returns the Worker-served URL.
 *
 * Key format: `job-postings/{roleId}.pdf`
 */
export async function uploadPdfToR2(
  env: Env,
  key: string,
  pdfBuffer: ArrayBuffer,
  metadata?: Record<string, string>,
): Promise<string> {
  await env.ARTIFACTS_BUCKET.put(key, pdfBuffer, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: metadata,
  });

  // Return a Worker-served URL — the /api/files route will read from R2
  return `/api/files/${key}`;
}

// ---------------------------------------------------------------------------
// /json — AI-powered structured extraction
// ---------------------------------------------------------------------------

/**
 * Extracts structured JSON data from a URL using Browser Rendering's `/json`
 * endpoint. This sends the page through Workers AI which extracts data
 * according to the provided `prompt` and/or `responseFormat` JSON schema.
 *
 * @example
 * ```ts
 * const data = await extractJson(env, "https://example.com/jobs/123", {
 *   prompt: "Extract the job title, company, salary, and requirements",
 *   responseFormat: {
 *     type: "json_schema",
 *     json_schema: {
 *       name: "job_posting",
 *       properties: {
 *         jobTitle: "string",
 *         companyName: "string",
 *         salary: "string",
 *         requirements: "array",
 *       },
 *     },
 *   },
 * });
 * ```
 */
export async function extractJson<T = unknown>(
  env: Env,
  url: string,
  options: JsonExtractionOptions<T>,
): Promise<T> {
  const base = await brBaseUrl(env);
  const headers = await brHeaders(env);

  const body: Record<string, unknown> = { url };

  if (options.prompt) {
    body.prompt = options.prompt;
  }
  if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  // At least one of prompt or response_format is required
  if (!options.prompt && !options.responseFormat) {
    throw new Error("extractJson requires at least a `prompt` or `responseFormat`");
  }

  const response = await fetch(`${base}/json`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Browser Rendering /json failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { success: boolean; result: T };
  return payload.result;
}

// ---------------------------------------------------------------------------
// /markdown — Clean markdown extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a page's content as clean Markdown using the Browser Rendering
 * `/markdown` endpoint. Useful for downstream LLM processing, embeddings,
 * or human-readable archival.
 */
export async function extractMarkdown(env: Env, url: string): Promise<string> {
  const base = await brBaseUrl(env);
  const headers = await brHeaders(env);

  const response = await fetch(`${base}/markdown`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error(
      `Browser Rendering /markdown failed: ${response.status} ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as { success: boolean; result: string };
  return payload.result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeLinks(
  links: Array<string | { href?: string; text?: string }> | undefined,
): ScrapedPage["links"] {
  if (!links) {
    return [];
  }

  return links
    .map((link) =>
      typeof link === "string" ? { href: link } : { href: link.href ?? "", text: link.text },
    )
    .filter((link) => link.href.length > 0);
}

/** Minimal HTML → plaintext strip for the `text` field. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
