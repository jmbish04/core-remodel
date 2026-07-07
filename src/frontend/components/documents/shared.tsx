import {
  FileArchive,
  FileText,
  Globe,
  Image as ImageIcon,
  Link2,
  Monitor,
  Video,
} from "lucide-react";
import React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Wire types — mirror the Phase 2 Documents API (src/backend/api/routes/*).
// ---------------------------------------------------------------------------

export type SourceType = "pdf" | "image" | "video" | "screenshot" | "url" | "text" | "other";
export type Visibility = "private" | "public";
export type ExtractionStatus = "pending" | "processing" | "complete" | "failed" | "skipped";
export type ViewKind = "static" | "dynamic";
export type EntityType = "company" | "brand" | "product" | "showroom" | "permit" | "floor";

export const ENTITY_TYPES: EntityType[] = [
  "company",
  "brand",
  "product",
  "showroom",
  "permit",
  "floor",
];

export const SOURCE_TYPES: SourceType[] = [
  "pdf",
  "image",
  "video",
  "screenshot",
  "url",
  "text",
  "other",
];

export const EXTRACTION_STATUSES: ExtractionStatus[] = [
  "pending",
  "processing",
  "complete",
  "failed",
  "skipped",
];

/** Lean public doc — `GET /api/supporting-documents/public`. */
export interface PublicDocument {
  id: string;
  title: string;
  sourceType: SourceType;
  mimeType: string | null;
  docType: string | null;
  tags: string[];
  r2Url: string | null;
  externalUrl: string | null;
  description: string | null;
  createdAt: number | null;
}

/** Search hit — `GET /api/supporting-documents/search?q=`. */
export interface SearchResult {
  id: string;
  title: string;
  sourceType: SourceType;
  docType: string | null;
  visibility: Visibility;
  tags: string[];
  r2Url: string | null;
  externalUrl: string | null;
  snippet: string | null;
  vectorScore: number | null;
  matchedKeyword: boolean;
}

/** Resolved member doc inside a saved view — `document_views` summary shape. */
export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  mimeType: string | null;
  docType: string | null;
  visibility: Visibility;
  tags: string[];
  r2Url: string | null;
  externalUrl: string | null;
  description: string | null;
  extractionStatus: ExtractionStatus;
  createdAt: number | null;
}

/** Full admin doc — `GET /api/supporting-documents` rows. */
export interface AdminDocument {
  id: string;
  title: string;
  sourceType: SourceType;
  mimeType: string | null;
  docType: string | null;
  visibility: Visibility;
  extractionStatus: ExtractionStatus;
  extractedText: string | null;
  tags: string[];
  r2Url: string | null;
  externalUrl: string | null;
  description: string | null;
  isActive: boolean;
  datetimeCreated: number | string | null;
  datetimeUpdated: number | string | null;
}

/** The document returned by `POST /upload` / `PATCH /:id/settings`. */
export interface UploadedDocument extends AdminDocument {}

export interface DocumentFilters {
  tags?: string[];
  sourceType?: SourceType;
  docType?: string;
  visibility?: Visibility;
  entityType?: EntityType;
  entityId?: string;
  search?: string;
}

export interface DocumentView {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  kind: ViewKind;
  filtersJson: string | null;
  docIdsJson: string | null;
  visibility: Visibility;
  sortOrder: number;
  createdAt: number | null;
  updatedAt: number | null;
  documents?: DocumentSummary[];
}

export interface DocumentAssociation {
  id: number;
  documentId: string;
  entityType: EntityType;
  entityId: string;
  createdAt?: number | string | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers — forward the access cookie, throw readable errors.
// ---------------------------------------------------------------------------

interface ApiEnvelope {
  success?: boolean;
  error?: string | { code?: string; message?: string; details?: string };
}

function envelopeError(payload: ApiEnvelope, status: number): string {
  const err = payload.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  return `Request failed (${status})`;
}

/** GET helper. Throws on non-2xx / `success:false`. */
export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as T & ApiEnvelope;
  if (!response.ok || payload.success === false) {
    const message = envelopeError(payload, response.status);
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

/** JSON-body helper for POST/PATCH/DELETE. Throws on non-2xx / `success:false`. */
export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & ApiEnvelope;
  if (!response.ok || payload.success === false) {
    const message = envelopeError(payload, response.status);
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Presentation helpers.
// ---------------------------------------------------------------------------

const SOURCE_TYPE_ICON: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  image: ImageIcon,
  video: Video,
  screenshot: Monitor,
  url: Link2,
  text: FileText,
  other: FileArchive,
};

/** Small source-type glyph (icon only). */
export function SourceTypeIcon({
  sourceType,
  className,
}: {
  sourceType: SourceType;
  className?: string;
}) {
  const Icon = SOURCE_TYPE_ICON[sourceType] ?? FileArchive;
  return <Icon className={cn("size-4", className)} />;
}

/** Rounded doc-type pill (uppercase). Renders nothing when docType is empty. */
export function DocTypeBadge({ docType, className }: { docType: string | null; className?: string }) {
  if (!docType) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-primary/30",
        className,
      )}
    >
      {docType}
    </span>
  );
}

/** Visibility pill — amber private / emerald public. */
export function VisibilityBadge({
  visibility,
  className,
}: {
  visibility: Visibility;
  className?: string;
}) {
  const isPublic = visibility === "public";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        isPublic
          ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
          : "bg-amber-500/10 text-amber-300 ring-amber-500/30",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", isPublic ? "bg-emerald-400" : "bg-amber-400")} />
      {isPublic ? "Public" : "Private"}
    </span>
  );
}

const EXTRACTION_META: Record<
  ExtractionStatus,
  { label: string; className: string; dot: string; pulse: boolean }
> = {
  pending: {
    label: "Pending",
    className: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
    dot: "bg-zinc-400",
    pulse: true,
  },
  processing: {
    label: "Processing",
    className: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
    dot: "bg-sky-400",
    pulse: true,
  },
  complete: {
    label: "Extracted",
    className: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    dot: "bg-emerald-400",
    pulse: false,
  },
  failed: {
    label: "Failed",
    className: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
    dot: "bg-rose-400",
    pulse: false,
  },
  skipped: {
    label: "Skipped",
    className: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30",
    dot: "bg-zinc-500",
    pulse: false,
  },
};

/** Extraction-status pill with a pulse animation while pending/processing. */
export function ExtractionBadge({
  status,
  className,
}: {
  status: ExtractionStatus;
  className?: string;
}) {
  const meta = EXTRACTION_META[status] ?? EXTRACTION_META.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        meta.className,
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", meta.dot, meta.pulse && "animate-pulse")}
      />
      {meta.label}
    </span>
  );
}

/** View-kind pill — static vs dynamic. */
export function ViewKindBadge({ kind, className }: { kind: ViewKind; className?: string }) {
  const isDynamic = kind === "dynamic";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1",
        isDynamic
          ? "bg-violet-500/10 text-violet-300 ring-violet-500/30"
          : "bg-sky-500/10 text-sky-300 ring-sky-500/30",
        className,
      )}
    >
      {isDynamic ? <Globe className="size-3" /> : null}
      {kind}
    </span>
  );
}

/** Small tag chip. */
export function TagChip({ tag, className }: { tag: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/30",
        className,
      )}
    >
      {tag}
    </span>
  );
}

/** Normalizes createdAt (epoch seconds, ms, or ISO string) to a short date. */
export function formatDocDate(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  let ms: number;
  if (typeof value === "number") {
    // Heuristic: values below 10^12 are epoch seconds.
    ms = value < 1_000_000_000_000 ? value * 1000 : value;
  } else {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    ms = parsed.getTime();
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Kebab-cases a free-text name into a slug candidate. */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Client-side mirror of the API's amber exposure rules (buildWarnings in
 * document-views.ts), computed live as the view-builder form changes so the
 * user sees warnings BEFORE saving.
 *
 * (a) dynamic public view without a visibility:"public" filter, and
 * (b) static public view containing docs whose own visibility is "private".
 */
export function computeViewWarnings(params: {
  visibility: Visibility;
  kind: ViewKind;
  filters: DocumentFilters;
  docIds: string[];
  docsById: Map<string, { title: string; visibility: Visibility }>;
}): string[] {
  const warnings: string[] = [];
  if (params.visibility !== "public") return warnings;

  if (params.kind === "dynamic") {
    if (params.filters.visibility !== "public") {
      warnings.push(
        "Dynamic public view does not filter to public documents — private documents may be exposed",
      );
    }
  } else {
    const privateTitles = params.docIds
      .map((id) => params.docsById.get(id))
      .filter((doc): doc is { title: string; visibility: Visibility } => Boolean(doc))
      .filter((doc) => doc.visibility === "private")
      .map((doc) => doc.title);
    if (privateTitles.length > 0) {
      warnings.push(`Static public view contains private documents: ${privateTitles.join(", ")}`);
    }
  }

  return warnings;
}
