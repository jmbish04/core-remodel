/**
 * @fileoverview Barrel for the dedicated full-page note editor feature.
 */

export { NoteEditorPage } from "./NoteEditorPage";
export { TagMultiSelect } from "./TagMultiSelect";
export { SlateNoteEditor } from "./SlateNoteEditor";
export {
  getAdapter,
  isNoteType,
  type NoteAdapter,
  type NoteType,
  type ContentMode,
  type LoadedNote,
  type SavePayload,
  type HtmlMarkdownValue,
} from "./adapters";

/**
 * Build the note-editor URL for a given surface. Centralized so every Add/Edit
 * call site (showrooms, companies, …) navigates consistently and the `return`
 * param is always encoded.
 */
export function noteEditorHref(opts: {
  type: NoteEditorType;
  entityId: string | number;
  noteId?: string | number;
  /** Absolute path to return to after save/cancel (must start with "/"). */
  returnTo: string;
  /** Optional explicit tag visibility override. */
  showTags?: boolean;
}): string {
  const q = new URLSearchParams();
  q.set("type", opts.type);
  q.set("entityId", String(opts.entityId));
  if (opts.noteId !== undefined && opts.noteId !== null) {
    q.set("noteId", String(opts.noteId));
  }
  q.set("return", opts.returnTo);
  if (opts.showTags !== undefined) q.set("showTags", opts.showTags ? "1" : "0");
  return `/admin/notes/edit?${q.toString()}`;
}

export type NoteEditorType = "showroom" | "company";
