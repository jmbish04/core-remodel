import { ArrowLeft, FolderOpen, Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";

import { DocCard } from "./DocCard";
import { apiGet, type DocumentView, ViewKindBadge } from "./shared";

interface ViewResponse {
  success: boolean;
  view: DocumentView;
}

export function DocViewBucketApp({ slug }: { slug: string }) {
  const [view, setView] = useState<DocumentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const payload = await apiGet<ViewResponse>(
          `/api/document-views/${encodeURIComponent(slug)}`,
        );
        if (!mounted) return;
        setView(payload.view);
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
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading shelf…
      </div>
    );
  }

  if (notFound || !view) {
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
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FolderOpen className="size-8 text-muted-foreground" />
            <div>
              <p className="text-base font-semibold">Shelf not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This document shelf does not exist or is private.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const documents = view.documents ?? [];

  return (
    <div className="space-y-6">
      <a
        href="/docs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to documents
      </a>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <FolderOpen className="size-6 text-muted-foreground" />
            {view.name}
          </h1>
          <ViewKindBadge kind={view.kind} />
        </div>
        {view.description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{view.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {documents.length} document{documents.length === 1 ? "" : "s"}
        </p>
      </header>

      {documents.length === 0 ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="py-16 text-center">
            <p className="text-sm text-muted-foreground">This shelf has no documents yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {documents.map((doc) => (
            <DocCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}
