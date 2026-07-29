/**
 * @fileoverview A single visit-log card row (0032 V2c) — shared by the workspace
 * list and the store-viewport Visits section.
 *
 * Surfaces the attestation at a glance: store, lifecycle status, provenance
 * source + how far the fix was, drive context, arrival + dwell, rating. A pending
 * visit gets a "Finalize" affordance; a submitted one just opens.
 */
import { ArrowRight, CalendarClock, Route } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { NoteBody } from "@/components/showroom/NoteBody";
import { SourceBadge, VisitStatusBadge, VisitTypeChip } from "./Badges";
import { StarsReadOnly } from "./StarRating";
import { formatDistance, formatDwell, isPending, type VisitLog } from "./types";

/** "Jul 26, 3:14 PM" or "—". */
function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

export function VisitCard({ visit, hideStore = false }: { visit: VisitLog; hideStore?: boolean }) {
  const pending = isPending(visit.status);
  const distance = formatDistance(visit.matchDistanceM);
  const href = `/admin/shopping/showrooms/visitlogs/${visit.id}`;

  return (
    <Card className="p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {!hideStore && (
            <div className="truncate text-sm font-semibold text-foreground">
              {visit.storeName ?? (
                <span className="text-muted-foreground italic">Unbound showroom</span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <VisitStatusBadge status={visit.status} />
            <VisitTypeChip visitType={visit.visitType} />
            <SourceBadge source={visit.gpsSource} />
            {distance && (
              <span className="text-[11px] text-muted-foreground">parked {distance}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" />
              {fmtWhen(visit.arrivalAt)}
            </span>
            <span>dwell {formatDwell(visit.dwellSeconds)}</span>
            {visit.driveListId != null && (
              <span className="inline-flex items-center gap-1">
                <Route className="size-3.5" />
                Drive #{visit.driveListId}
              </span>
            )}
          </div>
          {(visit.notesMarkdown?.trim() || visit.notesHtml?.trim()) && (
            <NoteBody
              className="line-clamp-3 text-muted-foreground"
              markdown={visit.notesMarkdown}
              html={visit.notesHtml}
            />
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StarsReadOnly rating={visit.rating} />
          <a href={href}>
            <Badge variant={pending ? "default" : "outline"} className="cursor-pointer gap-1">
              {pending ? "Finalize" : "Open"}
              <ArrowRight className="size-3" />
            </Badge>
          </a>
        </div>
      </div>
    </Card>
  );
}
