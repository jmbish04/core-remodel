/**
 * PhotoCollectionViewport — Mac Preview-style image viewer for a single room.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Hero header: room name · viewer type badge · floor/zone   │
 *   ├──────────┬──────────────────────────────────────────────────┤
 *   │ Thumbs   │  Large preview of selected image                │
 *   │ (left)   │                                                  │
 *   │          │  ── metadata cards (tags, notes, highlights) ──  │
 *   │          │  ── contractor feedback section ──               │
 *   │          │                                                  │
 *   └──────────┴──────────────────────────────────────────────────┘
 *
 * This is a READ-ONLY viewer for contractors and professionals. The only
 * write operation is leaving feedback notes (via the photo_viewer_notes API).
 *
 * Monolith dark: ring/divide separation, no traditional borders, zinc base.
 */

import {
  ArrowLeft,
  Camera,
  Layers,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Send,
  Tag,
  StickyNote,
  Sparkles,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ViewportImage {
  id: string;
  name: string;
  path: string;
  tags: string[];
  note: string;
  highlights: Array<{
    highlightType: "like" | "dislike";
    note?: string | null;
  }>;
  createdAt: string;
}

export interface ViewerNote {
  id: number;
  imageId: string;
  authorName: string | null;
  authorRole: string | null;
  noteText: string;
  datetimeCreated: string | number | Date;
}

export interface PhotoCollectionViewportProps {
  /** The room's display name. */
  roomName: string;
  /** The viewer type label — "Listing Photos" or "Inspiration Photos". */
  viewerType: string;
  /** Floor name for the room. */
  floorName?: string;
  /** Floor key for zone derivation. */
  floorKey?: string;
  /** The images to display. */
  images: ViewportImage[];
  /** Callback to close the viewport and return to the card grid. */
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function floorZoneLabel(floorName?: string, floorKey?: string): string {
  if (!floorName) return "Unassigned";
  const parts: string[] = [floorName];
  if (floorKey === "lower_level") parts.push("Street level");
  else if (floorKey === "upper_level") parts.push("Main living level");
  else if (floorKey === "outside") parts.push("Exterior");
  return parts.join(" · ");
}

function formatNoteDate(value: string | number | Date): string {
  const date = new Date(
    typeof value === "number" ? value * 1000 : value,
  );
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PhotoCollectionViewport({
  roomName,
  viewerType,
  floorName,
  floorKey,
  images,
  onBack,
}: PhotoCollectionViewportProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<ViewerNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [draftAuthor, setDraftAuthor] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);

  const selectedImage = useMemo(
    () => images.find((img) => img.id === selectedId) ?? null,
    [images, selectedId],
  );

  // Fetch notes when a new image is selected.
  const fetchNotes = useCallback(async (imageId: string) => {
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/images/${imageId}/viewer-notes`, {
        credentials: "include",
      });
      const payload = (await res.json()) as {
        success?: boolean;
        notes?: ViewerNote[];
      };
      if (res.ok && payload.success && Array.isArray(payload.notes)) {
        setNotes(payload.notes);
      } else {
        setNotes([]);
      }
    } catch {
      setNotes([]);
    } finally {
      setNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      void fetchNotes(selectedId);
      setDraftNote("");
    } else {
      setNotes([]);
    }
  }, [selectedId, fetchNotes]);

  const handleSaveNote = useCallback(async () => {
    if (!selectedId || !draftNote.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/images/${selectedId}/viewer-notes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorName: draftAuthor.trim() || null,
          authorRole: "contractor",
          noteText: draftNote.trim(),
        }),
      });
      const payload = (await res.json()) as {
        success?: boolean;
        note?: ViewerNote;
      };
      if (!res.ok || !payload.success || !payload.note) {
        throw new Error("Failed to save note");
      }
      setNotes((prev) => [payload.note!, ...prev]);
      setDraftNote("");
      toast.success("Note saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save note",
      );
    } finally {
      setSavingNote(false);
    }
  }, [draftAuthor, draftNote, selectedId]);

  return (
    <div className="space-y-0">
      {/* ─── Hero header ─────────────────────────────────────────── */}
      <header className="rounded-t-2xl bg-card/60 px-6 py-5 ring-1 ring-foreground/10 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                Back to rooms
              </Button>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {roomName}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                <span>{floorZoneLabel(floorName, floorKey)}</span>
              </div>
              <span className="text-foreground/20">·</span>
              <div className="flex items-center gap-1.5">
                <Camera className="size-3.5" />
                <span>
                  {images.length} {images.length === 1 ? "photo" : "photos"}
                </span>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0">
            {viewerType}
          </Badge>
        </div>
      </header>

      {/* ─── Main layout: thumbnails + preview ───────────────────── */}
      <div className="flex min-h-[70svh] gap-0 rounded-b-2xl ring-1 ring-foreground/10">
        {/* Left sidebar — thumbnail strip. */}
        <div
          ref={thumbnailContainerRef}
          className="hidden w-28 shrink-0 overflow-y-auto bg-card/40 p-2 sm:block lg:w-36"
        >
          <div className="space-y-2">
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setSelectedId(image.id)}
                className={cn(
                  "w-full overflow-hidden rounded-lg transition-all",
                  "ring-1 ring-foreground/10 hover:ring-foreground/30",
                  selectedId === image.id &&
                    "ring-2 ring-primary shadow-md shadow-primary/10",
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: CF Images delivery URL */}
                <img
                  src={image.path}
                  alt={image.name}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Mobile thumbnail strip (horizontal scroll). */}
        <div className="flex gap-2 overflow-x-auto bg-card/40 p-2 sm:hidden">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setSelectedId(image.id)}
              className={cn(
                "shrink-0 overflow-hidden rounded-lg transition-all",
                "ring-1 ring-foreground/10 hover:ring-foreground/30",
                selectedId === image.id &&
                  "ring-2 ring-primary shadow-md shadow-primary/10",
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: CF Images delivery URL */}
              <img
                src={image.path}
                alt={image.name}
                className="h-16 w-24 object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>

        {/* Right main content — preview + metadata. */}
        <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          {!selectedImage ? (
            /* Instruction state. */
            <div className="flex min-h-[50svh] flex-col items-center justify-center gap-4 rounded-2xl bg-muted/10 ring-1 ring-foreground/10">
              <Camera className="size-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-lg font-medium">
                  Select a thumbnail to preview
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Click any image on the left to view it at full size with its
                  details and metadata.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Large image preview. */}
              <div className="overflow-hidden rounded-2xl bg-black/20 ring-1 ring-foreground/10">
                {/* biome-ignore lint/performance/noImgElement: CF Images delivery URL */}
                <img
                  src={selectedImage.path}
                  alt={selectedImage.name}
                  className="mx-auto max-h-[65svh] w-full object-contain"
                />
              </div>

              {/* Image name + date. */}
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight">
                  {selectedImage.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Added {selectedImage.createdAt}
                </p>
              </div>

              {/* Tags. */}
              {selectedImage.tags.length > 0 && (
                <Card className="ring-1 ring-foreground/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Tag className="size-4 text-muted-foreground" />
                      Tags
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {selectedImage.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Notes (from coding/review). */}
              {selectedImage.note && (
                <Card className="ring-1 ring-foreground/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <StickyNote className="size-4 text-muted-foreground" />
                      Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                      {selectedImage.note}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Highlights. */}
              {selectedImage.highlights.length > 0 && (
                <Card className="ring-1 ring-foreground/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="size-4 text-muted-foreground" />
                      Highlights
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedImage.highlights.map((hl, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "rounded-lg px-3 py-2 text-sm ring-1",
                            hl.highlightType === "like"
                              ? "bg-emerald-500/5 ring-emerald-500/20 text-emerald-300"
                              : "bg-red-500/5 ring-red-500/20 text-red-300",
                          )}
                        >
                          <span className="font-medium capitalize">
                            {hl.highlightType}
                          </span>
                          {hl.note && (
                            <span className="ml-2 text-muted-foreground">
                              — {hl.note}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ─── Contractor feedback section ─────────────────── */}
              <Card className="ring-1 ring-foreground/10">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <MessageSquarePlus className="size-4 text-muted-foreground" />
                    Notes & Feedback
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* New note form. */}
                  <div className="space-y-3 rounded-xl bg-muted/10 p-4 ring-1 ring-foreground/10">
                    <Input
                      placeholder="Your name (optional)"
                      value={draftAuthor}
                      onChange={(e) => setDraftAuthor(e.target.value)}
                      className="bg-background"
                    />
                    <Textarea
                      placeholder="Share your notes, questions, or feedback about this image…"
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      rows={3}
                      className="bg-background resize-none"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={!draftNote.trim() || savingNote}
                        onClick={() => void handleSaveNote()}
                      >
                        {savingNote ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Send className="mr-2 size-4" />
                        )}
                        Save note
                      </Button>
                    </div>
                  </div>

                  {/* Existing notes. */}
                  {notesLoading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading notes…
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No notes yet — be the first to leave feedback on this
                      image.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded-xl bg-card/40 p-4 ring-1 ring-foreground/5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <User className="size-3.5 text-muted-foreground" />
                              <span className="font-medium">
                                {note.authorName || "Anonymous"}
                              </span>
                              {note.authorRole && (
                                <Badge variant="outline" className="text-[10px]">
                                  {note.authorRole}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatNoteDate(note.datetimeCreated)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                            {note.noteText}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PhotoCollectionViewport;
