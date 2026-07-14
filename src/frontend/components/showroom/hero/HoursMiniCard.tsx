/**
 * @fileoverview HoursMiniCard — compact "Office Hours" card for the showroom hero.
 *
 * Two summary lines (weekday + weekend) under a Clock heading, styled as a
 * Monolith mini-card (bg-card + ring, no 1px borders). The whole card is a
 * button — clicking opens the full hours/contact/map modal. Summary lines are
 * derived from the structured `hoursJson`. Renders a subtle "Hours unknown"
 * card when no hour data exists so the modal (contact + map) stays reachable.
 */

import { ChevronRight, Clock } from "lucide-react";

import type { HoursJson } from "../intake/hours-types";
import { weekdayWeekendLines } from "../intake/hours-types";

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

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/hours w-full rounded-lg bg-card p-3 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40 sm:w-60"
      aria-label="View full business hours, contact info, and map"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <Clock className="size-4" />
        Office Hours
        <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60 transition-transform group-hover/hours:translate-x-0.5" />
      </p>
      {hasHours ? (
        <>
          {weekday ? (
            <p className="mt-1 text-sm text-muted-foreground">{weekday}</p>
          ) : null}
          {weekend ? (
            <p className="text-sm text-muted-foreground">{weekend}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground/70">Hours unknown</p>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground/60">
        Full hours · contact · map
      </p>
    </button>
  );
}
