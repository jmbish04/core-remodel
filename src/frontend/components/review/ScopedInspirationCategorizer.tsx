import { Loader2, RefreshCw } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { CategorizerCard } from "./CategorizerCard";
import {
  type BroadScope,
  type CardBusyState,
  EMPTY_BUSY,
  type ScopedInspirationFlatResponse,
  type ScopedInspirationImage,
  type SetCategoryResponse,
  type SuggestCategoryResponse,
  isInspirationCategory,
} from "./inspiration-categories";
import type { ScopedInspirationFloor } from "./ScopedInspirationReview";

interface ScopedInspirationCategorizerProps {
  /** Floors for the level-scope filter; self-fetched from catalog when omitted. */
  floors?: ScopedInspirationFloor[];
  /**
   * Fired after any successful category save so a sibling viewer can refresh.
   * Receives the image id and the newly-persisted category (null when cleared).
   */
  onCategorized?: (imageId: string, category: string | null) => void;
  className?: string;
}

/** Is this floor a real level (not the synthetic "all levels" home floor)? */
function isLevelFloor(floor: ScopedInspirationFloor): boolean {
  return floor.key !== "all_levels";
}

/**
 * ScopedInspirationCategorizer — the /review workflow for assigning categories to
 * level/home-scoped inspiration photos.
 *
 * Flow per card (matches REVISIONS "AI-suggest + confirm"):
 *   1. List broad-scope photos via `GET /api/images/inspiration/scoped`
 *      (flat shape), with a "Show only uncategorized" toggle wired to the
 *      `uncategorizedOnly` query param so the reviewer can burn down the backlog.
 *   2. The reviewer clicks the sparkle to call `POST /:id/suggest-category`
 *      (Workers AI vision). The suggestion is NOT persisted — it just preselects
 *      the dropdown so the reviewer can confirm or override.
 *   3. The reviewer picks/keeps a category and clicks Save, which persists via
 *      `PATCH /:id/inspiration-category`. Success is surfaced with a shadcn/sonner
 *      toast (never window.alert) and the card collapses out of the
 *      uncategorized-only list.
 *
 * Uncategorized cards are visually highlighted (amber ring) so they stand out.
 */
export function ScopedInspirationCategorizer({
  floors: floorsProp,
  onCategorized,
  className,
}: ScopedInspirationCategorizerProps) {
  const [scope, setScope] = useState<BroadScope>("home");
  const [floorId, setFloorId] = useState<number | null>(null);
  const [floors, setFloors] = useState<ScopedInspirationFloor[]>(
    floorsProp ?? [],
  );
  const [images, setImages] = useState<ScopedInspirationImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uncategorizedOnly, setUncategorizedOnly] = useState(true);

  // Per-card draft selection (category chosen but not yet saved) + busy flags.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, CardBusyState>>({});

  const levelFloors = useMemo(() => floors.filter(isLevelFloor), [floors]);

  // Self-fetch floors when not provided (keeps the component drop-in usable).
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
        if (response.ok && payload.success && !cancelled) {
          setFloors(payload.floors ?? []);
        }
      } catch {
        // Non-fatal: home scope works without the floor list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [floorsProp]);

  // Default the level floor once floors arrive.
  useEffect(() => {
    if (scope !== "level" || floorId !== null) return;
    const first = levelFloors[0];
    if (first) setFloorId(first.id);
  }, [scope, floorId, levelFloors]);

  const loadImages = useCallback(async () => {
    if (scope === "level" && (floorId === null || !Number.isFinite(floorId))) {
      setImages([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope });
      if (scope === "level" && floorId !== null) {
        params.set("floorId", String(floorId));
      }
      if (uncategorizedOnly) {
        params.set("uncategorizedOnly", "true");
      }
      const response = await fetch(
        `/api/images/inspiration/scoped?${params.toString()}`,
      );
      const payload = (await response.json()) as ScopedInspirationFlatResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load inspiration photos");
      }
      const list = payload.images ?? [];
      setImages(list);
      // Seed drafts from persisted categories so the dropdown reflects state.
      setDrafts((current) => {
        const next = { ...current };
        for (const image of list) {
          if (next[image.id] === undefined) {
            next[image.id] = image.inspirationCategory ?? "";
          }
        }
        return next;
      });
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Failed to load inspiration photos",
      );
    } finally {
      setLoading(false);
    }
  }, [scope, floorId, uncategorizedOnly]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const setCardBusy = useCallback(
    (imageId: string, patch: Partial<CardBusyState>) => {
      setBusy((current) => ({
        ...current,
        [imageId]: { ...(current[imageId] ?? EMPTY_BUSY), ...patch },
      }));
    },
    [],
  );

  /** Ask the AI for a suggestion and preselect it (without persisting). */
  const suggestCategory = useCallback(
    async (imageId: string) => {
      setCardBusy(imageId, { suggesting: true });
      try {
        const response = await fetch(`/api/images/${imageId}/suggest-category`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const payload = (await response.json()) as SuggestCategoryResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "AI could not suggest a category");
        }
        const suggestion = payload.suggestedCategory;
        if (suggestion && isInspirationCategory(suggestion)) {
          setDrafts((current) => ({ ...current, [imageId]: suggestion }));
          toast.success(`AI suggests: ${suggestion} — confirm to save`);
        } else {
          toast.info("AI was unsure — pick a category manually");
        }
      } catch (caught) {
        toast.error(
          caught instanceof Error
            ? caught.message
            : "AI could not suggest a category",
        );
      } finally {
        setCardBusy(imageId, { suggesting: false });
      }
    },
    [setCardBusy],
  );

  /** Persist the chosen category for one image via PATCH. */
  const saveCategory = useCallback(
    async (imageId: string) => {
      const chosen = drafts[imageId] ?? "";
      if (!chosen) {
        toast.error("Pick a category before saving");
        return;
      }
      setCardBusy(imageId, { saving: true });
      try {
        const response = await fetch(
          `/api/images/${imageId}/inspiration-category`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: chosen }),
          },
        );
        const payload = (await response.json()) as SetCategoryResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Failed to save category");
        }
        const saved = payload.inspirationCategory ?? null;
        toast.success(saved ? `Saved as ${saved}` : "Category cleared");
        onCategorized?.(imageId, saved);

        // Update local state: stamp the persisted category, and when the
        // "uncategorized only" filter is on, drop the now-categorized card.
        setImages((current) =>
          uncategorizedOnly && saved
            ? current.filter((image) => image.id !== imageId)
            : current.map((image) =>
                image.id === imageId
                  ? { ...image, inspirationCategory: saved }
                  : image,
              ),
        );
      } catch (caught) {
        toast.error(
          caught instanceof Error
            ? caught.message
            : "Failed to save category",
        );
      } finally {
        setCardBusy(imageId, { saving: false });
      }
    },
    [drafts, onCategorized, setCardBusy, uncategorizedOnly],
  );

  const uncategorizedCount = useMemo(
    () => images.filter((image) => !image.inspirationCategory).length,
    [images],
  );

  return (
    <Card className={cn("ring-1 ring-border/40", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Categorize Level / Home Inspiration</CardTitle>
            <CardDescription>
              Assign a category to broad-scope inspiration. Use the sparkle for
              an AI suggestion, then confirm.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={uncategorizedCount > 0 ? "destructive" : "secondary"}>
              {uncategorizedCount} uncategorized
            </Badge>
            <Select
              value={scope}
              onValueChange={(next) => setScope(next as BroadScope)}
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
                onValueChange={(next) => setFloorId(next ? Number(next) : null)}
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
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void loadImages()}
              disabled={loading}
              aria-label="Refresh"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
        <label
          htmlFor="scoped-uncategorized-only"
          className="mt-1 flex w-fit items-center gap-2 text-xs text-muted-foreground"
        >
          <Switch
            id="scoped-uncategorized-only"
            checked={uncategorizedOnly}
            onCheckedChange={setUncategorizedOnly}
          />
          Show only uncategorized
        </label>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading inspiration photos...
          </div>
        ) : scope === "level" && floorId === null ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-12 text-center">
            <p className="text-sm font-medium">Choose a floor</p>
            <p className="text-xs text-muted-foreground">
              Pick a level above to categorize its inspiration.
            </p>
          </div>
        ) : images.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-12 text-center">
            <p className="text-sm font-medium">
              {uncategorizedOnly
                ? "Nothing left to categorize"
                : "No broad-scope inspiration here"}
            </p>
            <p className="text-xs text-muted-foreground">
              {uncategorizedOnly
                ? "Every photo in this scope has a category. Toggle off the filter to review them."
                : "Photos dropped on Entire Floor / Entire Home will appear here once mapped."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {images.map((image) => (
              <CategorizerCard
                key={image.id}
                image={image}
                draft={drafts[image.id] ?? ""}
                busy={busy[image.id] ?? EMPTY_BUSY}
                onDraftChange={(value) =>
                  setDrafts((current) => ({ ...current, [image.id]: value }))
                }
                onSuggest={() => void suggestCategory(image.id)}
                onSave={() => void saveCategory(image.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
