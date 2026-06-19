import { ArrowRightLeft, Images, Sparkles } from "lucide-react";
import React, { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MediaGrid } from "./media-grid";
import { MovePhotosModal } from "./MovePhotosModal";
import type { MediaKind, MediaViewMode, RoomDetailPayload } from "./types";

/**
 * RoomMediaModal — the room's photo viewer + image-management surface
 * (Round 3b — T3.6 / T3.8 / T3.9 / IMPLEMENTATION_PLAN §7.6, §7.9), opened by
 * the hero's "Listing photos" / "Inspiration photos" buttons.
 *
 * Responsibilities:
 *   - Shows ONLY the `kind` bucket (listing → `detail.listingImages`;
 *     inspiration → `detail.inspirationalImages`) and lets the user switch
 *     buckets + layout (Gallery / Masonry / List — Bento is removed entirely).
 *   - Delegates the tiles to `MediaGrid`, which surfaces a per-image
 *     `ImageActions` menu (delete / unmap) and a `Duplicate` badge on each
 *     `image.isDuplicate` photo.
 *   - Hosts a "Move / reassign photos" button that opens `MovePhotosModal`
 *     pre-filtered to the current bucket.
 *   - Provides the spec's dual close affordance: the Dialog's built-in X
 *     (top-right) plus an explicit Close button (bottom-right).
 *   - Forwards a single `onRefresh()` to every mutation path so the orchestrator
 *     re-fetches the detail payload (counts + lists) after any change.
 *
 * Prop contract (FIXED by Round 3a — never changed here):
 *   open, onOpenChange, kind, onKindChange, detail, accessAuthenticated, onRefresh
 */
export interface RoomMediaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: MediaKind;
  onKindChange: (kind: MediaKind) => void;
  detail: RoomDetailPayload;
  accessAuthenticated: boolean;
  onRefresh: () => void;
}

const VIEW_MODES: MediaViewMode[] = ["gallery", "masonry", "list"];

export function RoomMediaModal({
  open,
  onOpenChange,
  kind,
  onKindChange,
  detail,
  accessAuthenticated,
  onRefresh,
}: RoomMediaModalProps) {
  const [view, setView] = useState<MediaViewMode>("gallery");
  const [moveOpen, setMoveOpen] = useState(false);

  const images = useMemo(
    () => (kind === "listing" ? detail.listingImages : detail.inspirationalImages),
    [detail.inspirationalImages, detail.listingImages, kind],
  );

  const listingCount = detail.listingImages.length;
  const inspirationCount = detail.inspirationalImages.length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[88svh] w-full flex-col overflow-hidden sm:max-w-3xl lg:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {kind === "listing" ? <Images className="size-4" /> : <Sparkles className="size-4" />}
              {kind === "listing" ? "Listing photos" : "Inspiration photos"}
              <Badge variant="secondary">{images.length}</Badge>
            </DialogTitle>
            <DialogDescription>
              {detail.room.displayName} — switch the bucket or layout that reads best.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Listing / Inspiration bucket toggle (badges show live counts). */}
            <div className="inline-flex rounded-lg bg-muted/30 p-1 ring-1 ring-foreground/10">
              {(["listing", "inspiration"] as MediaKind[]).map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  aria-pressed={kind === bucket}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    kind === bucket ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                  onClick={() => onKindChange(bucket)}
                >
                  {bucket}
                  <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                    {bucket === "listing" ? listingCount : inspirationCount}
                  </span>
                </button>
              ))}
            </div>

            {/* View-mode toggle (Bento removed). */}
            <div className="inline-flex rounded-lg bg-muted/30 p-1 ring-1 ring-foreground/10">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  className={cn(
                    "rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                  onClick={() => setView(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Management toolbar (homeowner-gated). */}
          {accessAuthenticated ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Right-click is off — use each photo&apos;s menu to delete, or move many at once.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMoveOpen(true)}
                disabled={images.length === 0}
              >
                <ArrowRightLeft className="size-4" />
                Move / reassign photos
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <MediaGrid
              images={images}
              view={view}
              kind={kind}
              roomId={detail.room.id}
              roomDisplayName={detail.room.displayName}
              accessAuthenticated={accessAuthenticated}
              onChanged={onRefresh}
            />
          </div>

          {/* Explicit bottom-right Close (the X top-right is rendered by Dialog). */}
          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move / reassign journey, scoped to the current bucket. */}
      <MovePhotosModal
        open={moveOpen}
        onOpenChange={setMoveOpen}
        kind={kind}
        detail={detail}
        accessAuthenticated={accessAuthenticated}
        onMoved={onRefresh}
      />
    </>
  );
}

export default RoomMediaModal;
