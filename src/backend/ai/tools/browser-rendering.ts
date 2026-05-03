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
  return (
    payload.result.variants.find((v) => v.endsWith("/public")) ?? payload.result.variants[0]
  );
}

// ---------------------------------------------------------------------------
// /snapshot — HTML + screenshot in one request
// ---------------------------------------------------------------------------

/**
 * Scrapes a URL using the Browser Rendering `/snapshot` endpoint.
 * This captures rendered HTML and a base64 screenshot simultaneously.
 * The screenshot is uploaded to Cloudflare Images for persistent storage.
 */
export async function scrapeUrl(env: Env, url: string): Promise<ScrapedPage> {
  const base = await brBaseUrl(env);
  const headers = await brHeaders(env);

  const response = await fetch(`${base}/snapshot`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error(
      `Browser Rendering snapshot failed: ${response.status} ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    success: boolean;
    result: {
      html?: string;
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

  return {
    html: result.html ?? "",
    text: stripHtml(result.html ?? ""),
    links: normalizeLinks(result.links),
    screenshotUrl,
  };
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
    throw new Error(
      `Browser Rendering /pdf failed: ${response.status} ${await response.text()}`,
    );
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
  await env.R2_FILES_BUCKET.put(key, pdfBuffer, {
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
    throw new Error(
      `Browser Rendering /json failed: ${response.status} ${await response.text()}`,
    );
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
