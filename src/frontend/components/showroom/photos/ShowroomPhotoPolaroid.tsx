/**
 * @fileoverview ShowroomPhotoPolaroid — a flippable "instant photo" card for a
 * showroom photo.
 *
 * FRONT: the photo (object-cover) inside a polaroid-style frame with a caption
 * strip. Clicking the card flips it (CSS 3D rotateY) to the BACK.
 *
 * BACK: the photo's note, rendered from trusted single-author HTML via
 * `dangerouslySetInnerHTML`, plus an inline "Edit note" affordance. Editing
 * reveals an `OverviewNoteEditor` and saves via
 * PUT /api/showroom-stores/photos/:photoId/note.
 *
 * The card owns its own flip + edit + saving state — drop it into any grid.
 * Adapted from the beste `card12` (polaroid) and `card13` (3D flip) references,
 * reimplemented natively for the Monolith dark theme (no next/image, no
 * next/link, no 1px separators).
 */

import { useCallback, useState } from "react";
import { ImageOff, Loader2, Pencil, RotateCcw, StickyNote, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OverviewNoteEditor } from "@/components/showroom/OverviewNoteEditor";

export interface ShowroomPhoto {
  id: number;
  deliveryUrl: string;
  altText: string | null;
  noteHtml: string | null;
  noteMarkdown: string | null;
}

interface ShowroomPhotoPolaroidProps {
  photo: ShowroomPhoto;
  /** Fired after the note is saved. */
  onSaved?: () => void;
}

export function ShowroomPhotoPolaroid({ photo, onSaved }: ShowroomPhotoPolaroidProps) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);

  // Local mirror of the note so a save reflects immediately without a refetch.
  const [note, setNote] = useState<{ html: string | null; markdown: string | null }>({
    html: photo.noteHtml,
    markdown: photo.noteMarkdown,
  });
  const [draft, setDraft] = useState<{ html: string; markdown: string }>({
    html: photo.noteHtml ?? "",
    markdown: photo.noteMarkdown ?? "",
  });

  const caption = photo.altText?.trim() || "Untitled";

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/showroom-stores/photos/${photo.id}/note`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteHtml: draft.html, noteMarkdown: draft.markdown }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((err.error as string) ?? `Failed (${res.status})`);
      }
      setNote({ html: draft.html, markdown: draft.markdown });
      setEditing(false);
      toast.success("Note saved");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved, photo.id]);

  const startEditing = useCallback(() => {
    setDraft({ html: note.html ?? "", markdown: note.markdown ?? "" });
    setEditing(true);
  }, [note]);

  const hasNote = Boolean(note.html && note.html.trim());

  return (
    <div className="group/polaroid aspect-[3/4] w-full max-w-xs [perspective:1200px]">
      <div
        className={cn(
          "relative size-full transition-transform duration-700 ease-[cubic-bezier(0.4,0.2,0.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none",
          flipped && "[transform:rotateY(180deg)]",
        )}
      >
        {/* ── FRONT: photo ─────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setFlipped(true)}
          aria-label="Flip to note"
          className="absolute inset-0 flex flex-col overflow-hidden rounded-md bg-card p-2.5 pb-3 text-left shadow-lg ring-1 ring-border/40 [backface-visibility:hidden] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="relative flex-1 overflow-hidden rounded-sm bg-muted">
            {imgBroken ? (
              <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                <ImageOff className="size-6" />
                <span className="text-[11px]">Image unavailable</span>
              </div>
            ) : (
              <img
                src={photo.deliveryUrl}
                alt={photo.altText ?? ""}
                onError={() => setImgBroken(true)}
                className="size-full object-cover transition-transform duration-500 motion-safe:group-hover/polaroid:scale-[1.02]"
              />
            )}
            {hasNote && (
              <span
                aria-label="Has a note"
                className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/80 text-sky-400 ring-1 ring-border/40 backdrop-blur-sm"
              >
                <StickyNote className="size-3.5" />
              </span>
            )}
          </div>
          {/* Caption strip — the polaroid's white margin, dark-theme appropriate. */}
          <div className="flex min-h-9 items-center justify-between gap-2 px-1 pt-2.5">
            <span className="line-clamp-1 font-serif text-sm italic text-foreground/90">
              {caption}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <RotateCcw className="size-3" />
              Note
            </span>
          </div>
        </button>

        {/* ── BACK: note ───────────────────────────────────────────────── */}
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-md bg-card p-4 shadow-lg ring-1 ring-border/40 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="line-clamp-1 text-sm font-medium text-foreground">{caption}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Flip back to photo"
              onClick={() => {
                setEditing(false);
                setFlipped(false);
              }}
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>

          {editing ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <OverviewNoteEditor
                  initialHtml={note.html ?? undefined}
                  initialMarkdown={note.markdown ?? undefined}
                  onChange={(v) => setDraft(v)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-background/60 px-3 py-2.5 text-sm leading-relaxed">
                {hasNote ? (
                  <div
                    className="[&_a]:text-sky-400 [&_a]:underline [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                    // Trusted single-author content authored via OverviewNoteEditor.
                    dangerouslySetInnerHTML={{ __html: note.html as string }}
                  />
                ) : (
                  <p className="text-muted-foreground">No note yet for this photo.</p>
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={startEditing}
                  className="gap-1.5"
                >
                  <Pencil className="size-3.5" />
                  {hasNote ? "Edit note" : "Add note"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
