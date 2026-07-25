// ---------------------------------------------------------------------------
// SampleDrawer — the bottom drawer of everything you can drop on the canvas
// WITHOUT it living there permanently (Slice-1 feedback #2). Only blank-canvas
// seeds sit on the canvas itself; whole listing/inspiration photos and material
// samples live here, in four tabs:
//
//   • Listing     — this room's listing photos (board.listingPhotos)
//   • Inspiration — this room's inspiration photos (board.inspirationPhotos)
//   • Samples     — this room's clippings (isGlobal === false)
//   • Global      — house-wide clippings promoted for every room (isGlobal true)
//
// Every tile: image + label. Actions per tile: "Place on canvas" (POST a node),
// and — on Inspiration tiles — "Extract clipping…" (opens ExtractClippingDialog
// against that photo). Samples tiles can be moved to Global; Global tiles can be
// made room-only (optimistic PATCH via the parent, with toast + rollback). Every
// tile stays drag-to-canvas (DRAG_MIME) from every tab.
//
// Motion is a §8 drawer-reveal tamed to Monolith: a spring slide-up that honors
// prefers-reduced-motion (instant, static equivalents). Skeletons, not spinners.
// ---------------------------------------------------------------------------

import type * as React from "react";
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronUp,
  Globe,
  Home,
  Image as ImageIcon,
  Layers,
  Map,
  MoreVertical,
  Scissors,
  Sparkles,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { DRAG_MIME, type DragPayload } from "../piles/PilesRail";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  boardPhotoAltText,
  clippingAltText,
  type BoardPhoto,
  type Clipping,
} from "../types";

type TabKey = "listing" | "inspiration" | "renders" | "plan" | "samples" | "global";

interface SampleDrawerProps {
  /** Controlled open state (so the canvas "Place image" tool can open it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  listingPhotos: BoardPhoto[];
  inspirationPhotos: BoardPhoto[];
  renderPhotos: BoardPhoto[];
  floorPlanPhotos: BoardPhoto[];
  clippings: Clipping[];
  /** Place a whole listing photo onto the canvas as a listing_photo node. */
  onPlaceListing: (photo: BoardPhoto) => void;
  /** Place a whole inspiration photo onto the canvas as an inspiration node. */
  onPlaceInspiration: (photo: BoardPhoto) => void;
  /** Place a whole render onto the canvas as a render node. */
  onPlaceRender: (photo: BoardPhoto) => void;
  /** Place the floor plan onto the canvas as a floor_plan node. */
  onPlaceFloorPlan: (photo: BoardPhoto) => void;
  /** Place a clipping onto the canvas as a clipping node. */
  onPlaceClipping: (clipping: Clipping) => void;
  /** Open the extraction dialog against an inspiration photo. */
  onExtractFromInspiration: (photo: BoardPhoto) => void;
  /** Flip a clipping's global membership (optimistic in the parent). */
  onSetClippingGlobal: (clipping: Clipping, isGlobal: boolean) => void;
}

const SPRING = { type: "spring" as const, stiffness: 200, damping: 25 };

const TABS: Array<{ key: TabKey; label: string; icon: typeof Home }> = [
  { key: "listing", label: "Listing", icon: Home },
  { key: "inspiration", label: "Inspiration", icon: Sparkles },
  { key: "renders", label: "Renders", icon: ImageIcon },
  { key: "plan", label: "Plan", icon: Map },
  { key: "samples", label: "Samples", icon: Scissors },
  { key: "global", label: "Global", icon: Globe },
];

export function SampleDrawer({
  open: openProp,
  onOpenChange,
  listingPhotos,
  inspirationPhotos,
  renderPhotos,
  floorPlanPhotos,
  clippings,
  onPlaceListing,
  onPlaceInspiration,
  onPlaceRender,
  onPlaceFloorPlan,
  onPlaceClipping,
  onExtractFromInspiration,
  onSetClippingGlobal,
}: SampleDrawerProps) {
  const reduced = useReducedMotion();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = useCallback(
    (next: boolean | ((v: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(open) : next;
      if (onOpenChange) onOpenChange(resolved);
      else setOpenInternal(resolved);
    },
    [onOpenChange, open],
  );
  const [tab, setTab] = useState<TabKey>("listing");

  const roomClippings = clippings.filter((c) => !c.isGlobal);
  const globalClippings = clippings.filter((c) => c.isGlobal);

  const countFor = (key: TabKey): number => {
    switch (key) {
      case "listing":
        return listingPhotos.length;
      case "inspiration":
        return inspirationPhotos.length;
      case "renders":
        return renderPhotos.length;
      case "plan":
        return floorPlanPhotos.length;
      case "samples":
        return roomClippings.length;
      case "global":
        return globalClippings.length;
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center">
      {/* Handle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the drawer" : "Open the drawer"}
        className="pointer-events-auto mb-0 flex items-center gap-2 rounded-t-lg bg-card/90 px-4 py-1.5 text-[12px] text-foreground/80 shadow-lg ring-1 ring-border/40 backdrop-blur outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Layers className="size-3.5" />
        Drawer
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {listingPhotos.length +
            inspirationPhotos.length +
            renderPhotos.length +
            floorPlanPhotos.length +
            clippings.length}
        </span>
        <ChevronUp
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { height: "auto" } : { y: 320 }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: 320 }}
            transition={reduced ? { duration: 0 } : SPRING}
            className="pointer-events-auto flex max-h-[46vh] w-full flex-col bg-card/95 shadow-2xl ring-1 ring-border/40 backdrop-blur"
          >
            {/* Tab bar (roles for a11y; no 1px borders — ring divider). */}
            <div
              role="tablist"
              aria-label="Drawer contents"
              className="flex shrink-0 items-center gap-1 px-3 py-2 ring-1 ring-inset ring-border/30"
            >
              {TABS.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {countFor(key)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Panel */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {tab === "listing" ? (
                <PhotoGrid
                  photos={listingPhotos}
                  kind="listing_photo"
                  reduced={reduced}
                  onPlace={onPlaceListing}
                  emptyIcon={Home}
                  emptyTitle="No listing photos"
                  emptyBody="Listing photos for this room show up here — place them on the canvas to start from what the space looks like today."
                />
              ) : tab === "inspiration" ? (
                <PhotoGrid
                  photos={inspirationPhotos}
                  kind="inspiration"
                  reduced={reduced}
                  onPlace={onPlaceInspiration}
                  onExtract={onExtractFromInspiration}
                  emptyIcon={Sparkles}
                  emptyTitle="No inspiration yet"
                  emptyBody="Save inspiration photos to this room and they’ll land here — place one on the canvas, or extract a sample from it."
                />
              ) : tab === "renders" ? (
                <PhotoGrid
                  photos={renderPhotos}
                  kind="render"
                  reduced={reduced}
                  onPlace={onPlaceRender}
                  emptyIcon={ImageIcon}
                  emptyTitle="No renders yet"
                  emptyBody="This room’s AI and SketchUp renders show up here — place one on the canvas to restyle it or make it photoreal."
                />
              ) : tab === "plan" ? (
                <PhotoGrid
                  photos={floorPlanPhotos}
                  kind="floor_plan"
                  reduced={reduced}
                  onPlace={onPlaceFloorPlan}
                  emptyIcon={Map}
                  emptyTitle="No floor plan"
                  emptyBody="The house floor plan shows up here — place it on the canvas and furnish it."
                />
              ) : tab === "samples" ? (
                <ClippingGrid
                  clippings={roomClippings}
                  reduced={reduced}
                  onPlace={onPlaceClipping}
                  menu={(clip) => (
                    <TileMenu
                      label="Move to Global"
                      icon={Globe}
                      onSelect={() => onSetClippingGlobal(clip, true)}
                    />
                  )}
                  emptyIcon={Scissors}
                  emptyTitle="No samples yet"
                  emptyBody="Extract a sample from an inspiration photo — the tile, stone, or finish — and it’ll be saved here for this room."
                />
              ) : (
                <ClippingGrid
                  clippings={globalClippings}
                  reduced={reduced}
                  onPlace={onPlaceClipping}
                  menu={(clip) => (
                    <TileMenu
                      label="Make room-only"
                      icon={Home}
                      onSelect={() => onSetClippingGlobal(clip, false)}
                    />
                  )}
                  emptyIcon={Globe}
                  emptyTitle="No house-wide samples"
                  emptyBody="Samples you mark “available in all rooms” — like a paint color you’ll reuse house-wide — collect here and show up in every room."
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------

function PhotoGrid({
  photos,
  kind,
  reduced,
  onPlace,
  onExtract,
  emptyIcon,
  emptyTitle,
  emptyBody,
}: {
  photos: BoardPhoto[];
  kind: "listing_photo" | "inspiration" | "render" | "floor_plan";
  reduced: boolean;
  onPlace: (photo: BoardPhoto) => void;
  onExtract?: (photo: BoardPhoto) => void;
  emptyIcon: typeof Home;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (photos.length === 0) {
    return (
      <EmptyState icon={emptyIcon} title={emptyTitle} body={emptyBody} />
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
      <AnimatePresence initial={false}>
        {photos.map((photo, index) => (
          <TileShell
            key={photo.sourceId}
            index={index}
            reduced={reduced}
            imageUrl={photo.cfImageUrl}
            alt={boardPhotoAltText(photo, kind)}
            label={photo.label}
            dragPayload={{
              cfImageUrl: photo.cfImageUrl,
              sourceType: kind,
              sourceId: photo.sourceId,
            }}
            onPlace={() => onPlace(photo)}
            objectFit="cover"
            extraAction={
              onExtract
                ? {
                    label: "Extract clipping…",
                    icon: Scissors,
                    onSelect: () => onExtract(photo),
                  }
                : undefined
            }
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ClippingGrid({
  clippings,
  reduced,
  onPlace,
  menu,
  emptyIcon,
  emptyTitle,
  emptyBody,
}: {
  clippings: Clipping[];
  reduced: boolean;
  onPlace: (clipping: Clipping) => void;
  menu: (clipping: Clipping) => React.ReactNode;
  emptyIcon: typeof Home;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (clippings.length === 0) {
    return (
      <EmptyState icon={emptyIcon} title={emptyTitle} body={emptyBody} />
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
      <AnimatePresence initial={false}>
        {clippings.map((clip, index) => (
          <TileShell
            key={clip.id}
            index={index}
            reduced={reduced}
            imageUrl={clip.clippingCfImageUrl}
            alt={clippingAltText(clip)}
            label={clip.label || "Untitled sample"}
            dragPayload={{
              cfImageUrl: clip.clippingCfImageUrl,
              sourceType: "clipping",
              sourceId: clip.id,
            }}
            onPlace={() => onPlace(clip)}
            objectFit="contain"
            menu={menu(clip)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

function TileShell({
  index,
  reduced,
  imageUrl,
  alt,
  label,
  dragPayload,
  onPlace,
  objectFit,
  extraAction,
  menu,
}: {
  index: number;
  reduced: boolean;
  imageUrl: string;
  alt: string;
  label: string | null;
  dragPayload: DragPayload;
  onPlace: () => void;
  objectFit: "cover" | "contain";
  extraAction?: { label: string; icon: typeof Home; onSelect: () => void };
  menu?: React.ReactNode;
}) {
  const setDragData = (event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragPayload));
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      transition={
        reduced ? { duration: 0 } : { ...SPRING, delay: Math.min(index, 6) * 0.04 }
      }
      className="group relative flex flex-col overflow-hidden rounded-lg bg-background ring-1 ring-border/40 transition-shadow hover:ring-border"
    >
      {/* The image doubles as the drag source AND the "place on canvas" click. */}
      <button
        type="button"
        draggable
        onDragStart={setDragData}
        onClick={onPlace}
        aria-label={`Place ${label ?? alt} on the canvas`}
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="aspect-square w-full overflow-hidden bg-foreground/[0.02]">
          <img
            src={imageUrl}
            alt={alt}
            className={cn(
              "size-full",
              objectFit === "cover" ? "object-cover" : "object-contain",
            )}
            draggable={false}
            loading="lazy"
          />
        </div>
      </button>

      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {label || "Untitled"}
        </span>
        {(extraAction || menu) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[11rem]">
              <DropdownMenuItem onClick={onPlace}>
                <Layers className="size-3.5" />
                Place on canvas
              </DropdownMenuItem>
              {extraAction ? (
                <DropdownMenuItem onClick={extraAction.onSelect}>
                  <extraAction.icon className="size-3.5" />
                  {extraAction.label}
                </DropdownMenuItem>
              ) : null}
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </motion.div>
  );
}

/** A single menu action for a clipping tile (Move to Global / Make room-only). */
function TileMenu({
  label,
  icon: Icon,
  onSelect,
}: {
  label: string;
  icon: typeof Home;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onSelect}>
      <Icon className="size-3.5" />
      {label}
    </DropdownMenuItem>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Home;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-foreground/[0.04] ring-1 ring-border/40">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

export default SampleDrawer;
