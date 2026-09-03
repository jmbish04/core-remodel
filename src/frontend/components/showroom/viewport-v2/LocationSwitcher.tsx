/**
 * @fileoverview LocationSwitcher — the hero control that scopes the whole
 * viewport to one physical site (location-centric routing).
 *
 * Renders a pill per location, each a link to `/admin/shopping/store/:storeId/:locationId`
 * (the primary site links to the bare `/admin/shopping/store/:storeId` so the
 * default URL stays clean). The active site is starred; the primary carries a
 * Crown. Below 2 locations it renders nothing (a single-site store needs none).
 */
import { Crown, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StoreLocation } from "../locations/LocationsModal";

/** Href for a location: primary → bare /store/:id, others → /store/:id/:id. */
function locationHref(storeId: number, loc: StoreLocation): string {
  const base = `/admin/shopping/store/${storeId}`;
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
              {active && (
                <Star className="size-3.5 shrink-0 fill-current" aria-label="Currently viewing" />
              )}
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
