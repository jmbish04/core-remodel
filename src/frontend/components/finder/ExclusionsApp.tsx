/**
 * @fileoverview ExclusionsApp (0032 D2d) — the not-interested list. Reads
 * /api/showroom-exclusions and lets the owner remove one (so the place can resurface).
 */
import { Loader2, RotateCcw, Ban } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { listExclusions, removeExclusion } from "./api";
import type { Exclusion } from "./types";

export function ExclusionsApp() {
  const [exclusions, setExclusions] = useState<Exclusion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listExclusions();
      setExclusions(data.exclusions);
      setLoadError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load exclusions";
      toast.error(msg);
      // Keep the list null and record the error — don't render a false "nothing excluded" empty state.
      setLoadError(msg);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRemove(id: number) {
    setBusy(id);
    try {
      await removeExclusion(id);
      toast.success("Removed — this place can resurface again");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setBusy(null);
    }
  }

  if (exclusions == null) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/40 py-12 text-center text-muted-foreground">
          <p>Couldn't load your not-interested list — {loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RotateCcw className="size-4" />
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (exclusions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-12 text-center text-muted-foreground">
        <Ban className="size-8" aria-hidden />
        <p>Nothing excluded yet. "Not interested" on a finder result adds it here.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {exclusions.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3"
        >
          <span className="min-w-0 flex-1 truncate font-medium">{e.name ?? e.placeId ?? "Unknown place"}</span>
          {e.category && (
            <Badge variant="secondary" className="capitalize">
              {e.category.replace(/_/g, " ")}
            </Badge>
          )}
          <Badge variant="outline">{e.source}</Badge>
          <Button size="sm" variant="ghost" disabled={busy === e.id} onClick={() => onRemove(e.id)}>
            {busy === e.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Un-exclude
          </Button>
        </li>
      ))}
    </ul>
  );
}

export default ExclusionsApp;
