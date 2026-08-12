/**
 * @fileoverview LocationSwitcher — the hero control that scopes the whole V2
 * viewport to one physical site (location-centric routing).
 *
 * Renders a pill per location, each a link to `/admin/shopping/store/:storeId/v2/:locationId`
 * (the primary site links to the bare `/v2` so the default URL stays clean). The
 * active site is highlighted; the primary carries a Crown. Below `2` locations it
 * renders nothing (a single-site store needs no switcher).
 *
 * Temporary V2 component; on promotion the hrefs drop the `/v2` segment.
 */
import { Crown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StoreLocation } from "../locations/LocationsModal";

/** Href for a location: primary → bare /v2, others → /v2/:id. */
function locationHref(storeId: number, loc: StoreLocation): string {
  const base = `/admin/shopping/store/${storeId}/v2`;
  return loc.isPrimary ? base : `${base}/${loc.id}`;
}

export function LocationSwitcher({
  storeId,
  locations,
  activeId,
}: {
  storeId: number;
  locations: StoreLocation[];
  activeId: number | null;
}) {
  if (locations.length < 2) return null;

  return (
    <div className="mt-2">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {locations.length} locations · viewing one
      </p>
      <div className="flex flex-wrap gap-1.5">
        {locations.map((loc) => {
          const active = loc.id === activeId;
          return (
            <a
              key={loc.id}
              href={locationHref(storeId, loc)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-foreground/80 hover:bg-muted",
              )}
            >
              <span className="font-medium">{loc.city ?? "Location"}</span>
              {loc.isPrimary && (
                <Crown
                  className={cn("size-3.5 shrink-0", active ? "text-amber-200" : "text-amber-400")}
                  aria-label="Primary location"
                />
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
