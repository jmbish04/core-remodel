/**
 * materials-upload-row.tsx — presentational pieces of the upload flow extracted
 * from `materials-upload-dialog.tsx` to keep both files within budget:
 *
 *   - CircularProgress: a dependency-free SVG ring for per-file upload progress.
 *   - CopyFixButton:    copies an "AI coding agent: fix this" prompt and ANIMATES
 *                       to a check on success.
 *   - StagedRow:        one staged file's intake fields + AI-improve + progress +
 *                       per-file error block (copy + retry).
 *
 * The dialog owns all state and the upload/AI logic; this file is purely the
 * row view plus the two tiny widgets it uses. Monolith styling; shadcn only.
 */

import {
  AlertTriangle,
  Check,
  Copy,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import React, { useCallback, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildAiFixPrompt } from "./materials-helpers";
import { UPLOAD_ENDPOINT, type StagedFile } from "./materials-upload-types";

/**
 * CircularProgress — a tiny SVG ring used for per-file upload progress. Pure
 * presentational; `value` is 0–100. Avoids any charting dependency.
 */
export function CircularProgress({ value, done }: { value: number; done?: boolean }) {
  const size = 36;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex size-9 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            "transition-[stroke-dashoffset] duration-200",
            done ? "text-emerald-500" : "text-primary",
          )}
        />
      </svg>
      <span className="absolute text-[10px] font-medium tabular-nums">
        {done ? "" : `${Math.round(clamped)}`}
      </span>
      {done ? <Check className="absolute size-4 text-emerald-500" /> : null}
    </div>
  );
}

/**
 * CopyFixButton — copies an "AI coding agent: fix this" prompt to the clipboard
 * and ANIMATES to a check on success, reverting after a moment. Used inside the
 * per-file error block so the founder can paste the failure into a coding agent.
 */
export function CopyFixButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (permissions/insecure context). Fall back to a
      // hidden textarea + execCommand so the copy still works without a throw.
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        // Give up silently — the error text is still visible to copy manually.
      }
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void onCopy()}
      className={cn("transition-colors", copied && "text-emerald-500")}
      aria-live="polite"
    >
      {copied ? (
        <>
          <Check className="size-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          Copy fix prompt
        </>
      )}
    </Button>
  );
}

export interface UploadDropzoneProps {
  /** Receives files chosen via drag-drop or the file picker. */
  onFiles: (files: FileList | File[]) => void;
  /** Disables interaction (e.g. while an upload is in flight). */
  disabled?: boolean;
}

/**
 * UploadDropzone — a dependency-free drag-and-drop + click-to-browse target.
 * Owns its own drag-active highlight and hidden <input>; the parent only
 * receives the chosen files via `onFiles`. Uses the standard accessible
 * `role="button"` dropzone pattern (a native <button> can't legitimately wrap
 * the hidden file input + drag handlers without nesting interactive elements),
 * matching the precedent already established elsewhere in this codebase.
 */
export function UploadDropzone({ onFiles, disabled }: UploadDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (disabled) return;
        if (event.dataTransfer?.files?.length) onFiles(event.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted/20 px-6 py-10 text-center ring-1 ring-foreground/10 transition-colors",
        dragActive && "bg-primary/10 ring-primary/40",
      )}
    >
      <UploadCloud className="size-7 text-muted-foreground" />
      <p className="text-sm font-medium">Drag &amp; drop files here, or click to browse</p>
      <p className="text-xs text-muted-foreground">
        PDFs, images, screenshots, or any project reference.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          // Reset so re-picking the same file fires onChange again.
          event.target.value = "";
        }}
      />
    </div>
  );
}

export interface StagedRowProps {
  item: StagedFile;
  /** Compact (multi-file) layout when true; roomier single-file form when false. */
  compact: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onRemove: () => void;
  onImprove: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
}

/**
 * StagedRow — renders one staged file. In `compact` mode (multi-file) it is a
 * dense row; otherwise it's a roomier single-file form. Both expose the same
 * fields and AI-improve / progress / error affordances.
 */
export function StagedRow({
  item,
  compact,
  onNameChange,
  onDescriptionChange,
  onRemove,
  onImprove,
  onApprove,
  onReject,
  onRetry,
}: StagedRowProps) {
  const locked = item.status === "uploading";
  const fixPrompt = buildAiFixPrompt({
    fileName: item.file.name,
    message: item.error ?? "Unknown error",
    endpoint: UPLOAD_ENDPOINT,
  });

  return (
    <div className="space-y-3 rounded-xl bg-card/40 p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.file.name}</p>
            <p className="text-xs capitalize text-muted-foreground">
              {item.sourceType} • {item.dateLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.status === "uploading" || item.status === "success" ? (
            <CircularProgress value={item.progress} done={item.status === "success"} />
          ) : null}
          {item.status !== "uploading" && item.status !== "success" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              aria-label={`Remove ${item.file.name}`}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Editable fields (hidden once the row is uploading/succeeded to reduce noise). */}
      {item.status === "ready" || item.status === "error" ? (
        <div className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "")}>
          <div className="space-y-1.5">
            <Label htmlFor={`name-${item.key}`} className="text-xs">
              Document name
            </Label>
            <Input
              id={`name-${item.key}`}
              value={item.name}
              onChange={(event) => onNameChange(event.target.value)}
              disabled={locked}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">File type</Label>
            <Input value={item.sourceType} readOnly disabled className="capitalize" />
          </div>
          <div className={cn("space-y-1.5", compact ? "sm:col-span-2" : "")}>
            <div className="flex items-center justify-between">
              <Label htmlFor={`desc-${item.key}`} className="text-xs">
                Description
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onImprove}
                disabled={locked || item.improving || !item.description.trim()}
              >
                {item.improving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                Improve
              </Button>
            </div>
            <Textarea
              id={`desc-${item.key}`}
              value={item.description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="What is this document and why does it matter for this room?"
              rows={compact ? 2 : 3}
              disabled={locked}
            />

            {/* Non-fatal improve note (e.g. AI route unavailable). */}
            {item.improveNote ? (
              <p className="text-xs text-muted-foreground">{item.improveNote}</p>
            ) : null}

            {/* AI suggestion awaiting Approve / Reject. */}
            {item.improvedSuggestion ? (
              <div className="space-y-2 rounded-lg bg-primary/5 p-3 ring-1 ring-primary/20">
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Sparkles className="size-3" />
                  Suggested description
                </p>
                <p className="text-sm leading-6">{item.improvedSuggestion}</p>
                <div className="flex gap-2">
                  <Button type="button" size="xs" onClick={onApprove}>
                    <Check className="size-3" />
                    Approve
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={onReject}>
                    Reject
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Per-file error block — copy-to-clipboard (animated) + Retry. */}
      {item.status === "error" ? (
        <Alert
          variant="destructive"
          className="border-0 bg-destructive/10 ring-1 ring-destructive/30"
        >
          <AlertTriangle className="size-4" />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="break-words">{item.error}</p>
            <div className="flex flex-wrap gap-2">
              <CopyFixButton text={fixPrompt} />
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RotateCcw className="size-3.5" />
                Retry this file
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Success affordance. */}
      {item.status === "success" ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Check className="size-3.5" />
          Uploaded and linked to this room.
        </p>
      ) : null}
    </div>
  );
}

export default StagedRow;
