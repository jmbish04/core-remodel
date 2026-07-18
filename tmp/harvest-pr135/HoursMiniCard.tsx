/**
 * @fileoverview HoursMiniCard — compact "Showroom Hours" card for the hero.
 *
 * Deliberately simple: a Clock heading, at most two summary lines (weekday +
 * weekend), and a live open/closed status badge. Anything more detailed (the
 * full weekly table, contact, map) lives one click away in HoursContactModal.
 * Summary lines + badge are derived from the structured `hoursJson`.
 */

import { ChevronRight, Clock } from "lucide-react";

import type { HoursJson } from "../intake/hours-types";
import { weekdayWeekendLines } from "../intake/hours-types";
import {
  computeOpenBadge,
  computePst,
  hourRowsFromHoursJson,
  type OpenBadge,
} from "../hours-status";

/** Badge state → label + tint classes (JIT-safe literal classNames). */
const BADGE_STYLES: Record<OpenBadge, { label: string; className: string }> = {
  open: { label: "Open Now", className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  "closing-soon": {
    label: "Closing Soon",
    className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  },
  "opening-soon": {
    label: "Opening Soon",
    className: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  },
  closed: { label: "Closed Today", className: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
};

function StatusBadge({ badge }: { badge: OpenBadge }) {
  const { label, className } = BADGE_STYLES[badge];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${className}`}
    >
      {label}
    </span>
  );
}

export function HoursMiniCard({
  hoursJson,
  onClick,
}: {
  hoursJson: HoursJson | null | undefined;
  onClick: () => void;
}) {
  const structured = hoursJson ? weekdayWeekendLines(hoursJson) : null;
  const weekday = structured?.weekday ?? null;
  const weekend = structured?.weekend ?? null;
  const hasHours = Boolean(weekday || weekend);

  // Live open/closed badge from the structured hours (needs the day windows).
  const badge = hoursJson ? computeOpenBadge(hourRowsFromHoursJson(hoursJson), computePst()) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/hours w-full rounded-lg bg-card p-3 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40 sm:w-60"
      aria-label="View full showroom hours, contact info, and map"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <Clock className="size-4" />
        Showroom Hours
        <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60 transition-transform group-hover/hours:translate-x-0.5" />
      </p>

      {badge ? (
        <div className="mt-2">
          <StatusBadge badge={badge} />
        </div>
      ) : null}

      {hasHours ? (
        <div className="mt-2 space-y-0.5">
          {weekday ? (
            <p className="truncate text-sm text-muted-foreground">{weekday}</p>
          ) : null}
          {weekend ? (
            <p className="truncate text-sm text-muted-foreground">{weekend}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground/70">Hours unknown</p>
      )}

      <p className="mt-1.5 text-[11px] text-muted-foreground/60">
        Full hours · contact · map
      </p>
    </button>
  );
}
