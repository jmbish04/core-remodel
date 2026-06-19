/**
 * materials-upload-dialog.tsx — the supporting-document upload flow
 * (T4.2 / IMPLEMENTATION_PLAN §7.8).
 *
 * FULL STATE MACHINE (per dialog session):
 *
 *   staging ──(drop / pick files)──> intake ──(Upload)──> uploading ──> done
 *      ▲                                │                     │
 *      └──────── add / remove ─────────┘                     │
 *                                                            (per-file)
 *                                       ┌──────────────────────┴───────────────┐
 *                                       ▼                                       ▼
 *                                    success(✅)                         error(retry)
 *
 * - DROPZONE: native drag/drop + a hidden <input type="file"> trigger. No dep.
 * - INTAKE: SINGLE file → a normal form; MULTIPLE files → a table of rows.
 *     Per file: document name (prefilled from file.name, editable), file type
 *     (auto from MIME, read-only), date (auto = today, read-only), description
 *     (textarea) with a ✨ button that calls POST /api/ai/improve-description.
 *     The improved text is shown for Approve (overwrites) / Reject.
 * - UPLOAD: each file POSTs to /api/supporting-documents/upload via XHR so we get
 *     real upload progress → a per-file CIRCULAR progress ring, then ✅ on
 *     success. While ANY file is uploading the modal CANNOT be closed (a
 *     friendly "please wait — don't close your browser" banner shows).
 * - ERRORS: a per-file failure does NOT block the others. The failed row shows a
 *     shadcn error block (never window.alert) with a copy-to-clipboard button
 *     that ANIMATES on success, copying an "AI coding agent: fix this" prompt,
 *     plus a Retry button that re-uploads only that file.
 *
 * The per-file row view, the circular progress ring, and the animated copy
 * button live in `materials-upload-row.tsx`; the shared `StagedFile` type lives
 * in `materials-upload-types.ts`. This file owns all state + upload/AI logic.
 *
 * All dialogs are shadcn; no window.alert/confirm; dark Monolith styling.
 */

import { Check, Loader2, UploadCloud } from "lucide-react";
import React, { useCallback, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sourceTypeFromMime, titleFromFilename } from "./materials-helpers";
import { StagedRow, UploadDropzone } from "./materials-upload-row";
import {
  IMPROVE_ENDPOINT,
  UPLOAD_ENDPOINT,
  makeStagedKey,
  todayLabel,
  type StagedFile,
} from "./materials-upload-types";

export interface MaterialsUploadDialogProps {
  /** Controlled open state. */
  open: boolean;
  /** Open-state change handler. Ignored while an upload is in flight (locked). */
  onOpenChange: (open: boolean) => void;
  /** Room id the uploaded documents are mapped to. */
  roomId: number;
  /** Room display name shown in the header for context. */
  roomName: string;
  /** Called after at least one file uploads successfully so the table can refetch. */
  onUploaded: () => void;
}

/**
 * MaterialsUploadDialog — owns the staging → intake → upload state machine for
 * the room's supporting documents.
 */
export function MaterialsUploadDialog({
  open,
  onOpenChange,
  roomId,
  roomName,
  onUploaded,
}: MaterialsUploadDialogProps) {
  const [staged, setStaged] = useState<StagedFile[]>([]);

  // Tracks whether any successful upload happened this session so we only fire
  // onUploaded() (and a "done" hint) when there's something to refresh.
  const [anySucceeded, setAnySucceeded] = useState(false);

  // Derived: is anything currently uploading? Drives the close-lock + banner.
  const isUploading = staged.some((f) => f.status === "uploading");

  // ---- Staging --------------------------------------------------------------

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    setStaged((current) => [
      ...current,
      ...incoming.map<StagedFile>((file) => ({
        key: makeStagedKey(),
        file,
        name: titleFromFilename(file.name),
        sourceType: sourceTypeFromMime(file.type),
        dateLabel: todayLabel(),
        description: "",
        status: "ready",
        progress: 0,
      })),
    ]);
  }, []);

  const removeFile = useCallback((key: string) => {
    setStaged((current) => current.filter((f) => f.key !== key));
  }, []);

  const updateFile = useCallback((key: string, patch: Partial<StagedFile>) => {
    setStaged((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }, []);

  // ---- AI improve description ----------------------------------------------

  const improveDescription = useCallback(
    async (key: string) => {
      const target = staged.find((f) => f.key === key);
      if (!target || !target.description.trim()) return;

      updateFile(key, { improving: true, improveNote: null, improvedSuggestion: null });
      try {
        const response = await fetch(IMPROVE_ENDPOINT, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: target.description.trim(),
            context: `${roomName} supporting document: ${target.name}`.slice(0, 200),
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          improved?: string;
          error?: { message?: string } | string;
        };

        if (!response.ok || !payload.success || !payload.improved) {
          // ✨ improve is an enhancement, not a blocker — surface a soft note
          // (e.g. the AI route currently requires a bearer token the browser
          // session doesn't carry) without breaking the upload flow.
          const message =
            typeof payload.error === "string"
              ? payload.error
              : payload.error?.message ||
                (response.status === 401
                  ? "AI improve needs sign-in / API access; you can still upload."
                  : "Couldn't improve the description right now.");
          updateFile(key, { improving: false, improveNote: message });
          return;
        }

        updateFile(key, { improving: false, improvedSuggestion: payload.improved });
      } catch {
        updateFile(key, {
          improving: false,
          improveNote: "Couldn't reach the AI service; you can still upload.",
        });
      }
    },
    [staged, roomName, updateFile],
  );

  const approveSuggestion = useCallback(
    (key: string) => {
      const target = staged.find((f) => f.key === key);
      if (!target?.improvedSuggestion) return;
      updateFile(key, {
        description: target.improvedSuggestion,
        improvedSuggestion: null,
        improveNote: null,
      });
    },
    [staged, updateFile],
  );

  const rejectSuggestion = useCallback(
    (key: string) => {
      updateFile(key, { improvedSuggestion: null });
    },
    [updateFile],
  );

  // ---- Upload (XHR for real per-file progress) ------------------------------

  /**
   * Uploads a single staged file via XHR, streaming progress into its row.
   * Resolves true on success, false on failure (failures are recorded on the
   * row, never thrown, so a sibling failure can't abort the batch).
   */
  const uploadOne = useCallback(
    (key: string) =>
      new Promise<boolean>((resolve) => {
        const target = staged.find((f) => f.key === key);
        if (!target) {
          resolve(false);
          return;
        }

        const form = new FormData();
        form.append("file", target.file);
        form.append("title", target.name.trim() || titleFromFilename(target.file.name));
        form.append("sourceType", target.sourceType);
        if (target.description.trim()) form.append("description", target.description.trim());
        form.append("roomIds", String(roomId));

        const xhr = new XMLHttpRequest();
        xhr.open("POST", UPLOAD_ENDPOINT);
        xhr.withCredentials = true;

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            updateFile(key, { progress: pct });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            updateFile(key, { status: "success", progress: 100, error: undefined });
            resolve(true);
          } else {
            let message = `Upload failed (HTTP ${xhr.status})`;
            try {
              const parsed = JSON.parse(xhr.responseText) as {
                error?: string | { message?: string };
                details?: string;
              };
              if (typeof parsed.error === "string") message = parsed.error;
              else if (parsed.error?.message) message = parsed.error.message;
              if (parsed.details) message = `${message} — ${parsed.details}`;
            } catch {
              // Non-JSON response — keep the HTTP status message.
            }
            updateFile(key, { status: "error", error: message });
            resolve(false);
          }
        };

        xhr.onerror = () => {
          updateFile(key, {
            status: "error",
            error: "Network error during upload. Check your connection and retry.",
          });
          resolve(false);
        };

        updateFile(key, { status: "uploading", progress: 0, error: undefined });
        xhr.send(form);
      }),
    [staged, roomId, updateFile],
  );

  const uploadAll = useCallback(async () => {
    const pending = staged.filter((f) => f.status === "ready" || f.status === "error");
    if (pending.length === 0) return;

    // Upload sequentially so progress is legible and we don't hammer the Worker
    // (Workers AI / R2 quotas have bitten this project before). Each result is
    // independent; one failure never aborts the rest.
    let succeeded = false;
    for (const file of pending) {
      const ok = await uploadOne(file.key);
      if (ok) succeeded = true;
    }
    if (succeeded) {
      setAnySucceeded(true);
      onUploaded();
    }
  }, [staged, uploadOne, onUploaded]);

  const retryOne = useCallback(
    async (key: string) => {
      const ok = await uploadOne(key);
      if (ok) {
        setAnySucceeded(true);
        onUploaded();
      }
    },
    [uploadOne, onUploaded],
  );

  // ---- Close handling (locked mid-upload) -----------------------------------

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Never allow closing while an upload is in flight.
      if (!next && isUploading) return;
      // On clean close, reset the session so a re-open starts fresh.
      if (!next) {
        setStaged([]);
        setAnySucceeded(false);
      }
      onOpenChange(next);
    },
    [isUploading, onOpenChange],
  );

  const readyCount = staged.filter((f) => f.status === "ready" || f.status === "error").length;
  const isSingle = staged.length === 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[92svh] w-full max-w-[calc(100%-2rem)] overflow-hidden sm:max-w-2xl"
        showCloseButton={!isUploading}
      >
        <DialogHeader>
          <DialogTitle>Upload supporting materials</DialogTitle>
          <DialogDescription>
            Files are linked to <span className="font-medium text-foreground">{roomName}</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Locked banner while uploading. */}
        {isUploading ? (
          <Alert className="border-0 bg-amber-500/10 ring-1 ring-amber-500/30">
            <Loader2 className="size-4 animate-spin text-amber-500" />
            <AlertTitle className="text-amber-200">Upload in progress</AlertTitle>
            <AlertDescription className="text-amber-200/80">
              Please wait — don&apos;t close your browser or this dialog until every file finishes.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {/* Dropzone — hidden while uploading to avoid mid-flight staging. */}
          {!isUploading ? <UploadDropzone onFiles={addFiles} /> : null}

          {/* Intake: SINGLE → form; MULTIPLE → rows. */}
          {staged.length > 0 ? (
            <div className="space-y-3">
              {staged.map((item) => (
                <StagedRow
                  key={item.key}
                  item={item}
                  compact={!isSingle}
                  onNameChange={(value) => updateFile(item.key, { name: value })}
                  onDescriptionChange={(value) => updateFile(item.key, { description: value })}
                  onRemove={() => removeFile(item.key)}
                  onImprove={() => void improveDescription(item.key)}
                  onApprove={() => approveSuggestion(item.key)}
                  onReject={() => rejectSuggestion(item.key)}
                  onRetry={() => void retryOne(item.key)}
                />
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer actions. */}
        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-end">
          {anySucceeded && !isUploading ? (
            <p className="mr-auto text-xs text-emerald-400">
              <Check className="mr-1 inline size-3.5" />
              Uploaded — they now appear in the table.
            </p>
          ) : null}
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isUploading}>
            {anySucceeded ? "Done" : "Cancel"}
          </Button>
          <Button onClick={() => void uploadAll()} disabled={isUploading || readyCount === 0}>
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <UploadCloud className="size-4" />
                {readyCount > 0 ? `Upload ${readyCount} file${readyCount > 1 ? "s" : ""}` : "Upload"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MaterialsUploadDialog;
