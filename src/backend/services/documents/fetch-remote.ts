/**
 * @fileoverview Remote document ingestion — fetch a remote PDF (e.g. a brand
 * catalog discovered by the BrandResearchWorkflow's site scrape), archive it to
 * R2 under the supporting-documents key convention, create the
 * `supporting_documents` + `document_entity_associations` rows, and run the
 * extraction/embedding pipeline inline.
 *
 * Doctrine:
 *   - NEVER throws — returns `null` on any failure (with console.error) so a
 *     Workflow step or background chain can call it fire-and-forget-safe.
 *   - Idempotent: when a document with the same `externalUrl` already exists
 *     AND is associated to the same entity, the existing id is returned and no
 *     new row/R2 object is created.
 *   - `extractAndEmbedDocument` is AWAITED (Workflows have no `waitUntil`),
 *     wrapped in its own try/catch so extraction failures never fail ingestion.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";

import { supportingDocuments } from "@backend/db/schema/documents/supporting_documents";
import { documentEntityAssociations } from "@backend/db/schema/documents/document_entity_associations";
import { extractAndEmbedDocument } from "@backend/services/documents/extraction";

/** Hard cap on the remote file size — 25 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Fetch timeout for the remote document. */
const FETCH_TIMEOUT_MS = 10_000;

export interface IngestRemoteDocumentArgs {
  /** Remote URL of the document (PDF). */
  url: string;
  /** Human-readable document title. */
  title: string;
  /** Entity to associate the document with. */
  entityType: "brand" | "product" | "showroom";
  /** Stringified primary key of the entity. */
  entityId: string;
  /** Optional docType classification (e.g. "SPEC", "PLAN"). */
  docType?: string | null;
}

/** True when the URL's pathname ends in `.pdf` (query string ignored). */
function urlLooksLikePdf(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** Derive a safe filename from the URL's last path segment. */
function filenameFromUrl(url: string): string {
  let base = "document.pdf";
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    if (segments.length > 0) base = decodeURIComponent(segments[segments.length - 1]);
  } catch {
    // keep fallback
  }
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}

/**
 * Mirror of `objectKeyForUpload` in
 * `src/backend/api/routes/supporting-documents.ts` — the canonical
 * supporting-documents R2 key convention.
 */
function objectKeyForRemoteDocument(filename: string): string {
  const now = new Date();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `supporting-documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * Fetch a remote PDF, archive it to R2, create the supporting-document +
 * entity-association rows, and run extraction/embedding inline.
 *
 * Returns `{ documentId }` (existing or newly created) or `null` on any
 * failure. NEVER throws.
 */
export async function ingestRemoteDocument(
  env: Env,
  args: IngestRemoteDocumentArgs,
): Promise<{ documentId: string } | null> {
  const { url, title, entityType, entityId, docType } = args;

  try {
    const db = drizzle(env.DB);

    // ── Idempotency: same externalUrl already associated to this entity? ────
    const [existing] = await db
      .select({ id: supportingDocuments.id })
      .from(supportingDocuments)
      .innerJoin(
        documentEntityAssociations,
        eq(documentEntityAssociations.documentId, supportingDocuments.id),
      )
      .where(
        and(
          eq(supportingDocuments.externalUrl, url),
          eq(documentEntityAssociations.entityType, entityType),
          eq(documentEntityAssociations.entityId, entityId),
        ),
      )
      .limit(1);

    if (existing) {
      return { documentId: existing.id };
    }

    // ── Fetch the remote document (follow redirects, 10s timeout) ───────────
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        `[fetch-remote] non-ok ${response.status} fetching ${url} for ${entityType} ${entityId}`,
      );
      return null;
    }

    // ── Validate content type ───────────────────────────────────────────────
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const isPdfUrl = urlLooksLikePdf(url) || urlLooksLikePdf(response.url ?? url);
    const isAcceptable =
      contentType === "application/pdf" ||
      isPdfUrl ||
      (contentType === "application/octet-stream" && isPdfUrl);
    if (!isAcceptable) {
      console.error(
        `[fetch-remote] rejected content-type "${contentType}" for ${url} (not a PDF)`,
      );
      return null;
    }

    // ── Size cap (header pre-check + actual byte check) ─────────────────────
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      console.error(
        `[fetch-remote] ${url} declared ${declaredLength} bytes — over the ${MAX_BYTES} cap`,
      );
      return null;
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      console.error(`[fetch-remote] ${url} returned an empty body`);
      return null;
    }
    if (bytes.byteLength > MAX_BYTES) {
      console.error(
        `[fetch-remote] ${url} is ${bytes.byteLength} bytes — over the ${MAX_BYTES} cap`,
      );
      return null;
    }

    // ── Archive to R2 under the supporting-documents key convention ─────────
    const filename = filenameFromUrl(url);
    const objectKey = objectKeyForRemoteDocument(filename);
    await env.ARTIFACTS_BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: {
        sourceType: "pdf",
        externalUrl: url,
        entityType,
        entityId,
        uploadedAt: new Date().toISOString(),
      },
    });

    // ── Insert the supporting_documents + association rows ──────────────────
    const documentId = crypto.randomUUID();
    const now = new Date();

    await db.insert(supportingDocuments).values({
      id: documentId,
      title,
      sourceType: "pdf",
      mimeType: "application/pdf",
      r2ObjectKey: objectKey,
      r2Url: `/api/artifacts/${objectKey}`,
      externalUrl: url,
      visibility: "private",
      extractionStatus: "pending",
      docType: docType ?? null,
      isActive: true,
      isFactRecord: false,
      revisionNumber: 1,
      datetimeCreated: now,
      datetimeUpdated: now,
    });

    await db
      .insert(documentEntityAssociations)
      .values({ documentId, entityType, entityId })
      .onConflictDoNothing();

    // ── Extraction + embedding — awaited (no waitUntil inside Workflows) ────
    // extractAndEmbedDocument never throws by contract, but we still guard it
    // defensively: a failed extraction must never fail the ingestion result.
    try {
      await extractAndEmbedDocument(env, documentId);
    } catch (err) {
      console.error(
        `[fetch-remote] extraction failed for document ${documentId} (${url}):`,
        err,
      );
    }

    return { documentId };
  } catch (err) {
    console.error(
      `[fetch-remote] ingestRemoteDocument failed for ${url} (${entityType} ${entityId}):`,
      err,
    );
    return null;
  }
}
