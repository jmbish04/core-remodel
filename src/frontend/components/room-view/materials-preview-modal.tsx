/**
 * materials-preview-modal.tsx — the filename preview Dialog for Supporting
 * Materials (T4.1 / IMPLEMENTATION_PLAN §7.8).
 *
 * Clicking a document filename in the table opens this modal, which renders the
 * file inline by type:
 *   - image            → inline <img>
 *   - PDF              → <object> with an <embed> fallback
 *   - Google Drive/Doc → <iframe> (URL rewritten to the embeddable /preview form)
 *   - other http(s)    → generic <iframe>
 *   - non-previewable  → a friendly "open in a new tab" message
 *
 * The modal always offers Close + "Open in new tab". It uses the shared shadcn
 * Dialog (never window.alert/confirm) and Monolith styling.
 */

import { ExternalLink, FileWarning } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  documentHref,
  resolvePreviewKind,
  toGoogleEmbedUrl,
  type MaterialsDocument,
} from "./materials-helpers";

export interface MaterialsPreviewModalProps {
  /** The document to preview, or null when the modal is closed. */
  document: MaterialsDocument | null;
  /** Controlled open state. */
  open: boolean;
  /** Open-state change handler (Close button, backdrop, Escape). */
  onOpenChange: (open: boolean) => void;
}

/** Renders the inline preview body for a document based on its resolved kind. */
function PreviewBody({ document }: { document: MaterialsDocument }) {
  const href = documentHref(document);
  const kind = resolvePreviewKind(document);

  if (!href || kind === "none") {
    return (
      <div className="flex min-h-[40svh] flex-col items-center justify-center gap-3 rounded-lg bg-muted/20 p-8 text-center ring-1 ring-foreground/10">
        <FileWarning className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          This document type can&apos;t be previewed inline.
          {href ? " Use “Open in new tab” to view it." : " No source URL is available."}
        </p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="flex max-h-[68svh] items-center justify-center overflow-auto rounded-lg bg-black/30 ring-1 ring-foreground/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={href}
          alt={document.title}
          className="max-h-[66svh] w-auto max-w-full object-contain"
        />
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <object
        data={href}
        type="application/pdf"
        className="h-[68svh] w-full rounded-lg bg-muted/20 ring-1 ring-foreground/10"
        aria-label={`${document.title} (PDF preview)`}
      >
        {/* Fallback for browsers that won't render <object> PDFs. */}
        <embed src={href} type="application/pdf" className="h-[68svh] w-full" />
        <p className="p-6 text-center text-sm text-muted-foreground">
          Your browser can&apos;t display this PDF inline. Use &ldquo;Open in new tab&rdquo;.
        </p>
      </object>
    );
  }

  // kind === "google" | "iframe"
  const src = kind === "google" ? toGoogleEmbedUrl(href) : href;
  return (
    <iframe
      src={src}
      title={`${document.title} (preview)`}
      className="h-[68svh] w-full rounded-lg bg-muted/20 ring-1 ring-foreground/10"
      // Constrain what the embedded frame may do; allow same-origin reads for
      // Google's preview surface and pop-outs for "open in Drive".
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * MaterialsPreviewModal — controlled preview dialog. The parent owns which
 * document is active and the open flag; this component is otherwise stateless.
 */
export function MaterialsPreviewModal({
  document,
  open,
  onOpenChange,
}: MaterialsPreviewModalProps) {
  const href = document ? documentHref(document) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-full max-w-[calc(100%-2rem)] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">
            {document?.title ?? "Document preview"}
          </DialogTitle>
          <DialogDescription>Inline preview of the linked document.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-auto">
          {document ? <PreviewBody document={document} /> : null}
        </div>

        <DialogFooter>
          {href ? (
            <Button
              variant="outline"
              render={
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${document?.title ?? "document"} in a new tab`}
                />
              }
            >
              <ExternalLink className="size-4" />
              Open in new tab
            </Button>
          ) : null}
          <DialogClose render={<Button variant="default" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MaterialsPreviewModal;
