import { ArrowRightLeft, CheckCircle2, Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoomSelect } from "@/components/ui/room-select";
import { cn } from "@/lib/utils";
import { addInspirationRoom, reassignListingImage } from "./media-image-api";
import { MediaThumbGrid } from "./media-thumb-grid";
import type { MediaKind, RoomDetailPayload, RoomImage } from "./types";

/**
 * MovePhotosModal — the "Move / reassign photos to the correct room" journey
 * (Round 3b — T3.9 / IMPLEMENTATION_PLAN §7.9), launched from the Room Media
 * modal's "Move / reassign photos" button.
 *
 * Flow:
 *   1. Thumbnail multi-select of the current room's `kind` photos (listing OR
 *      inspiration), rendered by `MediaThumbGrid`.
 *   2. A target-room picker built on the shared `<RoomSelect>` (0005 §C4): no
 *      default selection, floor-grouped + searchable, ACTIVE rooms only, and the
 *      trigger shows the room DISPLAY NAME (never the id). RoomSelect fetches the
 *      catalog itself; the current room is hidden via `excludeRoomId` so moving a
 *      photo onto its own room (a no-op) is impossible.
 *   3. Apply, with per-photo progress:
 *        • LISTING → single-room reassign per selected image via
 *          `PUT /api/images/:id` `{ roomId: <targetId> }`.
 *        • INSPIRATION → ADD the target to each image's existing mapping set via
 *          `PUT /api/images/:id` `{ roomIds: [...current, targetId] }` (read
 *          live first; see `media-image-api.addInspirationRoom`).
 *   4. On completion → toast summarizing successes/failures + `onMoved()` so the
 *      source room's counts refresh (the target updates on its next visit).
 *
 * The current room is excluded from the target picker (moving to the same room
 * is a no-op for listing and already-mapped for inspiration). Mutations require
 * homeowner auth, gated by `accessAuthenticated`.
 *
 * Prop contract (FIXED by Round 3a — never changed here):
 *   open, onOpenChange, kind, detail, onMoved
 * `accessAuthenticated` is layered on so the Apply action can be gated without
 * altering the Round-3a signature (it defaults to false → read-only).
 */
export interface MovePhotosModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: MediaKind;
  detail: RoomDetailPayload;
  onMoved: () => void;
  /** Gate the Apply action behind homeowner auth (defaults to read-only). */
  accessAuthenticated?: boolean;
}

export function MovePhotosModal({
  open,
  onOpenChange,
  kind,
  detail,
  onMoved,
  accessAuthenticated = false,
}: MovePhotosModalProps) {
  const sourceImages: RoomImage[] = useMemo(
    () => (kind === "listing" ? detail.listingImages : detail.inspirationalImages),
    [detail.inspirationalImages, detail.listingImages, kind],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Destination room id (null = nothing chosen yet). Fed by <RoomSelect>.
  const [targetRoomId, setTargetRoomId] = useState<number | null>(null);

  // Move progress: total selected, count completed, and a running failure list.
  const [moving, setMoving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [doneSummary, setDoneSummary] = useState<{ moved: number; failed: number } | null>(null);

  // Reset transient state whenever the modal opens (or the bucket changes).
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setTargetRoomId(null);
    setProgress({ done: 0, total: 0 });
    setDoneSummary(null);
  }, [open, kind]);

  const toggleSelection = useCallback((imageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(sourceImages.map((image) => image.id)));
  }, [sourceImages]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const canApply =
    accessAuthenticated && !moving && selectedIds.size > 0 && targetRoomId != null;

  const handleApply = useCallback(async () => {
    const target = targetRoomId;
    if (target == null || !Number.isFinite(target) || target <= 0) {
      toast.error("Choose a destination room first.");
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error("Select at least one photo to move.");
      return;
    }

    setMoving(true);
    setDoneSummary(null);
    setProgress({ done: 0, total: ids.length });

    let moved = 0;
    let failed = 0;
    const targetLabel = "the selected room";

    // Sequential so each PUT is independent and one failure never aborts the
    // rest; inspiration moves also read each image's live mapping in turn.
    for (const imageId of ids) {
      const result =
        kind === "listing"
          ? await reassignListingImage(imageId, target)
          : await addInspirationRoom(imageId, target);
      if (result.ok) {
        moved += 1;
      } else {
        failed += 1;
        toast.error(result.error);
      }
      setProgress((current) => ({ done: current.done + 1, total: current.total }));
    }

    setMoving(false);
    setDoneSummary({ moved, failed });

    if (moved > 0) {
      toast.success(
        failed === 0
          ? `Moved ${moved} photo${moved === 1 ? "" : "s"} to ${targetLabel}.`
          : `Moved ${moved} photo${moved === 1 ? "" : "s"} to ${targetLabel}; ${failed} failed.`,
      );
      onMoved();
    } else if (failed > 0) {
      toast.error("No photos could be moved.");
    }
  }, [kind, onMoved, selectedIds, targetRoomId]);

  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Lock the modal closed while a move is mid-flight.
        if (moving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[88svh] w-full flex-col overflow-hidden sm:max-w-2xl lg:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="size-4" />
            Move / reassign {kind} photos
          </DialogTitle>
          <DialogDescription>
            Pick photos from {detail.room.displayName} and choose where they should live.
            {kind === "inspiration"
              ? " Inspiration photos are linked to the destination in addition to their current rooms."
              : " Listing photos move to a single destination room."}
          </DialogDescription>
        </DialogHeader>

        {!accessAuthenticated ? (
          <div className="rounded-xl bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
            Sign in as the homeowner to move or reassign photos.
          </div>
        ) : (
          <>
            {/* Selection toolbar. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {selectedIds.size} of {sourceImages.length} selected
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  disabled={moving || sourceImages.length === 0}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={moving || selectedIds.size === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            {/* Selectable thumbnails. */}
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <MediaThumbGrid
                images={sourceImages}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                fallbackTitle={detail.room.displayName}
                disabled={moving}
              />
            </div>

            {/* Destination picker — shared <RoomSelect> (§C4): floor-grouped,
                searchable, active-only, no default; the source room is hidden. */}
            <div className="space-y-1.5">
              <label htmlFor="move-target-room" className="text-sm font-medium">
                Destination room
              </label>
              <RoomSelect
                id="move-target-room"
                value={targetRoomId}
                onChange={setTargetRoomId}
                excludeRoomId={detail.room.id}
                disabled={moving}
                placeholder="Select a destination room"
                aria-label="Destination room"
                className="w-full"
              />
            </div>

            {/* Live progress / completion summary. */}
            {moving || doneSummary ? (
              <div className="space-y-2 rounded-xl bg-muted/20 p-3 ring-1 ring-foreground/10">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {moving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Moving photos... please don&apos;t close this window.
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4 text-primary" />
                        {doneSummary?.moved ?? 0} moved
                        {doneSummary && doneSummary.failed > 0 ? `, ${doneSummary.failed} failed` : ""}
                      </>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className={cn(
                      "h-full rounded-full bg-primary transition-all duration-300",
                      !moving && doneSummary && doneSummary.failed > 0 && "bg-destructive",
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
            {doneSummary ? "Close" : "Cancel"}
          </Button>
          {accessAuthenticated ? (
            <Button onClick={() => void handleApply()} disabled={!canApply}>
              {moving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="size-4" />
              )}
              Move {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}photo
              {selectedIds.size === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MovePhotosModal;
