/**
 * @fileoverview ResultCard (0032 D2d) — one discovery-search result: mini-map + name +
 * type/rating/distance badges + import / not-interested actions. Mirrors ParkFindCard.
 */
import { Check, ExternalLink, Loader2, Phone, Star, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DriveMapThumb } from "@/components/drives/DriveMapThumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { excludeResult, importResults } from "./api";
import type { SearchResult } from "./types";

export function ResultCard({
  slug,
  result,
  onChanged,
}: {
  slug: string;
  result: SearchResult;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<null | "import" | "exclude">(null);
  const hasGeo = result.latitude != null && result.longitude != null;
  const imported = result.importedAt != null || result.inDirectory;

  async function doImport() {
    setBusy("import");
    try {
      await importResults(slug, [result.id]);
      toast.success(`Added "${result.name ?? "showroom"}" to the directory`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import");
    } finally {
      setBusy(null);
    }
  }

  async function doExclude() {
    setBusy("exclude");
    try {
      await excludeResult(slug, result.id, { category: result.categoryGuess });
      toast.success("Won't surface this place again");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not exclude");
    } finally {
      setBusy(null);
    }
  }

  const category = result.categoryGuess ?? result.primaryType;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card sm:flex-row">
      {hasGeo && (
        <div className="w-full shrink-0 sm:w-56">
          <DriveMapThumb markers={[{ lat: result.latitude!, lng: result.longitude! }]} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold tracking-tight">{result.name ?? "Unknown place"}</h3>
          {category && (
            <Badge variant="secondary" className="capitalize">
              {category.replace(/_/g, " ")}
            </Badge>
          )}
          {result.source === "ai" && <Badge variant="outline">AI</Badge>}
          {imported && (
            <Badge variant="default" className="bg-emerald-600 text-white">
              In directory
            </Badge>
          )}
        </div>

        {result.aiReasoning && <p className="text-sm text-muted-foreground">{result.aiReasoning}</p>}
        {result.fullAddress && <p className="truncate text-xs text-muted-foreground">{result.fullAddress}</p>}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {result.googleRating != null && (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
              {result.googleRating.toFixed(1)}
              {result.userRatingCount != null && <span>({result.userRatingCount})</span>}
            </span>
          )}
          {result.distanceM != null && <span>{(result.distanceM / 1000).toFixed(1)} km</span>}
          {result.aiRelevance != null && <span>relevance {Math.round(result.aiRelevance * 100)}%</span>}
          {result.phone && (
            <a href={`tel:${result.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <Phone className="size-3.5" aria-hidden />
              {result.phone}
            </a>
          )}
          {result.website && (
            <a
              href={result.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Website
            </a>
          )}
        </div>

        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy != null || imported} onClick={doImport}>
            {busy === "import" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {imported ? "Imported" : "Add to directory"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy != null} onClick={doExclude}>
            {busy === "exclude" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Not interested
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ResultCard;
