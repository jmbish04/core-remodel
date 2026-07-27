/**
 * @fileoverview Visit Logs workspace — list island (0032 V2c).
 *
 * Pending (anything not SUBMITTED) vs Completed (SUBMITTED), newest first.
 * The header lives in the Astro shell; this island owns the tabs + cards.
 * Data: GET /api/showroom-visit-logs?status=pending|completed.
 */
import { Loader2, PartyPopper, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { listVisitLogs } from "./api";
import { VisitCard } from "./VisitCard";
import type { VisitLog } from "./types";

type Tab = "pending" | "completed";

export function VisitLogsListApp({ initialTab = "pending" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pending, setPending] = useState<VisitLog[] | null>(null);
  const [completed, setCompleted] = useState<VisitLog[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [p, c] = await Promise.all([
          listVisitLogs({ status: "pending" }),
          listVisitLogs({ status: "completed" }),
        ]);
        if (alive) {
          setPending(p);
          setCompleted(c);
        }
      } catch (e) {
        console.error("[visits/list] load", e);
        toast.error(e instanceof Error ? e.message : "Could not load visit logs");
        if (alive) {
          setPending([]);
          setCompleted([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = tab === "pending" ? pending : completed;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted/40 p-1 ring-1 ring-border/40">
          {(["pending", "completed"] as Tab[]).map((t) => {
            const count = t === "pending" ? pending?.length : completed?.length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
                {count != null && <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>}
              </button>
            );
          })}
        </div>
        <a href="/admin/shopping/showrooms/visitlogs/new">
          <Button size="sm" className="gap-1.5">
            <Plus className="size-4" />
            New visit log
          </Button>
        </a>
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
              <p className="text-sm font-medium text-foreground">You&rsquo;re all caught up</p>
              <p className="text-xs">No visits waiting to be finalized.</p>
            </>
          ) : (
            <p className="text-sm">No submitted visits yet.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((v) => (
            <VisitCard key={v.id} visit={v} />
          ))}
        </div>
      )}
    </div>
  );
}

export default VisitLogsListApp;
