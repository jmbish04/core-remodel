/**
 * materials-helpers.ts — pure, framework-light helpers shared by the Supporting
 * Materials table, its filename preview modal, and the upload dialog.
 *
 * Kept side-effect-free (no React, no fetch) so every materials-* file can
 * import freely. The one DOM touch — `documentSourceTypeBadge` returning a
 * Badge variant — is a plain string, not a component.
 */

/**
 * How a supporting document should be previewed inline, derived from its
 * source type / mime / URL shape:
 *   - "image"       → inline <img>
 *   - "pdf"         → <object>/<embed>
 *   - "google"      → <iframe> (Google Drive / Docs / Sheets / Slides)
 *   - "iframe"      → <iframe> for other embeddable external URLs
 *   - "none"        → not previewable inline (offer "Open in new tab" only)
 */
export type PreviewKind = "image" | "pdf" | "google" | "iframe" | "none";

/** The minimal document shape the materials UI reasons about. */
export interface MaterialsDocument {
  id: string;
  title: string;
  sourceType: string;
  mimeType?: string | null;
  r2Url?: string | null;
  externalUrl?: string | null;
  description?: string | null;
  aiRationale?: string | null;
  datetimeUpdated?: string | number | Date | null;
  datetimeCreated?: string | number | Date | null;
  roomLabels?: string[];
  visionNodeTitles?: string[];
}

/** Returns the best URL to open/preview a document (R2 first, then external). */
export function documentHref(doc: Pick<MaterialsDocument, "r2Url" | "externalUrl">): string | null {
  return doc.r2Url || doc.externalUrl || null;
}

/** True when a URL points at a Google Drive / Docs / Sheets / Slides surface. */
function isGoogleUrl(url: string): boolean {
  return /(?:drive|docs|sheets|slides)\.google\.com/i.test(url);
}

/**
 * Rewrites a Google Drive/Docs share URL into its embeddable `/preview` form so
 * it renders cleanly inside an <iframe>. Falls back to the original URL when no
 * known pattern matches.
 */
export function toGoogleEmbedUrl(url: string): string {
  // Drive file: .../file/d/<id>/view → .../file/d/<id>/preview
  const driveFile = url.match(/\/file\/d\/([^/]+)/);
  if (driveFile) {
    return `https://drive.google.com/file/d/${driveFile[1]}/preview`;
  }
  // Docs/Sheets/Slides: .../document/d/<id>/edit → .../document/d/<id>/preview
  const docs = url.match(/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docs) {
    const segment = docs[1];
    const id = docs[2];
    return `https://docs.google.com/${segment}/d/${id}/preview`;
  }
  return url;
}

/**
 * Decides how to render a document inline. Order of precedence:
 *   1. explicit image/pdf source type
 *   2. mime type (image/*, application/pdf)
 *   3. URL extension / host (google, .pdf, image extensions)
 *   4. http(s) external URL → generic iframe
 *   5. otherwise not previewable
 */
export function resolvePreviewKind(doc: MaterialsDocument): PreviewKind {
  const sourceType = (doc.sourceType || "").toLowerCase();
  const mime = (doc.mimeType || "").toLowerCase();
  const url = documentHref(doc);

  if (sourceType === "image" || mime.startsWith("image/")) return "image";
  if (sourceType === "pdf" || mime === "application/pdf") return "pdf";

  if (url) {
    if (isGoogleUrl(url)) return "google";
    const lower = url.toLowerCase();
    if (/\.pdf(?:[?#]|$)/.test(lower)) return "pdf";
    if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)(?:[?#]|$)/.test(lower)) return "image";
    if (lower.startsWith("http://") || lower.startsWith("https://")) return "iframe";
  }

  return "none";
}

/**
 * Maps a document source type to a Monolith `Badge` variant. We keep the palette
 * semantic (theme variants, not raw hex) so badges read correctly in dark mode.
 * The string return value is fed straight into `<Badge variant={...}>`.
 */
export function documentSourceTypeBadge(
  sourceType: string,
): "default" | "secondary" | "destructive" | "outline" | "ghost" {
  switch ((sourceType || "").toLowerCase()) {
    case "pdf":
      return "destructive"; // pdf reads as a distinct, "document of record" accent
    case "image":
    case "screenshot":
      return "secondary";
    case "url":
      return "outline";
    case "video":
      return "default";
    case "text":
      return "ghost";
    default:
      return "outline";
  }
}

/** Human label for a source type (capitalized; "google-drive" handled). */
export function documentSourceTypeLabel(doc: MaterialsDocument): string {
  const url = documentHref(doc);
  if (url && isGoogleUrl(url)) {
    if (/docs\.google\.com\/document/i.test(url)) return "Google Doc";
    if (/sheets|spreadsheets/i.test(url)) return "Google Sheet";
    if (/slides|presentation/i.test(url)) return "Google Slides";
    return "Google Drive";
  }
  const sourceType = (doc.sourceType || "other").toLowerCase();
  return sourceType.charAt(0).toUpperCase() + sourceType.slice(1);
}

/**
 * Maps a browser File MIME type to the backend's `sourceType` enum
 * (pdf | image | video | text | other). Mirrors `sourceTypeFromMime` on the
 * server so the read-only "file type" field in the intake form matches what the
 * upload endpoint will persist.
 */
export function sourceTypeFromMime(mimeType: string | null | undefined): string {
  if (!mimeType) return "other";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
}

/** Strips the extension from a filename to seed the "document name" field. */
export function titleFromFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "Untitled document";
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 ? trimmed.slice(0, dot).trim() || trimmed : trimmed;
}

/**
 * Wraps a raw error message in a copy-pasteable "ask an AI coding agent to fix
 * this" prompt. This is what the per-file error block's copy button puts on the
 * clipboard, so the founder can paste it straight into a coding agent.
 */
export function buildAiFixPrompt(params: {
  fileName: string;
  message: string;
  endpoint: string;
}): string {
  return [
    "AI coding agent: please fix / troubleshoot this upload failure in the",
    "core-remodel Cloudflare Worker app.",
    "",
    `Endpoint: ${params.endpoint}`,
    `File: ${params.fileName}`,
    `Error: ${params.message}`,
    "",
    "Context: this is a supporting-document upload (multipart/form-data) posted",
    "from the room viewport's Supporting Materials section. The request sends a",
    "`file`, `title`, `sourceType`, `description`, and one or more `roomIds`.",
    "Identify the likely cause (validation, R2 binding, room mapping, size limit,",
    "auth) and propose a concrete fix.",
  ].join("\n");
}
