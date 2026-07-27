/**
 * @fileoverview GPS evidence panel for a visit (0032 V2c).
 *
 * The attestation story, surfaced: a one-marker mini-map at the captured fix,
 * the coordinates, how far that fix was from the matched store (match_distance_m),
 * when it was captured, and which source staged it. Reuses DriveMapThumb (raw
 * MapLibre, one marker) so there's a single map implementation in the app.
 */
import { MapPinOff } from "lucide-react";

import { DriveMapThumb } from "@/components/drives/DriveMapThumb";

import { SourceBadge } from "./Badges";
import { formatDistance, type GpsSource } from "./types";

export function GpsEvidence({
  latitude,
  longitude,
  matchDistanceM,
  capturedAt,
  source,
}: {
  latitude: number | null;
  longitude: number | null;
  matchDistanceM: number | null;
  capturedAt: string | null;
  source: GpsSource | null;
}) {
  // `!= null` keeps TS's aliased-condition narrowing (latitude→number in the
  // block); Number.isFinite also rejects NaN/Infinity from bad data.
  const hasFix =
    latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude);
  const distance = formatDistance(matchDistanceM);
  const captured = capturedAt ? new Date(capturedAt) : null;

  return (
    <div className="rounded-xl bg-card ring-1 ring-border/40">
      {hasFix ? (
        <DriveMapThumb markers={[{ lat: latitude, lng: longitude }]} />
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center rounded-t-xl bg-muted">
          <div className="flex flex-col items-center gap-1 text-muted-foreground/60">
            <MapPinOff className="size-6" />
            <span className="text-xs">No GPS fix on this visit</span>
          </div>
        </div>
      )}
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Location evidence
          </span>
          <SourceBadge source={source} />
        </div>
        {hasFix && (
          <p className="font-mono text-xs text-muted-foreground">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
            {distance && <span className="text-foreground"> · parked {distance}</span>}
          </p>
        )}
        {captured && Number.isFinite(captured.getTime()) && (
          <p className="text-xs text-muted-foreground">
            Captured {captured.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </div>
    </div>
  );
}
