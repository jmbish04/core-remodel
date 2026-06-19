import { ArrowLeft, Check, ImageIcon, Images, Loader2, Save, Sparkles } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import {
  formatDate,
  resolveImageUrl,
  type MediaKind,
  type RoomDetailPayload,
  type RoomImage,
  type RoomSummaryRecord,
} from "./types";

/**
 * HeroHeader (T3.1) — the top of the room viewport.
 *
 * Layout intent (per IMPLEMENTATION_PLAN §7.1): the room title + back link sit
 * on the left; the representative photo is rendered MUCH smaller in the
 * top-right with a "Change room hero image" button beneath it, plus two
 * media-entry buttons ("Listing photos" / "Inspiration photos") that each
 * carry a count badge and open the shared Room Media modal pre-filtered.
 *
 * The change-hero flow is a shadcn Dialog (never a browser dialog) showing
 * vertical card rows of the room's LISTING photos (thumbnail left; name + date
 * right). A check marks the current hero on open; clicking a row moves the
 * check and live-updates the small top-right thumbnail via local draft state.
 * Cancel reverts the draft; Save persists with
 * `PATCH /api/rooms/code/:roomCode/profile` body `{ representativeImageId }`,
 * shows a shadcn success toast, and asks the orchestrator to refresh.
 */
export interface HeroHeaderProps {
  /** Stable room code slug (path param for the profile PATCH). */
  roomCode: string;
  /** Full room detail payload (the single source of truth). */
  detail: RoomDetailPayload;
  /** Whether the homeowner is authenticated (gates the change-hero action). */
  accessAuthenticated: boolean;
  /**
   * Opens the shared Room Media modal pre-filtered to a media kind. The
   * orchestrator owns the modal so the hero only signals intent.
   */
  onOpenMedia: (kind: MediaKind) => void;
  /**
   * Patches the locally-held detail after a successful save so the page
   * reflects the new hero without a full reload. The orchestrator merges this
   * into its `detail` state.
   */
  onSummaryPatched: (summary: RoomSummaryRecord | null) => void;
  /** Triggers a background data refresh (no spinner takeover). */
  onRequestRefresh: () => void;
}

/** Resolves the currently-effective hero image given the detail payload. */
function resolveHeroImage(detail: RoomDetailPayload): RoomImage | null {
  return (
    detail.representativeImage ||
    detail.listingImages[0] ||
    detail.inspirationalImages[0] ||
    null
  );
}

export function HeroHeader({
  roomCode,
  detail,
  accessAuthenticated,
  onOpenMedia,
  onSummaryPatched,
  onRequestRefresh,
}: HeroHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // The hero id currently persisted (or "none" = auto-select first photo).
  const persistedHeroId = useMemo(
    () => detail.summary?.representativeImageId || detail.representativeImage?.id || "none",
    [detail.summary?.representativeImageId, detail.representativeImage?.id],
  );

  // Draft selection inside the dialog; resets to the persisted value whenever
  // the dialog is (re)opened so Cancel is always a clean revert.
  const [draftHeroId, setDraftHeroId] = useState<string>(persistedHeroId);

  useEffect(() => {
    if (dialogOpen) setDraftHeroId(persistedHeroId);
  }, [dialogOpen, persistedHeroId]);

  // The thumbnail shown top-right reflects the draft while the dialog is open
  // (live preview), otherwise the persisted hero.
  const previewImage = useMemo(() => {
    const activeId = dialogOpen ? draftHeroId : persistedHeroId;
    if (activeId && activeId !== "none") {
      const match = detail.listingImages.find((image) => image.id === activeId);
      if (match) return match;
    }
    return resolveHeroImage(detail);
  }, [detail, dialogOpen, draftHeroId, persistedHeroId]);

  const listingCount = detail.roomStats.listingPhotoCount;
  const inspirationCount = detail.roomStats.inspirationPhotoCount;
  const canChangeHero = accessAuthenticated && detail.listingImages.length > 0;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/rooms/code/${roomCode}/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          representativeImageId: draftHeroId === "none" ? null : draftHeroId,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        summary?: RoomSummaryRecord | null;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to save the room hero image");
      }
      onSummaryPatched(payload.summary ?? null);
      onRequestRefresh();
      setDialogOpen(false);
      toast.success("Room hero image updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save the room hero image");
    } finally {
      setSaving(false);
    }
  }, [draftHeroId, onRequestRefresh, onSummaryPatched, roomCode]);

  return (
    <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      {/* Left: identity + counts. */}
      <div className="min-w-0 space-y-3">
        <a
          href="/floor-plan"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to floor plan
        </a>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{detail.room.displayName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {detail.room.floorName} • {detail.room.asIsUse || "Room"} •{" "}
            {detail.room.dimensionLabel || "Dimensions pending"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{listingCount} listing photos</Badge>
          <Badge variant="secondary">{inspirationCount} inspiration photos</Badge>
          <Badge variant="secondary">{detail.roomStats.supportingDocumentCount} supporting docs</Badge>
          <Badge variant="secondary">{detail.roomStats.visionNodeCount} vision nodes</Badge>
        </div>
      </div>

      {/* Right: small hero thumbnail + actions. */}
      <div className="flex w-full shrink-0 flex-col gap-3 sm:max-w-xs lg:w-72">
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {previewImage ? (
            // biome-ignore lint/performance/noImgElement: external delivery urls are expected
            <img
              src={resolveImageUrl(previewImage)}
              alt={previewImage.displayName || detail.room.displayName}
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-muted/20 text-center">
              <ImageIcon className="size-5 text-muted-foreground" />
              <p className="px-4 text-xs text-muted-foreground">No representative image yet.</p>
            </div>
          )}
        </div>

        {canChangeHero ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setDialogOpen(true)}>
            <Sparkles className="mr-2 size-4" />
            Change room hero image
          </Button>
        ) : accessAuthenticated ? (
          <p className="text-xs text-muted-foreground">
            Add at least one listing photo to choose a hero image.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Homeowner access is required to change the hero image.
          </p>
        )}

        {/* Media-entry buttons with live count badges. */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="justify-between"
            onClick={() => onOpenMedia("listing")}
          >
            <span className="flex items-center gap-2">
              <Images className="size-4" />
              Listing
            </span>
            <Badge variant="secondary">{listingCount}</Badge>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-between"
            onClick={() => onOpenMedia("inspiration")}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Inspiration
            </span>
            <Badge variant="secondary">{inspirationCount}</Badge>
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85svh] w-full overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change room hero image</DialogTitle>
            <DialogDescription>
              Pick the listing photo that best represents this room. The current hero is marked with
              a check.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 max-h-[55svh] space-y-2 overflow-y-auto px-1 py-1">
            {/* "Auto-select" row so the user can clear an explicit hero. */}
            <HeroChoiceRow
              selected={draftHeroId === "none"}
              title="Auto-select first room photo"
              subtitle="Let the app pick the first available listing photo"
              onSelect={() => setDraftHeroId("none")}
            />
            {detail.listingImages.map((image) => (
              <HeroChoiceRow
                key={image.id}
                selected={draftHeroId === image.id}
                imageUrl={resolveImageUrl(image)}
                title={image.displayName?.trim() || "Untitled listing photo"}
                subtitle={formatDate(image.datetimeCreated)}
                onSelect={() => setDraftHeroId(image.id)}
              />
            ))}
          </div>

          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl bg-muted/50 p-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || draftHeroId === persistedHeroId}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              Save hero image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}

/**
 * A single selectable hero candidate row: thumbnail on the left, name + date on
 * the right, and a check badge on the right edge when selected. Rendered as a
 * real button for keyboard accessibility.
 */
function HeroChoiceRow(props: {
  selected: boolean;
  title: string;
  subtitle: string;
  imageUrl?: string;
  onSelect: () => void;
}) {
  const { selected, title, subtitle, imageUrl, onSelect } = props;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors",
        selected ? "bg-primary/10 ring-1 ring-primary/40" : "bg-card hover:bg-muted/40 ring-1 ring-foreground/10",
      )}
    >
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted/30">
        {imageUrl ? (
          // biome-ignore lint/performance/noImgElement: external delivery urls are expected
          <img src={imageUrl} alt={title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageIcon className="size-5 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
          selected ? "bg-primary text-primary-foreground" : "bg-muted/40 text-transparent",
        )}
      >
        <Check className="size-4" />
      </span>
    </button>
  );
}

export default HeroHeader;
