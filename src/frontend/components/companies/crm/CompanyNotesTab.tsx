/**
 * @fileoverview Company Notes tab (0013 roadmap P3-03).
 *
 * Lists a company's CRM notes as cards with a PlateJS rich-text editor for
 * create / edit-in-place, and soft-delete with confirmation. Content
 * round-trips as Slate-JSON via the shared slateToJson/jsonToSlate helpers.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import type { Descendant } from "slate";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  apiGet,
  apiSend,
  contentPreview,
  formatDateTime,
  jsonToSlate,
  slateToJson,
  type Note,
  type NoteResponse,
  type NotesListResponse,
} from "./shared";

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

interface NoteEditorDialogProps {
  companyId: number;
  /** null → create mode; a Note → edit mode. */
  note: Note | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (note: Note, mode: "create" | "edit") => void;
}

function NoteEditorDialog({ companyId, note, open, onOpenChange, onSaved }: NoteEditorDialogProps) {
  const mode: "create" | "edit" = note ? "edit" : "create";
  const [title, setTitle] = useState("");
  const [value, setValue] = useState<Descendant[]>(jsonToSlate(null));
  const [saving, setSaving] = useState(false);

  // Re-create the editor per note (and per open toggle) so switching records
  // never shows the previous note's content. This is the critical deps trick.
  const editorKey = note?.id ?? "create";
  const editor = usePlateEditor(
    {
      plugins: [BasicBlocksPlugin, BasicMarksPlugin],
      value: jsonToSlate(note?.content ?? null) as any,
    },
    [editorKey, open],
  );

  useEffect(() => {
    if (!open) return;
    setTitle(note?.title ?? "");
    setValue(jsonToSlate(note?.content ?? null));
  }, [open, note]);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Note title is required");
      return;
    }
    setSaving(true);
    try {
      const payload = { title: trimmed, content: slateToJson(value) };
      let saved: Note;
      if (mode === "create") {
        const res = await apiSend<NoteResponse>(
          `/api/companies/${companyId}/notes`,
          "POST",
          payload,
        );
        saved = res.note;
      } else {
        const res = await apiSend<NoteResponse>(
          `/api/companies/${companyId}/notes/${note!.id}`,
          "PATCH",
          payload,
        );
        saved = res.note;
      }
      toast.success(mode === "create" ? "Note created" : "Note updated");
      onSaved(saved, mode);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }, [title, value, mode, companyId, note, onSaved, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Base UI controlled guard — block dismissal mid-save (no Radix props).
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New note" : "Edit note"}</DialogTitle>
          <DialogDescription>
            Rich-text note attached to this company. Saved as structured content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Kickoff call summary"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Content</Label>
            <div className="rounded-lg bg-card p-2 ring-1 ring-border/40">
              <Plate editor={editor} onValueChange={({ value: v }) => setValue(v as Descendant[])}>
                <PlateContent
                  className="min-h-[160px] max-h-[320px] overflow-y-auto rounded bg-background/40 px-3 py-2 text-sm text-foreground ring-1 ring-border/40 focus-visible:outline-none placeholder:text-muted-foreground"
                  placeholder="Write context, decisions, follow-ups…"
                />
              </Plate>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "create" ? "Create note" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

interface DeleteNoteDialogProps {
  note: Note | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleting: boolean;
}

function DeleteNoteDialog({ note, open, onOpenChange, onConfirm, deleting }: DeleteNoteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete note?</DialogTitle>
          <DialogDescription>
            {note ? `"${note.title}" will be removed. This can be undone by an admin.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Note card
// ---------------------------------------------------------------------------

function NoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
}) {
  const preview = useMemo(() => contentPreview(note.content), [note.content]);
  const stamp = note.updatedAt ?? note.createdAt;

  return (
    <Card className="group transition-colors hover:bg-card/80">
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <h4 className="truncate font-medium text-foreground">{note.title}</h4>
          </div>
          {preview ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {preview}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-muted-foreground/70">No content</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground/70">
            Updated {formatDateTime(stamp)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(note)} aria-label="Edit note">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(note)}
            aria-label="Delete note"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function CompanyNotesTab({ companyId }: { companyId: number }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [activeNote, setActiveNote] = useState<Note | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<NotesListResponse>(`/api/companies/${companyId}/notes`);
      setNotes(res.notes ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load notes";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = useCallback(() => {
    setActiveNote(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((note: Note) => {
    setActiveNote(note);
    setEditorOpen(true);
  }, []);

  const handleSaved = useCallback((saved: Note, mode: "create" | "edit") => {
    setNotes((prev) =>
      mode === "create"
        ? [saved, ...prev]
        : prev.map((n) => (n.id === saved.id ? saved : n)),
    );
  }, []);

  const openDelete = useCallback((note: Note) => {
    setDeleteTarget(note);
    setDeleteOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiSend(`/api/companies/${companyId}/notes/${deleteTarget.id}`, "DELETE");
      setNotes((prev) => prev.filter((n) => n.id !== deleteTarget.id));
      toast.success("Note deleted");
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, companyId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Notes</h3>
          <p className="text-sm text-muted-foreground">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New note
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-card ring-1 ring-border/40" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-3">
              <StickyNote className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">No notes yet</p>
              <p className="text-sm text-muted-foreground">
                Capture calls, decisions, and follow-ups for this company.
              </p>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> New note
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onEdit={openEdit} onDelete={openDelete} />
          ))}
        </div>
      )}

      <NoteEditorDialog
        companyId={companyId}
        note={activeNote}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={handleSaved}
      />

      <DeleteNoteDialog
        note={deleteTarget}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
        deleting={deleting}
      />
    </div>
  );
}
