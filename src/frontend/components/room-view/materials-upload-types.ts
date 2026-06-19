/**
 * materials-upload-types.ts — shared types + small pure helpers for the
 * supporting-document upload flow, split out so the upload dialog
 * (`materials-upload-dialog.tsx`) and the per-file row
 * (`materials-upload-row.tsx`) share one definition without a circular import.
 *
 * Side-effect-free (no React, no fetch).
 */

/** Per-file lifecycle status inside the upload dialog. */
export type FileStatus = "ready" | "uploading" | "success" | "error";

/**
 * A staged file plus its editable intake fields and upload state. `key` is a
 * stable client id so React keys survive reorder/removal and retries.
 */
export interface StagedFile {
  key: string;
  file: File;
  /** Editable document name (prefilled from the filename). */
  name: string;
  /** Read-only source type derived from the file MIME. */
  sourceType: string;
  /** Read-only date string captured at stage time (today). */
  dateLabel: string;
  /** Editable free-text description. */
  description: string;
  status: FileStatus;
  /** 0–100 upload progress for the circular ring. */
  progress: number;
  /** Last error message when status === "error". */
  error?: string;
  /** Whether the ✨ improve request is in flight for this row. */
  improving?: boolean;
  /** The AI-suggested description awaiting Approve/Reject, if any. */
  improvedSuggestion?: string | null;
  /** Non-fatal note when the ✨ improve call could not run. */
  improveNote?: string | null;
}

/** Endpoint the upload dialog POSTs each file to (multipart/form-data). */
export const UPLOAD_ENDPOINT = "/api/supporting-documents/upload";

/**
 * Endpoint the ✨ improve-description button calls. Lives on the public,
 * browser-reachable supporting-documents router (aiRouter is Bearer-gated).
 */
export const IMPROVE_ENDPOINT = "/api/supporting-documents/improve-description";

/** Generates a stable client-side key for a staged file. */
export function makeStagedKey(): string {
  return `f_${crypto.randomUUID()}`;
}

/** Today's date as a locale string, captured once per staged file. */
export function todayLabel(): string {
  return new Date().toLocaleDateString();
}
