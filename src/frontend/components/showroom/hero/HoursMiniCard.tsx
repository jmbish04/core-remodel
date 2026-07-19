/**
 * @fileoverview HoursMiniCard — compact "Showroom Hours" card for the hero.
 *
 * Layout (one fact per line, no run-on summary strings):
 *
 *   Showroom Hours          [Open Now]
 *   Mon–Fri   9:00 AM–5:00 PM
 *   Sat       11:00 AM–3:00 PM
 *   Sun       Closed
 *
 * The status badge is live and full-width — four colour-coded states (open /
 * closing soon / opening soon / closed) from the PST-aware `computeOpenBadge`,
 * sized to be readable at arm's length from a car screen. The whole card is a
 * button — clicking opens the advanced hours/contact/map modal.
 *
 * Weekdays collapse to a single "Mon–Fri" line only when every OPEN weekday
 * shares one window; otherwise each weekday gets its own line rather than
 * hiding the variation behind "times vary".
 */

import { ChevronRight, Clock } from "lucide-react";

import type { DayKey, DayHours, HoursJson } from "../intake/hours-types";
import { DAY_LABELS, to12h } from "../intake/hours-types";
import {
  computeOpenBadge,
  hoursJsonToRows,
  pstNow,
  type OpenBadge,
} from "../hours-status";

// ─── Status badge ─────────────────────────────────────────────────────────────

/**
 * Four colour-coded states — `opening-soon` (closed now, opens later today) is
 * split out of `closed` so a store you can still catch today doesn't read as
 * shut. Rendered full-bleed across the card so it's legible at a glance from a
 * car screen.
 */
const BADGE_STYLES: Record<OpenBadge, { label: string; className: string }> = {
  open: {
    label: "Open Now",
    className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  },
  "closing-soon": {
    label: "Closing Soon",
    className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  },
  "opening-soon": {
    label: "Opening Soon",
    className: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  },
  closed: {
    label: "Closed",
    className: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  },
};

function StatusBadge({ badge }: { badge: OpenBadge }) {
  const { label, className } = BADGE_STYLES[badge];
  return (
    <span
      className={`block w-full rounded-md px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide ring-1 ${className}`}
    >
      {label}
    </span>
  );
}

// ─── Line building ────────────────────────────────────────────────────────────

/** One rendered row of the card: a day label and its hours (or "Closed"). */
interface HoursLine {
  key: string;
  days: string;
  hours: string;
}

/** "9:00 AM–5:00 PM" for an open window. */
function windowLabel(d: DayHours): string {
  const o = to12h(d.open);
  const c = to12h(d.close);
  return `${o.time} ${o.period}–${c.time} ${c.period}`;
}

const WEEKDAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri"];

function sameWindow(a: DayHours | null, b: DayHours | null): boolean {
  if (a === null || b === null) return a === b;
  return a.open === b.open && a.close === b.close;
}

/** Abbreviated day name ("Mon", "Sat"). */
function abbrev(k: DayKey): string {
  return DAY_LABELS[k].full.slice(0, 3);
}

/**
 * Build the card's display lines from structured hours: a collapsed "Mon–Fri"
 * row when the weekdays agree (else one row per weekday), then Sat, then Sun.
 * Returns an empty array when nothing is known.
 */
export function buildHoursLines(h: HoursJson): HoursLine[] {
  const lines: HoursLine[] = [];
  const weekdayWindows = WEEKDAY_KEYS.map((k) => h?.[k] ?? null);
  const weekdaysAgree = weekdayWindows.every((w) => sameWindow(w, weekdayWindows[0]));

  if (weekdaysAgree) {
    lines.push({
      key: "weekdays",
      days: "Mon–Fri",
      hours: weekdayWindows[0] ? windowLabel(weekdayWindows[0]) : "Closed",
    });
  } else {
    for (const k of WEEKDAY_KEYS) {
      const w = h?.[k] ?? null;
      lines.push({ key: k, days: abbrev(k), hours: w ? windowLabel(w) : "Closed" });
    }
  }

  for (const k of ["sat", "sun"] as DayKey[]) {
    const w = h?.[k] ?? null;
    lines.push({ key: k, days: abbrev(k), hours: w ? windowLabel(w) : "Closed" });
  }

  return lines;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HoursMiniCard({
  hoursJson,
  onClick,
}: {
  hoursJson: HoursJson | null | undefined;
  onClick: () => void;
}) {
  const lines = hoursJson ? buildHoursLines(hoursJson) : [];
  const rows = hoursJson ? hoursJsonToRows(hoursJson) : [];
  const badge = rows.length > 0 ? computeOpenBadge(rows, pstNow()) : null;
  // A store closed literally every day yields lines but no rows — there is no
  // meaningful weekly schedule to show, so fall through to the unknown state.
  const hasHours = rows.length > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/hours w-full rounded-lg bg-card p-3 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40 sm:w-60"
      aria-label="View full business hours, contact info, and map"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <Clock className="size-4 shrink-0" />
        Showroom Hours
        <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover/hours:translate-x-0.5" />
      </p>

      {badge ? (
        <p className="mt-2">
          <StatusBadge badge={badge} />
        </p>
      ) : null}

      {hasHours ? (
        <dl className="mt-2 space-y-0.5">
          {lines.map((l) => (
            <div key={l.key} className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-muted-foreground">{l.days}</dt>
              <dd
                className={`text-xs tabular-nums ${
                  l.hours === "Closed" ? "text-muted-foreground/50" : "text-foreground"
                }`}
              >
                {l.hours}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground/70">Hours unknown</p>
      )}
    </button>
  );
}
