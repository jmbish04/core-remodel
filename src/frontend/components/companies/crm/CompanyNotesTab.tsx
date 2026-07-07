/**
 * @fileoverview Company Notes tab (0013 roadmap P3-03).
 *
 * Lists a company's CRM notes as cards with tag chips. Create/edit now navigate
 * the current tab to the dedicated full-page note editor (`/admin/notes/edit`,
 * type=company) — modals are too cramped for long notes. Soft-delete stays
 * inline here behind a confirmation dialog.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { noteEditorHref } from "@/components/notes";

import {
  apiGet,
  apiSend,
  contentPreview,
  formatDateTime,
  type Note,
  type NotesListResponse,
} from "./shared";

// Return here (Notes tab) after saving/cancelling in the full-page editor.
function companyNotesReturn(companyId: number): string {
  return `/admin/companies/${companyId}?tab=notes`;
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
          {note.tags && note.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px] font-normal"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
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

  // Create/edit navigate the current tab to the dedicated full-page editor.
  const openCreate = useCallback(() => {
    window.location.assign(
      noteEditorHref({
        type: "company",
        entityId: companyId,
        returnTo: companyNotesReturn(companyId),
      }),
    );
  }, [companyId]);

  const openEdit = useCallback(
    (note: Note) => {
      window.location.assign(
        noteEditorHref({
          type: "company",
          entityId: companyId,
          noteId: note.id,
          returnTo: companyNotesReturn(companyId),
        }),
      );
    },
    [companyId],
  );

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
