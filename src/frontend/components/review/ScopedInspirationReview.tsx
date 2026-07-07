import { ImageOff, Layers, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  type BroadScope,
  type ScopedInspirationGroup,
  type ScopedInspirationGroupedResponse,
  UNCATEGORIZED_LABEL,
  resolveScopedImageUrl,
} from "./inspiration-categories";

/**
 * A floor option the viewer can scope to when `scope === "level"`. Mirrors the
 * `floors[]` entries from `GET /api/rooms/catalog` (id + key + name). Pass the
 * full set so the floor picker can list every level; the viewer ignores the
 * `all_levels` synthetic floor because that maps to home scope, not level scope.
 */
export interface ScopedInspirationFloor {
  id: number;
  key: string;
  name: string;
}

interface ScopedInspirationReviewProps {
  /**
   * Floors available for the level-scope filter. When omitted the component
   * fetches `/api/rooms/catalog` itself so it stays drop-in usable anywhere.
   */
  floors?: ScopedInspirationFloor[];
  /** Initial scope; defaults to "home" (the broadest, always-populated bucket). */
  defaultScope?: BroadScope;
  /**
   * When true (default) the component renders its own scope/floor toolbar. Set
   * false to drive `scope`/`floorId` entirely from the parent via the controlled
   * props below (used when a host page already owns those filters).
   */
  showControls?: boolean;
  /** Controlled scope (only honored when showControls is false). */
  scope?: BroadScope;
  /** Controlled floor id for level scope (only honored when showControls is false). */
  floorId?: number | null;
  /** External refresh nonce — bump to force a re-fetch (e.g. after categorizing). */
  refreshToken?: number;
  className?: string;
}

/** Internal: is this floor a real level (not the synthetic "all levels")? */
function isLevelFloor(floor: ScopedInspirationFloor): boolean {
  return floor.key !== "all_levels";
}

/**
 * ScopedInspirationReview — a reusable, read-only gallery of level/home-scoped
 * inspiration photos GROUPED BY CATEGORY.
 *
 * It calls `GET /api/images/inspiration/scoped?groupBy=category` with the active
 * scope (`level`|`home`) and, for level scope, a `floorId`. The server returns
 * `{ groups: [{ category, count, images }] }` already sorted (named categories
 * alphabetically, the null/"uncategorized" bucket last); we render one labeled
 * section per group with a responsive thumbnail grid.
 *
 * Mounted on `/admin/prepare/review` today, but intentionally self-sufficient (it can fetch
 * its own floor list) so it can be reused on a room page, a dashboard widget,
 * etc. without wiring.
 */
export function ScopedInspirationReview({
  floors: floorsProp,
  defaultScope = "home",
  showControls = true,
  scope: controlledScope,
  floorId: controlledFloorId,
  refreshToken = 0,
  className,
}: ScopedInspirationReviewProps) {
  const [internalScope, setInternalScope] = useState<BroadScope>(defaultScope);
  const [internalFloorId, setInternalFloorId] = useState<number | null>(null);
  const [floors, setFloors] = useState<ScopedInspirationFloor[]>(
    floorsProp ?? [],
  );
  const [groups, setGroups] = useState<ScopedInspirationGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the effective scope/floor: controlled props win when the host hid
  // the toolbar; otherwise we use our own internal toolbar state.
  const scope = showControls ? internalScope : (controlledScope ?? defaultScope);
  const floorId = showControls
    ? internalFloorId
    : (controlledFloorId ?? null);

  const levelFloors = useMemo(() => floors.filter(isLevelFloor), [floors]);

  // Self-fetch the floor catalog only when the parent did not supply one and we
  // actually need it (level scope toolbar). Keeps the component drop-in usable.
  useEffect(() => {
    if (floorsProp && floorsProp.length > 0) {
      setFloors(floorsProp);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/rooms/catalog");
        const payload = (await response.json()) as {
          success?: boolean;
          floors?: ScopedInspirationFloor[];
        };
        if (!response.ok || !payload.success) {
          throw new Error("Failed to load floors");
        }
        if (!cancelled) {
          setFloors(payload.floors ?? []);
        }
      } catch {
        // Floor list is only needed for the level toolbar; a failure there is
        // non-fatal (home scope still works), so we swallow it quietly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [floorsProp]);

  // Default the level-scope floor to the first real floor once floors load.
  useEffect(() => {
    if (!showControls) return;
    if (internalScope !== "level") return;
    if (internalFloorId !== null) return;
    const first = levelFloors[0];
    if (first) {
      setInternalFloorId(first.id);
    }
  }, [showControls, internalScope, internalFloorId, levelFloors]);

  const loadGroups = useCallback(
    async (signal?: AbortSignal) => {
      // Level scope without a chosen floor cannot be queried yet — render empty.
      if (scope === "level" && (floorId === null || !Number.isFinite(floorId))) {
        setGroups([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ scope, groupBy: "category" });
        if (scope === "level" && floorId !== null) {
          params.set("floorId", String(floorId));
        }
        const response = await fetch(
          `/api/images/inspiration/scoped?${params.toString()}`,
          { signal },
        );
        const payload = (await response.json()) as ScopedInspirationGroupedResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Failed to load scoped inspiration");
        }
        setGroups(payload.groups ?? []);
      } catch (caught) {
        // A superseded request was aborted — drop it silently, no state churn.
        if (signal?.aborted || (caught as Error)?.name === "AbortError") {
          return;
        }
        const message =
          caught instanceof Error
            ? caught.message
            : "Failed to load scoped inspiration";
        setError(message);
        toast.error(message);
      } finally {
        // Only the live (non-aborted) request owns the loading flag.
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [scope, floorId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadGroups(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadGroups, refreshToken]);

  const totalImages = useMemo(
    () => groups.reduce((sum, group) => sum + group.count, 0),
    [groups],
  );

  return (
    <Card className={cn("ring-1 ring-border/40", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              Level / Home Inspiration by Category
            </CardTitle>
            <CardDescription>
              Broad-scope inspiration grouped into the categories that apply
              across a whole level or the entire home.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={totalImages > 0 ? "secondary" : "outline"}>
              {totalImages} photo{totalImages === 1 ? "" : "s"}
            </Badge>
            {showControls ? (
              <>
                <Select
                  value={scope}
                  onValueChange={(next) => {
                    setInternalScope(next as BroadScope);
                  }}
                >
                  <SelectTrigger size="sm" className="w-[8.5rem]">
                    <SelectValue
                      getLabel={(value) =>
                        value === "level" ? "Whole level" : "Whole home"
                      }
                      placeholder="Scope"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home">Whole home</SelectItem>
                    <SelectItem value="level">Whole level</SelectItem>
                  </SelectContent>
                </Select>
                {scope === "level" ? (
                  <Select
                    value={floorId !== null ? String(floorId) : ""}
                    onValueChange={(next) =>
                      setInternalFloorId(next ? Number(next) : null)
                    }
                  >
                    <SelectTrigger size="sm" className="w-[10rem]">
                      <SelectValue
                        items={levelFloors.map((floor) => ({
                          value: String(floor.id),
                          label: floor.name,
                        }))}
                        placeholder="Select a floor"
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {levelFloors.map((floor) => (
                        <SelectItem key={floor.id} value={String(floor.id)}>
                          {floor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </>
            ) : null}
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void loadGroups()}
              disabled={loading}
              aria-label="Refresh"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading grouped inspiration...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-10 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void loadGroups()}
            >
              Try again
            </Button>
          </div>
        ) : scope === "level" && floorId === null ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-12 text-center">
            <p className="text-sm font-medium">Choose a floor</p>
            <p className="text-xs text-muted-foreground">
              Pick a level above to see its category groups.
            </p>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-12 text-center">
            <p className="text-sm font-medium">No broad-scope inspiration yet</p>
            <p className="text-xs text-muted-foreground">
              Photos dropped on "Entire Floor" or "Entire Home" during upload
              will appear here once mapped.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <CategoryGroup
              key={group.category ?? "__uncategorized__"}
              group={group}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Renders a single category section: heading + count + thumbnail grid. */
function CategoryGroup({ group }: { group: ScopedInspirationGroup }) {
  const heading = group.category ?? UNCATEGORIZED_LABEL;
  const isUncategorized = group.category === null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3
          className={cn(
            "text-sm font-semibold tracking-wide",
            isUncategorized && "text-muted-foreground",
          )}
        >
          {heading}
        </h3>
        <Badge variant={isUncategorized ? "outline" : "secondary"}>
          {group.count}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {group.images.map((image) => (
          <ThumbnailTile key={image.id} image={image} />
        ))}
      </div>
    </section>
  );
}

/** A single inspiration thumbnail with graceful fallback when no URL resolves. */
function ThumbnailTile({
  image,
}: {
  image: ScopedInspirationGroup["images"][number];
}) {
  const url = resolveScopedImageUrl(image);
  const label = image.displayName?.trim() || "Inspiration photo";
  return (
    <figure className="group relative aspect-square overflow-hidden rounded-lg bg-muted/30 ring-1 ring-border/40">
      {url ? (
        // biome-ignore lint/performance/noImgElement: external Cloudflare delivery urls
        <img
          src={url}
          alt={label}
          loading="lazy"
          className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageOff className="size-5" />
          <span className="px-2 text-center text-[10px]">No preview</span>
        </div>
      )}
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </figcaption>
    </figure>
  );
}
