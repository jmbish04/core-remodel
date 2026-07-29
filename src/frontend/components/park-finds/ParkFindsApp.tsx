/**
 * @fileoverview Park-Finds workspace — list island (0032 D1b).
 *
 * The review inbox for proximity-scan discoveries (decision 1.d): places the car
 * parked at that weren't a registered showroom. Two tabs — Awaiting review (TBD) vs
 * Decided (PROCESS / DO_NOT_PROCESS), newest first. The header lives in the Astro
 * shell; this island owns the tabs + cards. Data: GET /api/showroom-hitl-queue.
 */
import { Loader2, PartyPopper } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { listParkFinds } from "./api";
import { ParkFindCard } from "./ParkFindCard";
import type { ParkFindCandidate } from "./types";

type Tab = "pending" | "decided";

export function ParkFindsApp({ initialTab = "pending" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [candidates, setCandidates] = useState<ParkFindCandidate[] | null>(null);
  /** Locally "decide later"-dismissed ids — hidden until reload. */
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await listParkFinds();
      setCandidates(data.candidates);
    } catch (e) {
      console.error("[park-finds/list] load", e);
      toast.error(e instanceof Error ? e.message : "Could not load park finds");
      setCandidates([]);
    }
  }, []);

  // One fetch implementation (`load`) for both mount and post-decision refetch, so
  // the two paths can't diverge.
  useEffect(() => {
    void load();
  }, [load]);

  // After a server decision, refetch the whole list so counts + membership are honest,
  // and poke the sidebar so its TBD badge updates.
  const onDecided = useCallback(() => {
    void load();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("park-finds-updated"));
  }, [load]);

  const onDismiss = useCallback((id: number) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const pending = candidates?.filter((c) => c.userDecision === "TBD" && !dismissed.has(c.id)) ?? null;
  const decided = candidates?.filter((c) => c.userDecision !== "TBD") ?? null;
  const rows = tab === "pending" ? pending : decided;

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg bg-muted/40 p-1 ring-1 ring-border/40">
        {(["pending", "decided"] as Tab[]).map((t) => {
          const count = t === "pending" ? pending?.length : decided?.length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "pending" ? "Awaiting review" : "Decided"}
              {count != null && <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>}
            </button>
          );
        })}
      </div>

      {rows == null ? (
        <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          {tab === "pending" ? (
            <>
              <PartyPopper className="size-8 text-emerald-400" />
              <p className="text-sm font-medium text-foreground">No park finds to review</p>
              <p className="text-xs">
                When the car parks somewhere new and remodel-relevant, it lands here.
              </p>
            </>
          ) : (
            <p className="text-sm">No decisions yet.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <ParkFindCard key={c.id} candidate={c} onDecided={onDecided} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ParkFindsApp;
