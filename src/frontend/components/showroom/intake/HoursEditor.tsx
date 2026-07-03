/**
 * @fileoverview HoursEditor — structured weekly-hours editor for showroom intake.
 *
 * Renders a Monolith-dark, mobile-responsive editor over the canonical
 * `HoursJson` model (see ./hours-types). Two layers:
 *
 *   1. Standard mode — a row of seven day-toggle chips (Mon→Sun) plus, for each
 *      OPEN day, a compact open-time / close-time `<Select>` pair drawn from the
 *      curated `OPEN_TIME_OPTIONS` / `CLOSE_TIME_OPTIONS` lists. Toggling a day
 *      on seeds it from the last open day's window (or 9–5); toggling off nulls
 *      it. This covers the overwhelmingly common "9–5 weekdays" case in a couple
 *      of clicks.
 *
 *   2. Custom hours — an escape-hatch table (one row per day) with manual
 *      HH:MM-ish text inputs + AM/PM toggles for stores with non-standard hours
 *      the curated Selects can't express. Values round-trip through
 *      `from12h`/`to12h`.
 *
 * Every mutation produces a fresh `HoursJson` and calls `onChange`. The
 * component is controlled: it seeds local state from `value ?? DEFAULT_HOURS`
 * and re-seeds whenever a *different* `value` object arrives from the parent.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  CLOSE_TIME_OPTIONS,
  DAY_KEYS,
  DAY_LABELS,
  DEFAULT_DAY_HOURS,
  DEFAULT_HOURS,
  OPEN_TIME_OPTIONS,
  formatHoursSummary,
  from12h,
  to12h,
  type DayHours,
  type DayKey,
  type HoursJson,
} from "./hours-types";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Deep-clone an HoursJson so we never mutate the caller's object in place. */
function cloneHours(h: HoursJson): HoursJson {
  const out = {} as HoursJson;
  for (const k of DAY_KEYS) {
    const d = h[k];
    out[k] = d ? { open: d.open, close: d.close } : null;
  }
  return out;
}

/** Coerce a possibly-partial object into a complete HoursJson (missing → null). */
function normalize(h: HoursJson | null | undefined): HoursJson {
  const src = h ?? DEFAULT_HOURS;
  const out = {} as HoursJson;
  for (const k of DAY_KEYS) {
    const d = src[k];
    out[k] = d ? { open: d.open, close: d.close } : null;
  }
  return out;
}

/** The window a newly-opened day should inherit: the last open day, else 9–5. */
function seedForNewOpenDay(h: HoursJson): DayHours {
  for (let i = DAY_KEYS.length - 1; i >= 0; i--) {
    const d = h[DAY_KEYS[i]];
    if (d) return { open: d.open, close: d.close };
  }
  return { ...DEFAULT_DAY_HOURS };
}

// ─── standard-mode per-day time Selects ───────────────────────────────────────

function OpenCloseSelects({
  day,
  hours,
  onChange,
}: {
  day: DayKey;
  hours: DayHours;
  onChange: (next: DayHours) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={hours.open}
        onValueChange={(v) => v && onChange({ ...hours, open: v })}
      >
        <SelectTrigger className="h-7 w-[92px] text-xs" aria-label={`${DAY_LABELS[day].full} open time`}>
          <SelectValue items={OPEN_TIME_OPTIONS} />
        </SelectTrigger>
        <SelectContent>
          {OPEN_TIME_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">to</span>
      <Select
        value={hours.close}
        onValueChange={(v) => v && onChange({ ...hours, close: v })}
      >
        <SelectTrigger className="h-7 w-[92px] text-xs" aria-label={`${DAY_LABELS[day].full} close time`}>
          <SelectValue items={CLOSE_TIME_OPTIONS} />
        </SelectTrigger>
        <SelectContent>
          {CLOSE_TIME_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── AM/PM two-button toggle (radio-group is not installed) ────────────────────

function AmPmToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: "AM" | "PM";
  onChange: (v: "AM" | "PM") => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md bg-card ring-1 ring-border/40" role="group" aria-label={ariaLabel}>
      {(["AM", "PM"] as const).map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(p)}
            className={`px-2 py-1 text-[11px] font-medium transition-colors ${
              active ? "bg-white text-black" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

// ─── custom-mode per-day row ──────────────────────────────────────────────────

function CustomDayRow({
  day,
  hours,
  onToggle,
  onChange,
}: {
  day: DayKey;
  hours: DayHours | null;
  onToggle: (open: boolean) => void;
  onChange: (next: DayHours) => void;
}) {
  const closed = hours === null;
  const open12 = hours ? to12h(hours.open) : { time: "9:00", period: "AM" as const };
  const close12 = hours ? to12h(hours.close) : { time: "5:00", period: "PM" as const };

  return (
    <tr className="align-middle">
      <td className="py-2 pr-3 text-xs font-medium whitespace-nowrap text-foreground">
        {DAY_LABELS[day].full}
      </td>

      {closed ? (
        <td colSpan={2} className="py-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => onToggle(true)}
          >
            Closed — set hours
          </Button>
        </td>
      ) : (
        <>
          {/* Open */}
          <td className="py-2 pr-3">
            <div className="flex items-center gap-1.5">
              <Input
                value={open12.time}
                inputMode="numeric"
                aria-label={`${DAY_LABELS[day].full} open time`}
                onChange={(e) =>
                  onChange({ ...hours!, open: from12h(e.target.value, open12.period) })
                }
                className="h-7 w-16 text-xs"
              />
              <AmPmToggle
                value={open12.period}
                ariaLabel={`${DAY_LABELS[day].full} open AM or PM`}
                onChange={(p) => onChange({ ...hours!, open: from12h(open12.time, p) })}
              />
            </div>
          </td>
          {/* Close */}
          <td className="py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                value={close12.time}
                inputMode="numeric"
                aria-label={`${DAY_LABELS[day].full} close time`}
                onChange={(e) =>
                  onChange({ ...hours!, close: from12h(e.target.value, close12.period) })
                }
                className="h-7 w-16 text-xs"
              />
              <AmPmToggle
                value={close12.period}
                ariaLabel={`${DAY_LABELS[day].full} close AM or PM`}
                onChange={(p) => onChange({ ...hours!, close: from12h(close12.time, p) })}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => onToggle(false)}
              >
                Closed
              </Button>
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

// ─── HoursEditor ──────────────────────────────────────────────────────────────

export interface HoursEditorProps {
  value: HoursJson | null;
  onChange: (h: HoursJson) => void;
}

export function HoursEditor({ value, onChange }: HoursEditorProps) {
  const [hours, setHours] = useState<HoursJson>(() => normalize(value));
  const [showCustom, setShowCustom] = useState(false);

  // Re-seed local state whenever a *different* value object arrives from the
  // parent (identity check — the editor's own edits set the same object it just
  // emitted, so this won't clobber in-flight typing).
  useEffect(() => {
    if (value) setHours(normalize(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: HoursJson) => {
    setHours(next);
    onChange(next);
  };

  const toggleDay = (day: DayKey, open: boolean) => {
    const next = cloneHours(hours);
    next[day] = open ? seedForNewOpenDay(hours) : null;
    commit(next);
  };

  const setDayHours = (day: DayKey, dh: DayHours) => {
    const next = cloneHours(hours);
    next[day] = dh;
    commit(next);
  };

  const summary = useMemo(() => formatHoursSummary(hours), [hours]);

  return (
    <div className="space-y-3">
      {/* Day-toggle chips */}
      <div className="flex flex-wrap gap-1.5">
        {DAY_KEYS.map((day) => {
          const open = hours[day] !== null;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={open}
              aria-label={`${DAY_LABELS[day].full} ${open ? "open" : "closed"}`}
              onClick={() => toggleDay(day, !open)}
              className={`flex size-8 items-center justify-center rounded-md text-xs font-semibold transition-colors ${
                open
                  ? "bg-white text-black"
                  : "bg-card text-muted-foreground ring-1 ring-border/40 hover:text-foreground"
              }`}
            >
              {DAY_LABELS[day].short}
            </button>
          );
        })}
      </div>

      {/* Live summary */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="size-3 shrink-0" />
        <span className="line-clamp-1">{summary}</span>
      </div>

      {/* Standard per-open-day time Selects */}
      <div className="space-y-1.5">
        {DAY_KEYS.filter((d) => hours[d] !== null).map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <span className="w-9 shrink-0 text-xs font-medium text-foreground">
              {DAY_LABELS[day].full.slice(0, 3)}
            </span>
            <OpenCloseSelects
              day={day}
              hours={hours[day] as DayHours}
              onChange={(dh) => setDayHours(day, dh)}
            />
          </div>
        ))}
        {DAY_KEYS.every((d) => hours[d] === null) && (
          <p className="text-xs text-muted-foreground/70">
            Closed every day — toggle a day above to set hours.
          </p>
        )}
      </div>

      {/* Custom-hours escape hatch */}
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={showCustom}
          onClick={() => setShowCustom((s) => !s)}
          className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={`size-3 transition-transform ${showCustom ? "rotate-180" : ""}`}
          />
          Custom hours
        </Button>

        {showCustom && (
          <div className="mt-2 overflow-x-auto rounded-lg bg-card p-2 ring-1 ring-border/40">
            <table className="w-full min-w-[360px] border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  <th className="pb-1 pr-3 font-normal">Day</th>
                  <th className="pb-1 pr-3 font-normal">Open</th>
                  <th className="pb-1 font-normal">Close</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {DAY_KEYS.map((day) => (
                  <CustomDayRow
                    key={day}
                    day={day}
                    hours={hours[day]}
                    onToggle={(open) => toggleDay(day, open)}
                    onChange={(dh) => setDayHours(day, dh)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
