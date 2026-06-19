/**
 * RoomPropertyCard — a single room displayed as a property card, retrofitted
 * from the @bundui/property-cards-03 template.
 *
 * Real-estate concept mapping:
 *   property.image   → first listing/inspiration photo for this room
 *   property.name    → room display name ("Primary Bedroom")
 *   property.location → floor zone label ("Upper Level · Main living level")
 *   property.price   → photo count for this room
 *   property.stats   → room type, floor level
 *
 * Clicking the card fires `onSelect(roomName)` which the parent uses to open
 * the PhotoCollectionViewport for that room.
 *
 * Monolith dark: ring-1 ring-foreground/10 separation, no 1px borders, zinc base.
 */

import { Camera, Home, Layers, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface RoomPropertyCardProps {
  /** The room's display name (e.g. "Kitchen", "Primary Bedroom"). */
  roomName: string;
  /** The floor this room belongs to (e.g. "Upper Level"). */
  floorName?: string;
  /** The floor key for zone derivation ("upper_level", "lower_level", "outside"). */
  floorKey?: string;
  /** Number of photos in this room for the current category. */
  photoCount: number;
  /** URL of the hero image (first photo in this room). Null if no photos. */
  heroImageUrl: string | null;
  /** Callback when the user clicks the card. */
  onSelect: () => void;
}

/** Maps the floor key to a human-readable zone label. */
function floorZoneLabel(floorName?: string, floorKey?: string): string {
  if (!floorName) return "Unassigned";
  const parts: string[] = [floorName];
  if (floorKey === "lower_level") parts.push("Street level");
  else if (floorKey === "upper_level") parts.push("Main living level");
  else if (floorKey === "outside") parts.push("Exterior");
  return parts.join(" · ");
}

export function RoomPropertyCard({
  roomName,
  floorName,
  floorKey,
  photoCount,
  heroImageUrl,
  onSelect,
}: RoomPropertyCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-2xl bg-card text-left",
        "ring-1 ring-foreground/10 transition-all hover:ring-foreground/20",
        "hover:shadow-lg hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {/* Hero image. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {heroImageUrl ? (
          /* biome-ignore lint/performance/noImgElement: CF Images delivery URL */
          <img
            src={heroImageUrl}
            alt={roomName}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted/20 text-muted-foreground">
            <Camera className="size-8" />
            <p className="text-xs">No photos yet</p>
          </div>
        )}

        {/* Photo count overlay badge. */}
        <div className="absolute right-3 top-3">
          <Badge
            variant="secondary"
            className="bg-black/60 text-white backdrop-blur-sm"
          >
            <Camera className="mr-1.5 size-3" />
            {photoCount} {photoCount === 1 ? "photo" : "photos"}
          </Badge>
        </div>
      </div>

      {/* Card body. */}
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <h3 className="text-lg font-semibold tracking-tight group-hover:text-primary transition-colors">
          {roomName}
        </h3>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">
            {floorZoneLabel(floorName, floorKey)}
          </span>
        </div>

        {/* Footer stats row. */}
        <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Layers className="size-3.5" />
            <span>{floorName || "Unassigned"}</span>
          </div>
          <span className="text-foreground/20">·</span>
          <div className="flex items-center gap-1.5">
            <Home className="size-3.5" />
            <span className="capitalize">{roomName.toLowerCase()}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export default RoomPropertyCard;
