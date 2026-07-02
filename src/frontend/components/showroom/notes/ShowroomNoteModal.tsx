/**
 * @fileoverview ShowroomNoteModal — reusable create/edit modal for a showroom's
 * rich-text notes.
 *
 * One component powers both flows:
 *   - CREATE (no `note` prop) → POST /api/showroom-stores/:showroomId/notes
 *   - EDIT   (`note` provided) → PUT  /api/showroom-stores/notes/:noteId
 *
 * In EDIT mode a soft-delete action is exposed behind an `AlertDialog` confirm
 * (DELETE /api/showroom-stores/notes/:noteId) — never window.confirm.
 *
 * Content is authored through `OverviewNoteEditor` (PlateJS), which emits both
 * HTML and Markdown on every change; both are persisted.
 */

import { useCallback, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OverviewNoteEditor } from "@/components/showroom/OverviewNoteEditor";

export interface ShowroomNote {
  id: number;
  title: string | null;
  contentHtml: string | null;
  contentMarkdown: string | null;
}

interface ShowroomNoteModalProps {
  showroomId: number;
  /** When provided → EDIT mode (seed fields + expose Delete). Absent → CREATE. */
  note?: ShowroomNote | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Fired after a successful create / update / delete. */
  onSaved?: () => void;
}

export function ShowroomNoteModal({
  showroomId,
  note,
  open,
  onOpenChange,
  onSaved,
}: ShowroomNoteModalProps) {
  const isEdit = Boolean(note);

  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState<{ html: string; markdown: string }>({
    html: note?.contentHtml ?? "",
    markdown: note?.contentMarkdown ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const handleEditorChange = useCallback(
    (value: { html: string; markdown: string }) => setContent(value),
    [],
  );

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle && !content.markdown.trim()) {
      toast.error("Add a title or some content before saving");
      return;
    }
    setSaving(true);
    try {
      const url = isEdit
        ? `/api/showroom-stores/notes/${note!.id}`
        : `/api/showroom-stores/${showroomId}/notes`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle || null,
          contentHtml: content.html,
          contentMarkdown: content.markdown,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((err.error as string) ?? `Failed (${res.status})`);
      }
      toast.success(isEdit ? "Note updated" : "Note added");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }, [content, isEdit, note, onOpenChange, onSaved, showroomId, title]);

  const handleDelete = useCallback(async () => {
    if (!note) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/showroom-stores/notes/${note.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((err.error as string) ?? `Failed (${res.status})`);
      }
      toast.success("Note deleted");
      setConfirmDeleteOpen(false);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete note");
    } finally {
      setDeleting(false);
    }
  }, [note, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit note" : "New note"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this note's title or content."
              : "Capture a note about this showroom — what stood out, who to follow up with, product picks."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow-up on the walnut vanity"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Content</Label>
            <OverviewNoteEditor
              initialHtml={note?.contentHtml ?? undefined}
              initialMarkdown={note?.contentMarkdown ?? undefined}
              onChange={handleEditorChange}
            />
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:justify-between">
          {isEdit ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={saving || deleting}
                className="gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
              <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This note will be removed from the showroom. It will no longer
                      appear here.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="mt-2 gap-2">
                    <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        void handleDelete();
                      }}
                      disabled={deleting}
                      className="bg-rose-500 text-white hover:bg-rose-600"
                    >
                      {deleting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Add note"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
