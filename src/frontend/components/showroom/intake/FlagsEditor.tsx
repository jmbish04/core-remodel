/**
 * @fileoverview FlagsEditor — "select all that apply" showroom Attributes cards.
 *
 * A controlled, responsive grid of five toggle CARDS for the boolean showroom
 * attributes captured on intake. Each card is a full clickable button that flips
 * its flag: active cards get a tinted surface + ring + a check indicator;
 * inactive cards are muted (`bg-card ring-1 ring-border/40`). Every card carries
 * an icon, a title, and a one-line description so the meaning is self-evident
 * without a legend. Monolith dark, no 1px borders (ring-based separation only),
 * keyboard-accessible (button + aria-pressed).
 */

import {
  CalendarClock,
  Building2,
  Boxes,
  Gem,
  UserCheck,
  Check,
  type LucideIcon,
} from "lucide-react";

// ─── value shape ──────────────────────────────────────────────────────────────

export interface ShowroomFlags {
  isAppointmentOnly: boolean;
  isFlagshipLocation: boolean;
  isLargeSelection: boolean;
  isBespoke: boolean;
  isTradeRepRequired: boolean;
}

type FlagKey = keyof ShowroomFlags;

interface FlagCardDef {
  key: FlagKey;
  title: string;
  description: string;
  Icon: LucideIcon;
  /** Active tint (bg + text + ring), literal for JIT safety. */
  active: string;
}

const FLAG_CARDS: FlagCardDef[] = [
  {
    key: "isAppointmentOnly",
    title: "Appointment only",
    description: "Requires a booked appointment; no walk-ins.",
    Icon: CalendarClock,
    active: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  },
  {
    key: "isFlagshipLocation",
    title: "Flagship location",
    description: "The brand's premier / showcase location.",
    Icon: Building2,
    active: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  },
  {
    key: "isLargeSelection",
    title: "Large selection",
    description: "Big warehouse / huge inventory.",
    Icon: Boxes,
    active: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  },
  {
    key: "isBespoke",
    title: "Bespoke / curated",
    description: "Hand-curated, exclusive collection.",
    Icon: Gem,
    active: "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  },
  {
    key: "isTradeRepRequired",
    title: "Trade Rep Required",
    description: "A homeowner needs a designer/contractor to visit or buy.",
    Icon: UserCheck,
    active: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/40",
  },
];

// ─── FlagsEditor ──────────────────────────────────────────────────────────────

export interface FlagsEditorProps {
  value: ShowroomFlags;
  onChange: (v: ShowroomFlags) => void;
}

export function FlagsEditor({ value, onChange }: FlagsEditorProps) {
  const toggle = (key: FlagKey) => {
    onChange({ ...value, [key]: !value[key] });
  };

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {FLAG_CARDS.map(({ key, title, description, Icon, active }) => {
        const on = value[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(key)}
            className={`group relative flex items-start gap-3 rounded-xl p-3.5 text-left transition-colors ${
              on
                ? `ring-1 ${active}`
                : "bg-card text-muted-foreground ring-1 ring-border/40 hover:bg-muted/40 hover:text-foreground"
            }`}
          >
            <span
              className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                on ? "bg-white/10" : "bg-muted"
              }`}
            >
              <Icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{title}</span>
              <span
                className={`mt-0.5 block text-xs leading-snug ${
                  on ? "text-foreground/70" : "text-muted-foreground/70"
                }`}
              >
                {description}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full transition-all ${
                on
                  ? "bg-white/10 opacity-100"
                  : "opacity-0 group-hover:opacity-40"
              }`}
            >
              <Check className="size-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
