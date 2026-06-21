import { FileText, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, ROOM_SECTION_IDS, type RoomDetailPayload } from "./types";
import {
  documentSourceTypeBadge,
  documentSourceTypeLabel,
  type MaterialsDocument,
} from "./materials-helpers";
import { MaterialsPreviewModal } from "./materials-preview-modal";
import { MaterialsUploadDialog } from "./materials-upload-dialog";

/**
 * SupportingMaterials — full-width documents section at the bottom of the room
 * viewport (T4.1 / T4.2 / IMPLEMENTATION_PLAN §7.8).
 *
 * RENDERS a TABLE of room-scoped supporting documents with columns:
 *   - Filename    → link that opens the {@link MaterialsPreviewModal}
 *                   (image inline / PDF embed / Google Drive/Docs iframe).
 *   - Document type → colored shadcn `Badge` (pdf / image / google-doc / …).
 *   - Document date.
 *   - Description.
 *   - AI summary  → room-tailored relevance, fetched LAZILY as rows mount via
 *                   `POST /api/supporting-documents/:id/room-summary` body
 *                   `{ roomId }`. The endpoint caches server-side (aiRationale),
 *                   so re-renders are cheap and idempotent.
 *
 * UPLOAD: an "Upload" button opens the {@link MaterialsUploadDialog} (dropzone →
 * intake → per-file progress → success/error/retry); on success we refetch the
 * room-scoped list via `GET /api/supporting-documents?roomId=`.
 *
 * DATA: seeded from `detail.supportingDocuments` (already room-scoped) for an
 * instant first paint, then kept fresh by refetching the room-scoped list after
 * uploads or manual refresh. No mock data; shadcn dialogs only.
 *
 * Orchestrator contract: mounted with `{ roomCode, detail }`; keeps
 * `id={ROOM_SECTION_IDS.supporting}`.
 */
export interface SupportingMaterialsProps {
  roomCode: string;
  detail: RoomDetailPayload;
}

/** Response envelope for GET /api/supporting-documents?roomId=. */
interface DocumentsListResponse {
  success?: boolean;
  documents?: MaterialsDocument[];
  error?: string;
}

/** Response envelope for POST /api/supporting-documents/:id/room-summary. */
interface RoomSummaryResponse {
  success?: boolean;
  aiRationale?: string | null;
  cached?: boolean;
  error?: { message?: string } | string;
}

/** Per-document AI summary cell state, keyed by document id. */
type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string | null }
  | { status: "error" };

/**
 * AiSummaryCell — lazily fetches and renders the room-tailored AI summary for a
 * single document. Fetch fires once on mount (the parent only mounts rows for
 * visible documents), and the server caches the result so this is cheap.
 */
function AiSummaryCell({
  documentId,
  roomId,
  seeded,
}: {
  documentId: string;
  roomId: number;
  /** A pre-existing cached summary (aiRationale) from the list payload, if any. */
  seeded?: string | null;
}) {
  const [state, setState] = useState<SummaryState>(
    seeded ? { status: "ready", text: seeded } : { status: "idle" },
  );
  const requestedRef = useRef(false);

  useEffect(() => {
    // Already have a seeded summary, or already requested → do nothing.
    if (seeded || requestedRef.current) return;
    requestedRef.current = true;

    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const response = await fetch(`/api/supporting-documents/${documentId}/room-summary`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
        const payload = (await response.json().catch(() => ({}))) as RoomSummaryResponse;
        if (cancelled) return;
        if (!response.ok || !payload.success) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", text: payload.aiRationale ?? null });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, roomId, seeded]);

  if (state.status === "loading" || state.status === "idle") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Summarizing…
      </span>
    );
  }
  if (state.status === "error") {
    return <span className="text-xs text-muted-foreground">Summary unavailable</span>;
  }
  if (!state.text) {
    return <span className="text-xs text-muted-foreground">No summary</span>;
  }
  return (
    <span className="inline-flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
      <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
      <span>{state.text}</span>
    </span>
  );
}

export function SupportingMaterials({ detail }: SupportingMaterialsProps) {
  const roomId = detail.room.id;

  // The live document list. Seeded from the detail payload (already room-scoped)
  // for an instant first paint, then refetched after uploads / manual refresh.
  const [documents, setDocuments] = useState<MaterialsDocument[]>(
    detail.supportingDocuments as unknown as MaterialsDocument[],
  );
  const [refreshing, setRefreshing] = useState(false);

  const [previewDoc, setPreviewDoc] = useState<MaterialsDocument | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Re-seed if the orchestrator hands us a new detail object (e.g. room change).
  useEffect(() => {
    setDocuments(detail.supportingDocuments as unknown as MaterialsDocument[]);
  }, [detail.supportingDocuments]);

  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/supporting-documents?roomId=${roomId}`, {
        credentials: "include",
      });
      const payload = (await response.json()) as DocumentsListResponse;
      if (response.ok && payload.success && Array.isArray(payload.documents)) {
        setDocuments(payload.documents);
      }
    } catch {
      // Non-fatal — keep the current list; the user can retry.
    } finally {
      setRefreshing(false);
    }
  }, [roomId]);

  const openPreview = useCallback((doc: MaterialsDocument) => {
    setPreviewDoc(doc);
    setPreviewOpen(true);
  }, []);

  const isEmpty = documents.length === 0;

  return (
    <>
      <Card id={ROOM_SECTION_IDS.supporting} className="scroll-mt-24 ring-1 ring-foreground/10">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Supporting Materials</CardTitle>
                <CardDescription>
                  Documents and references linked to this room
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={refreshing}
                aria-label="Refresh documents"
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Refresh
              </Button>
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Plus className="size-4" />
                Upload
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/10 px-4 py-12 text-center ring-1 ring-foreground/10">
              <FileText className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No supporting materials are linked to this room yet.
              </p>
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Plus className="size-4" />
                Upload the first document
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl bg-card/40 ring-1 ring-foreground/10">
              {/* Desktop / tablet table. */}
              <div className="hidden md:block">
                <table className="w-full caption-bottom text-sm">
                  <thead>
                    <tr className="border-b border-foreground/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-medium">
                        Filename
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Type
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Date
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        AI summary
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/5">
                    {documents.map((doc) => (
                      <tr key={doc.id} className="align-top transition-colors hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openPreview(doc)}
                            className="text-left font-medium text-primary hover:underline"
                          >
                            {doc.title}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={documentSourceTypeBadge(doc.sourceType)}>
                            {documentSourceTypeLabel(doc)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatDate(doc.datetimeUpdated ?? doc.datetimeCreated)}
                        </td>
                        <td className="max-w-xs px-4 py-3 text-muted-foreground">
                          {doc.description ? (
                            <span className="line-clamp-3 leading-5">{doc.description}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/70">—</span>
                          )}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <AiSummaryCell
                            documentId={doc.id}
                            roomId={roomId}
                            seeded={doc.aiRationale}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked cards. */}
              <div className="divide-y divide-foreground/5 md:hidden">
                {documents.map((doc) => (
                  <div key={doc.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openPreview(doc)}
                        className="min-w-0 text-left font-medium text-primary hover:underline"
                      >
                        {doc.title}
                      </button>
                      <Badge
                        variant={documentSourceTypeBadge(doc.sourceType)}
                        className="shrink-0"
                      >
                        {documentSourceTypeLabel(doc)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(doc.datetimeUpdated ?? doc.datetimeCreated)}
                    </p>
                    {doc.description ? (
                      <p className="line-clamp-3 text-sm leading-5 text-muted-foreground">
                        {doc.description}
                      </p>
                    ) : null}
                    <div>
                      <AiSummaryCell documentId={doc.id} roomId={roomId} seeded={doc.aiRationale} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filename preview modal (controlled). */}
      <MaterialsPreviewModal
        document={previewDoc}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      {/* Upload dialog (controlled). */}
      <MaterialsUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        roomId={roomId}
        roomName={detail.room.displayName || detail.room.roomName}
        onUploaded={() => void refetch()}
      />
    </>
  );
}

export default SupportingMaterials;
