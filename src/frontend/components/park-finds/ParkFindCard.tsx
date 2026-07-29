/**
 * @fileoverview Park-Finds candidate card (0032 D1b).
 *
 * One discovery candidate the proximity scan staged (decision 1.d). Shows the
 * guessed name, a category chip, the AI one-liner, the drive it was found on, a
 * one-marker mini-map, and the distance from the park point. TBD cards carry the
 * three decisions (Add to directory / Not relevant / Decide later); decided cards
 * render read-only with an outcome chip.
 */
import { CheckCheck, Clock, MapPin, Sparkles, Telescope, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DriveMapThumb } from "@/components/drives/DriveMapThumb";
import { Button } from "@/components/ui/button";

import { decideParkFind } from "./api";
import { DECISION_LABEL, type ParkFindCandidate, type ScanPacket } from "./types";

function relTime(ts: number | string | null): string | null {
  if (ts == null) return null;
  const ms = typeof ts === "number" ? ts * 1000 : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Pull the scan distance out of the provenance packet, if present. */
function scanDistance(json: string | null): number | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as ScanPacket;
    const d = p.chosen?.distanceM;
    return typeof d === "number" ? d : null;
  } catch {
    return null;
  }
}

export function ParkFindCard({
  candidate,
  onDecided,
  onDismiss,
}: {
  candidate: ParkFindCandidate;
  /** Called after a server decision so the list can refetch counts + rows. */
  onDecided: (id: number) => void;
  /** Local "decide later" — drop the card from view without a server call. */
  onDismiss: (id: number) => void;
}) {
  const [busy, setBusy] = useState<null | "PROCESS" | "DO_NOT_PROCESS">(null);
  const isTbd = candidate.userDecision === "TBD";
  const distanceM = scanDistance(candidate.proximityScanJson);
  const when = relTime(candidate.createdAt);
  const hasGeo = candidate.latitude != null && candidate.longitude != null;

  async function decide(decision: "PROCESS" | "DO_NOT_PROCESS") {
    setBusy(decision);
    try {
      const res = await decideParkFind(candidate.id, {
        decision,
        // A rejection also drops a permanent exclusion so the place never re-surfaces.
        addExclusion: decision === "DO_NOT_PROCESS",
      });
      if (!res.ok) throw new Error("Decision was not applied");
      toast.success(
        decision === "PROCESS"
          ? `Added “${candidate.name}” to the directory`
          : `Marked “${candidate.name}” not relevant`,
      );
      onDecided(candidate.id);
    } catch (e) {
      console.error("[park-finds/decide]", e);
      toast.error(e instanceof Error ? e.message : "Could not apply the decision");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* Mini-map */}
        <div className="w-full shrink-0 overflow-hidden rounded-lg sm:w-56">
          {hasGeo ? (
            <DriveMapThumb markers={[{ lat: candidate.latitude!, lng: candidate.longitude! }]} />
          ) : (
            <div className="flex aspect-[16/9] items-center justify-center bg-muted/40 text-muted-foreground">
              <MapPin className="size-6" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Telescope className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <h3 className="truncate text-base font-semibold text-foreground">{candidate.name}</h3>
            {candidate.categoryGuess && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border/40">
                {candidate.categoryGuess.replace(/_/g, " ")}
              </span>
            )}
            {!isTbd && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                  candidate.userDecision === "PROCESS"
                    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                    : "bg-muted/60 text-muted-foreground ring-border/40"
                }`}
              >
                {DECISION_LABEL[candidate.userDecision]}
              </span>
            )}
          </div>

          {candidate.description && (
            <p className="text-sm text-muted-foreground">{candidate.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3" /> Proximity scan
            </span>
            {distanceM != null && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" /> {distanceM} m from park
              </span>
            )}
            {candidate.driveListTitle && (
              <span className="truncate">Found on: {candidate.driveListTitle}</span>
            )}
            {when && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {when}
              </span>
            )}
          </div>

          {isTbd && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" className="gap-1.5" disabled={busy != null} onClick={() => decide("PROCESS")}>
                <CheckCheck className="size-4" />
                Add to directory
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy != null}
                onClick={() => decide("DO_NOT_PROCESS")}
              >
                <Trash2 className="size-4" />
                Not relevant
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                disabled={busy != null}
                onClick={() => onDismiss(candidate.id)}
              >
                <X className="size-4" />
                Decide later
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
