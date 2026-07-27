/**
 * @fileoverview Store-viewport "Visits" section (0032 V2c).
 *
 * Mounted by StoreViewportApp for the `visits` SectionKey. Shows the store's
 * pending (needs-finalizing) visits floated to the top with a Finalize
 * affordance, then the full visit timeline. Data: the admin-gated
 * GET /api/showroom-visit-logs?storeId=<id> (no ungated store sub-route).
 */
import { CircleAlert, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { listVisitLogs } from "./api";
import { VisitCard } from "./VisitCard";
import { isPending, type VisitLog } from "./types";

export function StoreVisitsSection({ storeId }: { storeId: number }) {
  const [visits, setVisits] = useState<VisitLog[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await listVisitLogs({ storeId });
        if (alive) setVisits(list);
      } catch (e) {
        console.error("[visits/store-section] load", e);
        toast.error(e instanceof Error ? e.message : "Could not load visits");
        if (alive) setVisits([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeId]);

  if (visits == null) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const pending = visits.filter((v) => isPending(v.status));
  const completed = visits.filter((v) => !isPending(v.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {visits.length} visit{visits.length === 1 ? "" : "s"}
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
              {pending.length} to finalize
            </span>
          )}
        </p>
        <a href="/admin/shopping/showrooms/visitlogs/new">
          <Button size="sm" variant="outline" className="gap-1.5">
            <Plus className="size-4" />
            Log a visit
          </Button>
        </a>
      </div>

      {pending.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
            <CircleAlert className="size-4 shrink-0" />
            Complete your visit notes — {pending.length} staged visit{pending.length === 1 ? "" : "s"} waiting.
          </div>
          {pending.map((v) => (
            <VisitCard key={v.id} visit={v} hideStore />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
          {completed.map((v) => (
            <VisitCard key={v.id} visit={v} hideStore />
          ))}
        </div>
      )}

      {visits.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No visits logged for this showroom yet.</p>
      )}
    </div>
  );
}

export default StoreVisitsSection;
