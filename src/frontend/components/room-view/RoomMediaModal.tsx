import { ArrowRightLeft, ChevronDown, Home, Images, Layers, Sparkles } from "lucide-react";
import React, { useId, useMemo, useState } from "react";

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
import type { MediaKind, MediaViewMode, RoomDetailPayload, RoomImage } from "./types";

/**
 * RoomMediaModal — the room's photo viewer + image-management surface
 * (Round 3b — T3.6 / T3.8 / T3.9), opened by the hero's "Listing photos" /
 * "Inspiration photos" buttons and re-worked for feature 0005's inspiration
 * SCOPE segregation (REVISIONS.md).
 *
 * Responsibilities:
 *   - LISTING mode (unchanged): shows `detail.listingImages` and lets the user
 *     switch layout (Gallery / Masonry / List — Bento removed).
 *   - INSPIRATION mode (NEW): segregates inspiration by scope so a room's own
 *     inspo is never drowned by floor/home-wide photos (interior doors,
 *     flooring, etc.):
 *       • `inspirationDirect` (scope='room') renders as the PROMINENT main grid.
 *       • `inspirationLevel` (scope='level', this floor) + `inspirationHome`
 *         (scope='home', whole home) render in a COLLAPSIBLE appendix BELOW the
 *         main grid, COLLAPSED BY DEFAULT, each group labeled. The header badge
 *         and the bucket toggle count reflect DIRECT inspiration only (matching
 *         the hero badge); the shared total is shown as a quiet "+N shared" hint.
 *   - Delegates tiles to `MediaGrid` (per-image delete/unmap menu + duplicate
 *     badge). Hosts "Move / reassign photos" (operates on the current bucket;
 *     for inspiration that is the room's DIRECT photos only).
 *   - Dual close affordance: the Dialog's built-in X plus an explicit Close.
 *   - Forwards one `onRefresh()` to every mutation path.
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

/**
 * Local augmentation of the detail payload for the three inspiration buckets the
 * API now returns (REVISIONS.md inspiration-scope feature). Declared here rather
 * than edited into the shared `types.ts` (owned by a parallel agent). Each bucket
 * is optional + defaulted to `[]` at read time so the modal degrades cleanly if
 * it ever renders against an older payload that only sent `inspirationalImages`.
 */
type DetailWithScope = RoomDetailPayload & {
  /** scope='room' — explicitly mapped to THIS room. The prominent main grid. */
  inspirationDirect?: RoomImage[];
  /** scope='level' — applies to every room on this floor. Appendix group. */
  inspirationLevel?: RoomImage[];
  /** scope='home' — applies to the entire home. Appendix group. */
  inspirationHome?: RoomImage[];
};

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
  // The level/home appendix starts COLLAPSED so a room's direct inspo leads.
  const [appendixOpen, setAppendixOpen] = useState(false);
  const appendixPanelId = useId();

  // Resolve the three inspiration buckets defensively (older payloads only sent
  // the flat `inspirationalImages`, which the API now keeps equal to direct).
  // Memoized so the `?? []` fallbacks don't mint a new array reference every
  // render (which would defeat downstream memoization and churn the grids).
  const scoped = detail as DetailWithScope;
  const { inspirationDirect, inspirationLevel, inspirationHome } = useMemo(
    () => ({
      inspirationDirect: scoped.inspirationDirect ?? detail.inspirationalImages ?? [],
      inspirationLevel: scoped.inspirationLevel ?? [],
      inspirationHome: scoped.inspirationHome ?? [],
    }),
    [scoped.inspirationDirect, scoped.inspirationLevel, scoped.inspirationHome, detail.inspirationalImages],
  );
  const sharedCount = inspirationLevel.length + inspirationHome.length;

  // The active main grid: all listing photos, else the room's DIRECT inspo.
  const images = kind === "listing" ? detail.listingImages : inspirationDirect;

  // Bucket-toggle + header counts. Inspiration count is DIRECT-only so it
  // matches the hero badge and never inflates with floor/home-wide photos.
  const listingCount = detail.listingImages.length;
  const inspirationCount = inspirationDirect.length;
  const isInspiration = kind === "inspiration";
  const floorName = detail.room.floorName?.trim() || "this floor";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[88svh] w-full flex-col overflow-hidden sm:max-w-3xl lg:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isInspiration ? <Sparkles className="size-4" /> : <Images className="size-4" />}
              {isInspiration ? "Inspiration photos" : "Listing photos"}
              <Badge variant="secondary">{isInspiration ? inspirationCount : listingCount}</Badge>
              {isInspiration && sharedCount > 0 ? (
                <span className="text-xs font-normal text-muted-foreground">+{sharedCount} shared</span>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {isInspiration
                ? `${detail.room.displayName} — this room's inspiration. Floor- and home-wide photos are tucked below.`
                : `${detail.room.displayName} — switch the bucket or layout that reads best.`}
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

          {/* Management toolbar (homeowner-gated). For inspiration this moves the
              room's DIRECT photos only — floor/home-wide photos are managed from
              their own scope, not reassigned out of a single room here. */}
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
            {/* Main grid: listing photos, or the room's DIRECT inspiration. */}
            <MediaGrid
              images={images}
              view={view}
              kind={kind}
              roomId={detail.room.id}
              roomDisplayName={detail.room.displayName}
              accessAuthenticated={accessAuthenticated}
              onChanged={onRefresh}
            />

            {/* Inspiration-only: collapsible appendix for floor/home-wide photos.
                Collapsed by default so the room's own inspo always leads. */}
            {isInspiration && sharedCount > 0 ? (
              <div className="mt-5">
                <button
                  type="button"
                  aria-expanded={appendixOpen}
                  aria-controls={appendixPanelId}
                  onClick={() => setAppendixOpen((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/30 ring-1 ring-foreground/10"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      Applies to the whole {floorName} / whole home
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {sharedCount} shared inspiration{" "}
                      {sharedCount === 1 ? "photo" : "photos"} mapped beyond this room
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{sharedCount}</Badge>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-4 text-muted-foreground transition-transform",
                        appendixOpen && "rotate-180",
                      )}
                    />
                  </span>
                </button>

                {appendixOpen ? (
                  <div id={appendixPanelId} className="mt-4 space-y-6">
                    <ScopeGroup
                      icon={<Layers className="size-4" aria-hidden="true" />}
                      title={`Whole ${floorName}`}
                      caption="Selected for every room on this floor (e.g. flooring)."
                      images={inspirationLevel}
                      view={view}
                      roomId={detail.room.id}
                      roomDisplayName={detail.room.displayName}
                      accessAuthenticated={accessAuthenticated}
                      onChanged={onRefresh}
                    />
                    <ScopeGroup
                      icon={<Home className="size-4" aria-hidden="true" />}
                      title="Whole home"
                      caption="Selected for the entire home (e.g. interior doors)."
                      images={inspirationHome}
                      view={view}
                      roomId={detail.room.id}
                      roomDisplayName={detail.room.displayName}
                      accessAuthenticated={accessAuthenticated}
                      onChanged={onRefresh}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Explicit bottom-right Close (the X top-right is rendered by Dialog). */}
          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move / reassign journey, scoped to the current bucket (inspiration =
          the room's DIRECT photos, surfaced via detail.inspirationalImages). */}
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

/**
 * A single labeled group inside the inspiration appendix (level or home scope).
 * Renders nothing when empty so the appendix only shows groups that exist. The
 * group reuses `MediaGrid` (same tiles, duplicate badges, per-image menu) so the
 * shared photos behave exactly like the main grid — just visually nested under a
 * scope header that explains why they appear in this room.
 */
function ScopeGroup(props: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  images: RoomImage[];
  view: MediaViewMode;
  roomId: number;
  roomDisplayName: string;
  accessAuthenticated: boolean;
  onChanged: () => void;
}) {
  const { icon, title, caption, images, view, roomId, roomDisplayName, accessAuthenticated, onChanged } =
    props;

  if (images.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="secondary">{images.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
      <MediaGrid
        images={images}
        view={view}
        kind="inspiration"
        roomId={roomId}
        roomDisplayName={roomDisplayName}
        accessAuthenticated={accessAuthenticated}
        onChanged={onChanged}
      />
    </section>
  );
}

export default RoomMediaModal;
