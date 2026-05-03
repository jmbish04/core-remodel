/**
 * @fileoverview Greenhouse Job Board API scraper.
 *
 * Provides a direct API-based fallback for scraping job postings hosted on
 * Greenhouse (job-boards.greenhouse.io or boards.greenhouse.io). This avoids
 * reliance on Browser Rendering for pages that are often JS-heavy and may
 * fail to render properly.
 *
 * Greenhouse's public Harvest API is free and requires no authentication:
 * https://developers.greenhouse.io/job-board.html
 */

import type { ScrapedPage } from "./browser-rendering";

// ---------------------------------------------------------------------------
// URL pattern matching
// ---------------------------------------------------------------------------

/**
 * Matches Greenhouse job board URLs and extracts the board token + job ID.
 *
 * Supported patterns:
 * - https://job-boards.greenhouse.io/{token}/jobs/{id}
 * - https://boards.greenhouse.io/{token}/jobs/{id}
 * - https://job-boards.greenhouse.io/embed/job_app?token={token}&id={id}  (embed variant)
 */
const GREENHOUSE_PATTERN =
  /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_app\?.*?(?:token=([^&]+).*?id=([^&]+)|id=([^&]+).*?token=([^&]+))|([^/]+)\/jobs\/(\d+))/i;

export function parseGreenhouseUrl(
  url: string,
): { boardToken: string; jobId: string } | null {
  const match = url.match(GREENHOUSE_PATTERN);
  if (!match) return null;

  // Direct URL pattern: /token/jobs/id
  if (match[5] && match[6]) {
    return { boardToken: match[5], jobId: match[6] };
  }

  // Embed pattern: token=...&id=... (either order)
  const token = match[1] || match[4];
  const id = match[2] || match[3];
  if (token && id) {
    return { boardToken: token, jobId: id };
  }

  return null;
}

/**
 * Returns true if the URL is a Greenhouse job board link.
 */
export function isGreenhouseUrl(url: string): boolean {
  return parseGreenhouseUrl(url) !== null;
}

// ---------------------------------------------------------------------------
// Greenhouse API response types
// ---------------------------------------------------------------------------

interface GreenhouseJobResponse {
  id: number;
  title: string;
  company_name?: string;
  absolute_url: string;
  content: string; // HTML content of the job posting
  updated_at: string;
  requisition_id?: string;
  location: { name: string };
  departments: Array<{ id: number; name: string }>;
  offices: Array<{ id: number; name: string; location?: string }>;
  metadata?: Array<{ id: number; name: string; value: unknown; value_type: string }>;
}

// ---------------------------------------------------------------------------
// Fetch via Greenhouse API
// ---------------------------------------------------------------------------

/**
 * Fetches a single job posting from the Greenhouse Harvest API and normalises
 * it into the same `ScrapedPage` shape used by Browser Rendering.
 *
 * The HTML `content` field is used as the source — it contains the full job
 * description, responsibilities, qualifications, and salary information.
 */
export async function scrapeGreenhouseJob(
  boardToken: string,
  jobId: string,
): Promise<ScrapedPage & { greenhouse: GreenhouseJobResponse }> {
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `Greenhouse API returned ${response.status} for ${boardToken}/jobs/${jobId}`,
    );
  }

  const job = (await response.json()) as GreenhouseJobResponse;

  // Decode HTML entities in the content field
  const html = decodeHtmlEntities(job.content || "");
  const text = stripHtml(html);

  // Prepend structured metadata that the AI extractor can use directly
  const enrichedText = [
    `Company: ${job.company_name ?? boardToken}`,
    `Job Title: ${job.title}`,
    `Location: ${job.location?.name ?? "Not specified"}`,
    job.departments?.length
      ? `Department: ${job.departments.map((d) => d.name).join(", ")}`
      : "",
    `Job URL: ${job.absolute_url}`,
    "",
    text,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    html,
    text: enrichedText,
    links: [{ href: job.absolute_url, text: job.title }],
    screenshotUrl: undefined,
    greenhouse: job,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode common HTML entities produced by the Greenhouse API. */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
}

/** Minimal HTML → plaintext strip. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
