import { ArrowLeft, Download, ExternalLink, Loader2, Lock } from "lucide-react";
import React, { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  apiGet,
  DocTypeBadge,
  formatDocDate,
  SourceTypeIcon,
  TagChip,
  type Visibility,
} from "./shared";

interface FullDocument {
  id: string;
  title: string;
  sourceType: string;
  mimeType: string | null;
  docType: string | null;
  visibility: Visibility;
  tags: string[];
  r2Url: string | null;
  externalUrl: string | null;
  description: string | null;
  datetimeCreated: number | string | null;
}

interface DocResponse {
  success: boolean;
  document: FullDocument & { sourceType: FullDocument["sourceType"] };
}

export function DocViewerApp({ id }: { id: string }) {
  const [doc, setDoc] = useState<FullDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const payload = await apiGet<DocResponse>(
          `/api/supporting-documents/${encodeURIComponent(id)}`,
        );
        if (!mounted) return;
        setDoc(payload.document as FullDocument);
      } catch {
        if (!mounted) return;
        setNotFound(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading document…
      </div>
    );
  }

  if (notFound || !doc) {
    return (
      <GateCard
        title="Document not found"
        body="This document does not exist or is no longer available."
      />
    );
  }

  // Client-side visibility gate: the underlying GET endpoint is open, so we
  // must refuse to render non-public docs to unauthenticated public viewers.
  if (doc.visibility !== "public") {
    return (
      <GateCard
        title="This document is private"
        body="You need remodel access to view this document."
        showAccessLink
      />
    );
  }

  return (
    <div className="space-y-6">
      <a
        href="/docs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to documents
      </a>

      <header className="space-y-3">
        <div className="flex items-start gap-2.5">
          <SourceTypeIcon
            sourceType={doc.sourceType as never}
            className="mt-1 size-5 shrink-0 text-muted-foreground"
          />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{doc.title}</h1>
        </div>
        {doc.description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{doc.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <DocTypeBadge docType={doc.docType} />
          {doc.tags.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
          <span className="text-xs text-muted-foreground">
            {formatDocDate(doc.datetimeCreated)}
          </span>
        </div>
      </header>

      <DocViewerBody doc={doc} />
    </div>
  );
}

function DocViewerBody({ doc }: { doc: FullDocument }) {
  const href = doc.r2Url ?? doc.externalUrl ?? "";
  const mime = doc.mimeType ?? "";

  if (mime === "application/pdf" && href) {
    return (
      <Card className="overflow-hidden ring-1 ring-border/40">
        <iframe
          src={href}
          title={doc.title}
          className="h-[80vh] w-full border-0"
        />
      </Card>
    );
  }

  if (mime.startsWith("image/") && href) {
    return (
      <Card className="ring-1 ring-border/40">
        <CardContent className="flex justify-center py-6">
          {/* biome-ignore lint/performance/noImgElement: R2-served document image */}
          <img
            src={href}
            alt={doc.title}
            className="max-h-[80vh] w-auto rounded-lg object-contain"
          />
        </CardContent>
      </Card>
    );
  }

  // Fallback — download / open card (CAD, video, other).
  return (
    <Card className="ring-1 ring-border/40">
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <SourceTypeIcon
          sourceType={doc.sourceType as never}
          className="size-10 text-muted-foreground"
        />
        <div>
          <p className="text-sm font-medium">This document can't be previewed inline.</p>
          <p className="text-xs text-muted-foreground">
            Download the file to view it in its native application.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {doc.r2Url ? (
            <a href={doc.r2Url} download className={cn(buttonVariants())}>
              <Download className="mr-2 size-4" />
              Download
            </a>
          ) : null}
          {doc.externalUrl ? (
            <a
              href={doc.externalUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              <ExternalLink className="mr-2 size-4" />
              Open source
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function GateCard({
  title,
  body,
  showAccessLink,
}: {
  title: string;
  body: string;
  showAccessLink?: boolean;
}) {
  return (
    <div className="space-y-6">
      <a
        href="/docs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to documents
      </a>
      <Card className="ring-1 ring-border/40">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Lock className="size-8 text-muted-foreground" />
          <div>
            <p className="text-base font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
          {showAccessLink ? (
            <a href="/access" className={cn(buttonVariants({ variant: "secondary" }))}>
              Request access
            </a>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
