/**
 * @fileoverview FloorplanViewer — reusable floorplan canvas with pluggable markers
 * AND zone/mask overlays.
 *
 * This shared component renders the combined floorplan image (lower + upper level
 * side-by-side) and allows ANY domain — rooms, materials, showroom products, etc. —
 * to overlay two kinds of visuals:
 *
 *   1. **Markers** (`FloorplanMarker[]`) — point dots at `xPct`/`yPct` with optional
 *      hover/click popup cards (single-pin model).
 *   2. **Zones** (`FloorplanZone[]`) — shaded rectangular regions centered on a room's
 *      coordinates, used to highlight WHERE a material/finish is applied (e.g. "hardwood
 *      flooring in these rooms"). Each zone can carry a label and an optional click card.
 *
 * The component owns ZERO domain logic. Consumers provide the overlay arrays plus
 * optional `legend` items for the key beneath the canvas.
 *
 * Coordinate system: `xPct`/`yPct` are 0–100 percent positions over the combined
 * floorplan image, matching the existing rooms schema (`floorplanXPct`/`floorplanYPct`).
 *
 * Usage — zone mask for hardwood flooring rooms:
 * ```tsx
 * <FloorplanViewer
 *   markers={[]}  // no dot markers needed here
 *   zones={hardwoodRooms.map(room => ({
 *     id: room.id,
 *     xPct: room.floorplanXPct,
 *     yPct: room.floorplanYPct,
 *     widthPct: 12,
 *     heightPct: 10,
 *     label: room.displayName,
 *     color: "#8b5e3c",   // warm wood tone
 *     opacity: 0.35,
 *     card: <MaterialMarkerCard title="Hardwood Flooring" roomName={room.displayName} />,
 *   }))}
 *   legend={[
 *     { color: "bg-amber-700", label: "Hardwood flooring" },
 *   ]}
 * />
 * ```
 */

import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** A single marker to overlay on the floorplan. */
export interface FloorplanMarker {
  /** Unique identifier for the marker (e.g. room id, material id). */
  id: string | number;
  /** Horizontal percent position (0–100) over the combined floorplan image. */
  xPct: number;
  /** Vertical percent position (0–100) over the combined floorplan image. */
  yPct: number;
  /** Accessible tooltip / title. */
  label: string;
  /** Text shown inside the dot. Pass empty string for no label. */
  dotLabel?: string;
  /** Tailwind `bg-*` class for the dot fill color. Default: `"bg-primary"`. */
  dotColor?: string;
  /** Ring color class (e.g. `"ring-white/90"`). Default: `"ring-white/90"`. */
  ringColor?: string;
  /** ReactNode rendered inside the popup card when the marker is hovered/clicked. */
  card?: React.ReactNode;
}

/**
 * A shaded zone/mask overlay centered on a room's coordinates.
 *
 * Used to visualise coverage — "which rooms get hardwood?", "where does micro
 * cement go?" — by painting a semi-transparent rectangle over the room area.
 */
export interface FloorplanZone {
  /** Unique identifier (typically the room id). */
  id: string | number;
  /** Horizontal center percent (0–100), matching `floorplanXPct`. */
  xPct: number;
  /** Vertical center percent (0–100), matching `floorplanYPct`. */
  yPct: number;
  /**
   * Zone width as a percent of the floorplan image width.
   * Default: `10`. Increase for larger rooms, decrease for smaller ones.
   */
  widthPct?: number;
  /**
   * Zone height as a percent of the floorplan image height.
   * Default: `8`. Increase for larger rooms, decrease for smaller ones.
   */
  heightPct?: number;
  /**
   * Fill color. Accepts any CSS color string (hex, rgb, hsl, oklch, etc.).
   * Default: `"#3b82f6"` (blue-500).
   */
  color?: string;
  /** Fill opacity 0–1. Default: `0.25`. */
  opacity?: number;
  /** Optional label rendered in the center of the zone. */
  label?: string;
  /** Accessible tooltip / title text. */
  title?: string;
  /** Border radius in px. Default: `8`. Set `0` for sharp edges. */
  borderRadius?: number;
  /**
   * Optional pattern overlay: `"solid"` (default), `"stripes"`, or `"dots"`.
   * Stripes and dots add a subtle repeating pattern over the fill for visual
   * differentiation when multiple zone types coexist on the same floorplan.
   */
  pattern?: "solid" | "stripes" | "dots";
  /** ReactNode rendered inside the popup card when the zone is clicked. */
  card?: React.ReactNode;
}

/** An item in the optional legend strip. */
export interface FloorplanLegendItem {
  /** Tailwind `bg-*` class matching the dot color OR inline style `color`. */
  color: string;
  /** Human-readable label. */
  label: string;
  /**
   * Legend swatch type. Default `"dot"` shows a circle; `"swatch"` shows a
   * filled square with reduced opacity (matching zone fills).
   */
  type?: "dot" | "swatch";
}

export interface FloorplanViewerProps {
  /** URL of the floorplan image. Defaults to the static listing floorplan. */
  imageSrc?: string;
  /** Alt text for the floorplan image. */
  imageAlt?: string;
  /** Array of dot markers to overlay on the floorplan. */
  markers?: FloorplanMarker[];
  /** Array of zone/mask overlays to shade room regions. */
  zones?: FloorplanZone[];
  /** Optional legend items shown beneath the canvas. */
  legend?: FloorplanLegendItem[];
  /** Optional trailing note after the legend (e.g. "Dot = material count"). */
  legendNote?: string;
  /** Card header title (shown above the canvas). Pass `null` to hide the header. */
  title?: string | null;
  /** Card header subtitle. */
  description?: string;
  /** ReactNode rendered at the top-right of the card header (e.g. buttons). */
  headerActions?: React.ReactNode;
  /** Additional className for the outermost Card. */
  className?: string;
  /** If `true`, renders just the canvas (no wrapping Card/header). */
  bare?: boolean;
  /** Additional className for the image container. */
  canvasClassName?: string;
}

/* -------------------------------------------------------------------------- */
/*  Fine-pointer hook (same as RoomHoverCard)                                 */
/* -------------------------------------------------------------------------- */

function usePointerFine(): boolean {
  const [fine, setFine] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(pointer: fine)");
    const update = () => setFine(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return fine;
}

/* -------------------------------------------------------------------------- */
/*  Internal: FloorplanDotMarker (dot + popover)                              */
/* -------------------------------------------------------------------------- */

interface FloorplanDotMarkerProps {
  marker: FloorplanMarker;
  pinned: boolean;
  onPinChange: (pinned: boolean) => void;
}

function FloorplanDotMarker({ marker, pinned, onPinChange }: FloorplanDotMarkerProps) {
  const pointerFine = usePointerFine();
  const [hovered, setHovered] = React.useState(false);

  const open = pinned || (pointerFine && hovered);
  const hasCard = marker.card != null;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHovered(false);
      if (pinned) onPinChange(false);
    }
  };

  const handleDotClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (hasCard) {
      onPinChange(!pinned);
    }
  };

  const dot = (
    <button
      type="button"
      aria-label={marker.label}
      title={marker.label}
      data-pinned={pinned ? "true" : undefined}
      className={cn(
        "absolute z-10 -translate-x-1/2 -translate-y-1/2",
        "inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 py-0.5",
        "text-[11px] font-semibold leading-none text-white shadow-md",
        "ring-2",
        marker.ringColor ?? "ring-white/90",
        "touch-manipulation after:absolute after:-inset-2 after:content-['']",
        "cursor-pointer outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-4 focus-visible:ring-ring/60",
        pinned && "scale-110 ring-4 ring-primary/80",
        marker.dotColor ?? "bg-primary",
      )}
      style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%` }}
      onClick={handleDotClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {marker.dotLabel ?? ""}
    </button>
  );

  // No card content → just render the dot, no popover.
  if (!hasCard) return dot;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={dot} />
      <PopoverContent
        side="top"
        sideOffset={10}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-[18rem] max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none ring-0"
      >
        {marker.card}
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*  Internal: FloorplanZoneOverlay (shaded region + optional popover)          */
/* -------------------------------------------------------------------------- */

/** CSS background-image patterns for zone overlays. */
const ZONE_PATTERNS: Record<string, string> = {
  stripes:
    "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.12) 4px, rgba(255,255,255,0.12) 6px)",
  dots: "radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
};

/** Background-size matching each pattern. */
const ZONE_PATTERN_SIZES: Record<string, string> = {
  stripes: "12px 12px",
  dots: "6px 6px",
};

interface FloorplanZoneOverlayProps {
  zone: FloorplanZone;
  pinned: boolean;
  onPinChange: (pinned: boolean) => void;
}

function FloorplanZoneOverlay({ zone, pinned, onPinChange }: FloorplanZoneOverlayProps) {
  const pointerFine = usePointerFine();
  const [hovered, setHovered] = React.useState(false);

  const hasCard = zone.card != null;
  const open = pinned || (pointerFine && hovered);

  const w = zone.widthPct ?? 10;
  const h = zone.heightPct ?? 8;
  const fillColor = zone.color ?? "#3b82f6";
  const fillOpacity = zone.opacity ?? 0.25;
  const radius = zone.borderRadius ?? 8;
  const pattern = zone.pattern ?? "solid";

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setHovered(false);
      if (pinned) onPinChange(false);
    }
  };

  const handleClick = (event: React.MouseEvent) => {
    event.preventDefault();
    if (hasCard) onPinChange(!pinned);
  };

  // Build the background layers: fill color + optional pattern.
  const bgLayers: string[] = [];
  if (pattern !== "solid" && ZONE_PATTERNS[pattern]) {
    bgLayers.push(ZONE_PATTERNS[pattern]);
  }

  const zoneEl = (
    <div
      role={hasCard ? "button" : undefined}
      tabIndex={hasCard ? 0 : undefined}
      aria-label={zone.title ?? zone.label ?? "Zone"}
      title={zone.title ?? zone.label}
      data-pinned={pinned ? "true" : undefined}
      className={cn(
        "absolute z-[5] -translate-x-1/2 -translate-y-1/2",
        "flex items-center justify-center",
        "transition-all duration-200",
        hasCard && "cursor-pointer",
        pinned && "ring-2 ring-primary/80",
        hovered && !pinned && "ring-1 ring-white/40",
      )}
      style={{
        left: `${zone.xPct}%`,
        top: `${zone.yPct}%`,
        width: `${w}%`,
        height: `${h}%`,
        backgroundColor: fillColor,
        opacity: hovered ? Math.min(fillOpacity + 0.15, 0.7) : fillOpacity,
        borderRadius: `${radius}px`,
        backgroundImage: bgLayers.join(", ") || undefined,
        backgroundSize: pattern !== "solid" ? ZONE_PATTERN_SIZES[pattern] : undefined,
      }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (hasCard && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onPinChange(!pinned);
        }
      }}
    >
      {zone.label && (
        <span
          className={cn(
            "pointer-events-none select-none truncate px-1 text-[10px] font-semibold uppercase tracking-wider text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]",
            "transition-opacity duration-200",
            hovered || pinned ? "opacity-100" : "opacity-70",
          )}
        >
          {zone.label}
        </span>
      )}
    </div>
  );

  if (!hasCard) return zoneEl;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={zoneEl} />
      <PopoverContent
        side="top"
        sideOffset={10}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-[18rem] max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none ring-0"
      >
        {zone.card}
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*  FloorplanViewer (main export)                                             */
/* -------------------------------------------------------------------------- */

const DEFAULT_FLOORPLAN = "/floorplans/126colby-listing-floorplan.jpg";

export function FloorplanViewer({
  imageSrc = DEFAULT_FLOORPLAN,
  imageAlt = "Listing floor plan",
  markers = [],
  zones = [],
  legend,
  legendNote,
  title = "Floor Plan",
  description,
  headerActions,
  className,
  bare = false,
  canvasClassName,
}: FloorplanViewerProps) {
  const [pinnedId, setPinnedId] = React.useState<string | number | null>(null);

  const handlePinChange = React.useCallback((id: string | number, pinned: boolean) => {
    setPinnedId((current) => {
      if (pinned) return id;
      return current === id ? null : current;
    });
  }, []);

  const canvas = (
    <div className={cn("relative overflow-hidden rounded-xl bg-muted/20 ring-1 ring-border/40", canvasClassName)}>
      {/* biome-ignore lint/performance/noImgElement: static floorplan from public assets */}
      <img
        src={imageSrc}
        alt={imageAlt}
        className="h-auto w-full select-none object-contain"
        draggable={false}
      />

      {/* Zone/mask overlays — rendered BELOW markers in z-stack (z-5 vs z-10). */}
      {zones.map((zone) => (
        <FloorplanZoneOverlay
          key={`zone-${zone.id}`}
          zone={zone}
          pinned={pinnedId === `zone-${zone.id}`}
          onPinChange={(pinned) => handlePinChange(`zone-${zone.id}`, pinned)}
        />
      ))}

      {/* Dot markers — rendered above zones (z-10). */}
      {markers.map((marker) => (
        <FloorplanDotMarker
          key={marker.id}
          marker={marker}
          pinned={pinnedId === marker.id}
          onPinChange={(pinned) => handlePinChange(marker.id, pinned)}
        />
      ))}
    </div>
  );

  const legendStrip =
    legend && legend.length > 0 ? (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {legend.map((item) => {
          const isSwatch = item.type === "swatch";
          // Detect inline color (starts with # or rgb/hsl/oklch).
          const isInlineColor =
            item.color.startsWith("#") ||
            item.color.startsWith("rgb") ||
            item.color.startsWith("hsl") ||
            item.color.startsWith("oklch");

          return (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block shrink-0",
                  isSwatch
                    ? "size-3 rounded-sm"
                    : "size-2.5 rounded-full ring-1 ring-white/80",
                  !isInlineColor && item.color,
                )}
                style={
                  isInlineColor
                    ? {
                        backgroundColor: item.color,
                        opacity: isSwatch ? 0.5 : 1,
                      }
                    : undefined
                }
                aria-hidden="true"
              />
              {item.label}
            </span>
          );
        })}
        {legendNote && <span className="ml-auto">{legendNote}</span>}
      </div>
    ) : null;

  // Bare mode: just the canvas + legend, no wrapping Card.
  if (bare) {
    return (
      <div className={className}>
        {canvas}
        {legendStrip}
      </div>
    );
  }

  return (
    <Card className={cn("ring-1 ring-border/40", className)}>
      {title !== null && (
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {headerActions}
          </div>
        </CardHeader>
      )}
      <CardContent>
        {canvas}
        {legendStrip}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pre-built popup card bodies for common domains                            */
/* -------------------------------------------------------------------------- */

/**
 * MaterialMarkerCard — a ready-made popup card body for materials on the
 * floorplan. Shows the material title, brand, room name, purchased status,
 * and optional price. Designed to be passed as `marker.card`.
 */
export interface MaterialMarkerCardProps {
  title: string;
  brand?: string | null;
  roomName?: string | null;
  isPurchased?: boolean;
  price?: string | null;
  /** Optional image URL for the material. */
  imageUrl?: string | null;
  /** Optional extra metadata rows (key → value). */
  meta?: Array<{ label: string; value: string }>;
  className?: string;
}

export function MaterialMarkerCard({
  title,
  brand,
  roomName,
  isPurchased = false,
  price,
  imageUrl,
  meta,
  className,
}: MaterialMarkerCardProps) {
  return (
    <Card
      size="sm"
      className={cn(
        "w-full gap-0 overflow-hidden p-0 shadow-xl ring-1 ring-foreground/15",
        className,
      )}
    >
      {/* Image or compact header */}
      {imageUrl ? (
        // biome-ignore lint/performance/noImgElement: external delivery urls
        <img
          src={imageUrl}
          alt={title}
          className="aspect-[16/10] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="bg-muted/30 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Material
          </p>
        </div>
      )}

      <div className="space-y-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
          {brand && (
            <p className="truncate text-xs text-muted-foreground">{brand}</p>
          )}
        </div>

        {roomName && (
          <p className="text-xs text-muted-foreground">
            Room: <span className="font-medium text-foreground">{roomName}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ring-1",
              isPurchased
                ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
                : "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
            )}
          >
            {isPurchased ? "Purchased" : "Not purchased"}
          </span>
          {price && (
            <span className="text-xs font-mono text-muted-foreground">{price}</span>
          )}
        </div>

        {meta && meta.length > 0 && (
          <div className="space-y-1 border-t border-border/40 pt-2">
            {meta.map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * ProductMarkerCard — a ready-made popup card body for showroom products
 * overlaid on the floorplan.
 */
export interface ProductMarkerCardProps {
  name: string;
  storeName?: string | null;
  price?: string | null;
  imageUrl?: string | null;
  isFavorite?: boolean;
  aiScore?: number | null;
  className?: string;
}

export function ProductMarkerCard({
  name,
  storeName,
  price,
  imageUrl,
  isFavorite = false,
  aiScore,
  className,
}: ProductMarkerCardProps) {
  return (
    <Card
      size="sm"
      className={cn(
        "w-full gap-0 overflow-hidden p-0 shadow-xl ring-1 ring-foreground/15",
        className,
      )}
    >
      {imageUrl ? (
        // biome-ignore lint/performance/noImgElement: external delivery urls
        <img
          src={imageUrl}
          alt={name}
          className="aspect-[16/10] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-[16/10] w-full flex-col items-center justify-center bg-muted/30">
          <span className="text-[11px] text-muted-foreground/60">No image</span>
        </div>
      )}

      <div className="space-y-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          {storeName && (
            <p className="truncate text-xs text-muted-foreground">{storeName}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {price && (
            <span className="text-xs font-mono font-medium">{price}</span>
          )}
          {isFavorite && (
            <span className="inline-flex items-center rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-400 ring-1 ring-rose-500/30">
              ★ Favorite
            </span>
          )}
          {aiScore != null && (
            <span className="inline-flex items-center rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400 ring-1 ring-sky-500/30">
              AI: {aiScore}/5
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
