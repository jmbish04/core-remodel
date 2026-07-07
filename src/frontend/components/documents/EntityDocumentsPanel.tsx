/**
 * @fileoverview EntityDocumentsPanel — reusable "Documents" surface mounted on
 * entity detail pages (company / brand / product / showroom / permit / floor).
 *
 * Fetches GET /api/supporting-documents/by-entity?entityType=&entityId= on mount
 * (and after every upload), rendering each associated doc as a compact row
 * (source-type icon, title, docType + visibility + extraction badges, date,
 * out-link). A collapsible "Upload" section at the top hosts the shared
 * DocumentUploader with auto-association wired to this entity.
 *
 * Monolith dark: no 1px borders (bg-card, ring-1 ring-border/40), lucide-react,
 * loading skeleton + empty state, no mock data.
 */

import { ArrowUpRight, ChevronDown, FileText, Loader2, Plus } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DocumentUploader } from "./DocumentUploader";
import {
  apiGet,
  DocTypeBadge,
  type DocumentSummary,
  type EntityType,
  ExtractionBadge,
  formatDocDate,
  SourceTypeIcon,
  VisibilityBadge,
} from "./shared";

interface ByEntityResponse {
  success: boolean;
  count: number;
  documents: DocumentSummary[];
}

/** Human-readable singular for the empty-state copy. */
const ENTITY_NOUN: Record<EntityType, string> = {
  company: "company",
  brand: "brand",
  product: "product",
  showroom: "showroom",
  permit: "permit",
  floor: "floor",
};

/** Public docs resolve to the on-site reader; everything else opens its blob. */
function docHref(doc: DocumentSummary): string | null {
  if (doc.visibility === "public") return `/docs/${doc.id}`;
  return doc.r2Url ?? doc.externalUrl ?? null;
}

/** Public reader links stay in-tab; blob/external out-links open a new tab. */
function docTarget(doc: DocumentSummary): string | undefined {
  return doc.visibility === "public" ? undefined : "_blank";
}

function DocRow({ doc }: { doc: DocumentSummary }) {
  const href = docHref(doc);
  const target = docTarget(doc);
  const content = (
    <>
      <SourceTypeIcon
        sourceType={doc.sourceType}
        className="mt-0.5 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-sm font-medium">{doc.title}</p>
          {href ? (
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <DocTypeBadge docType={doc.docType} />
          <VisibilityBadge visibility={doc.visibility} />
          {doc.extractionStatus === "pending" || doc.extractionStatus === "processing" ? (
            <ExtractionBadge status={doc.extractionStatus} />
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {formatDocDate(doc.createdAt)}
          </span>
        </div>
      </div>
    </>
  );

  const rowClass =
    "group flex items-start gap-3 bg-card/60 px-3 py-2.5 transition-colors hover:bg-muted/30";

  if (!href) {
    return <div className={rowClass}>{content}</div>;
  }
  return (
    <a
      href={href}
      target={target}
      rel={target === "_blank" ? "noreferrer" : undefined}
      className={cn(rowClass, "outline-none focus-visible:bg-muted/40")}
    >
      {content}
    </a>
  );
}

export function EntityDocumentsPanel({
  entityType,
  entityId,
  heading = "Documents",
}: {
  entityType: EntityType;
  entityId: string;
  heading?: string;
}) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ entityType, entityId });
      const payload = await apiGet<ByEntityResponse>(
        `/api/supporting-documents/by-entity?${params.toString()}`,
      );
      setDocuments(payload.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    setLoading(true);
    void refetch();
  }, [refetch]);

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border/40 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">{heading}</h2>
          <span className="inline-flex items-center rounded-full bg-muted/50 px-1.5 py-0 text-[10px] font-medium text-muted-foreground ring-1 ring-border/30">
            {documents.length}
          </span>
        </div>
        <Button
          size="sm"
          variant={uploadOpen ? "secondary" : "outline"}
          className="gap-1.5"
          onClick={() => setUploadOpen((v) => !v)}
          aria-expanded={uploadOpen}
        >
          <Plus className="size-3.5" />
          Upload
          <ChevronDown
            className={cn("size-3.5 transition-transform", uploadOpen && "rotate-180")}
          />
        </Button>
      </div>

      {/* Collapsible upload section with auto-association to this entity. */}
      {uploadOpen ? (
        <div className="mt-4 rounded-xl bg-muted/20 p-4 ring-1 ring-border/40">
          <DocumentUploader
            association={{ entityType, entityId }}
            onUploaded={() => {
              void refetch();
            }}
          />
        </div>
      ) : null}

      {/* Document list. */}
      <div className="mt-4">
        {loading ? (
          <div className="overflow-hidden rounded-lg ring-1 ring-border/40">
            <div className="divide-y divide-border/40">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 bg-card/60 px-3 py-3">
                  <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/4 animate-pulse rounded bg-muted/70" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/20 px-3 py-8 text-center ring-1 ring-border/30">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true);
                void refetch();
              }}
            >
              <Loader2 className="mr-1.5 size-3.5" />
              Retry
            </Button>
          </div>
        ) : documents.length === 0 ? (
          <p className="rounded-lg bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground ring-1 ring-border/30">
            No documents linked to this {ENTITY_NOUN[entityType]} yet.
          </p>
        ) : (
          <div className="divide-y divide-border/40 overflow-hidden rounded-lg ring-1 ring-border/40">
            {documents.map((doc) => (
              <DocRow key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
