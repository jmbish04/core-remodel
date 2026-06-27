import * as React from "react"
import {
  Map,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  MarkerPopup,
  MapControls,
} from "@/components/ui/map"
import { Button } from "@/components/ui/button"
import {
  Star,
  Navigation,
  Clock,
  ExternalLink,
  ImageOff,
} from "lucide-react"

/* -------------------------------------------------------------------------- */
/*  ShowroomMap — map showroom stores with rich popup cards                    */
/* -------------------------------------------------------------------------- */

export interface ShowroomMapPlace {
  id: number
  name: string
  /** Short label for the marker (e.g. "Kitchen", "Bath"). */
  label?: string
  /** Category badge text. */
  category?: string
  /** 1–5 star rating. */
  rating?: number
  /** Review count. */
  reviews?: number
  /** Operating hours string. */
  hours?: string
  /** Image URL. If null/undefined, a placeholder is shown. */
  image?: string | null
  /** Longitude coordinate. */
  lng: number
  /** Latitude coordinate. */
  lat: number
  /** Optional external link. */
  externalUrl?: string
}

interface ShowroomMapProps {
  /** Array of showroom places to render on the map. */
  places: ShowroomMapPlace[]
  /** Map center — [longitude, latitude]. Defaults to Bay Area center. */
  center?: [number, number]
  /** Initial zoom level. Defaults to 10. */
  zoom?: number
  /** Callback when "Directions" is clicked for a place. */
  onDirections?: (place: ShowroomMapPlace) => void
  /** Callback when external link icon is clicked. */
  onExternalLink?: (place: ShowroomMapPlace) => void
  /** Additional class name for the map container. */
  className?: string
}

/** Fallback for missing images. */
function ImagePlaceholder() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted">
      <ImageOff className="size-6 text-muted-foreground/60" />
      <span className="text-[11px] font-medium text-muted-foreground/60">
        No image available
      </span>
    </div>
  )
}

/**
 * ShowroomMap — renders showroom stores as markers with rich popup cards
 * showing photo (or placeholder), rating, hours, and action buttons.
 *
 * Usage:
 * ```tsx
 * <ShowroomMap
 *   places={stores}
 *   onDirections={(p) => window.open(`https://maps.google.com/...`)}
 * />
 * ```
 */
export function ShowroomMap({
  places,
  center = [-122.42, 37.77],
  zoom = 10,
  onDirections,
  onExternalLink,
  className,
}: ShowroomMapProps) {
  return (
    <div className={className ?? "h-[500px] w-full"}>
      <Map center={center} zoom={zoom}>
        {places.map((place) => (
          <MapMarker
            key={place.id}
            longitude={place.lng}
            latitude={place.lat}
          >
            <MarkerContent>
              <div className="size-5 cursor-pointer rounded-full border-2 border-white bg-rose-500 shadow-lg transition-transform hover:scale-110" />
              {place.label && (
                <MarkerLabel position="bottom">{place.label}</MarkerLabel>
              )}
            </MarkerContent>
            <MarkerPopup className="w-62 p-0">
              {/* Image or placeholder */}
              <div className="relative h-32 overflow-hidden rounded-t-md">
                {place.image ? (
                  <img
                    src={place.image}
                    alt={place.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <ImagePlaceholder />
                )}
              </div>

              {/* Info card */}
              <div className="space-y-2 p-3">
                <div>
                  {place.category && (
                    <p className="pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {place.category}
                    </p>
                  )}
                  <h3 className="font-semibold leading-tight text-foreground">
                    {place.name}
                  </h3>
                </div>

                {/* Rating */}
                {place.rating != null && (
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex items-center gap-1">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      <span className="font-medium">{place.rating}</span>
                      {place.reviews != null && (
                        <span className="text-muted-foreground">
                          ({place.reviews.toLocaleString()})
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Hours */}
                {place.hours && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="size-3.5" />
                    <span>{place.hours}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (onDirections) {
                        onDirections(place)
                      } else {
                        window.open(
                          `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`,
                          "_blank"
                        )
                      }
                    }}
                  >
                    <Navigation className="size-3.5" />
                    Directions
                  </Button>
                  {(place.externalUrl || onExternalLink) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="px-2"
                      onClick={() => {
                        if (onExternalLink) {
                          onExternalLink(place)
                        } else if (place.externalUrl) {
                          window.open(place.externalUrl, "_blank")
                        }
                      }}
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </MarkerPopup>
          </MapMarker>
        ))}
        <MapControls
          position="bottom-right"
          showZoom
          showLocate
          showFullscreen
        />
      </Map>
    </div>
  )
}
