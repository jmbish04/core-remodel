/**
 * @fileoverview FlagsEditor — "select all that apply" showroom trait chips.
 *
 * A compact, controlled group of four toggle chips for the boolean showroom
 * traits captured on intake. Pressed chips are tinted/active; unpressed are
 * muted. Each chip carries a short label + a one-line description so the meaning
 * is self-evident without a legend. Monolith dark, no 1px borders (ring-based
 * separation only).
 */

import {
  Sparkles,
  Warehouse,
  Gem,
  Users,
  type LucideIcon,
} from "lucide-react";

// ─── value shape ──────────────────────────────────────────────────────────────

export interface ShowroomFlags {
  isFlagshipLocation: boolean;
  isLargeSelection: boolean;
  isBespoke: boolean;
  isDesignerOnly: boolean;
}

type FlagKey = keyof ShowroomFlags;

interface FlagChipDef {
  key: FlagKey;
  label: string;
  description: string;
  Icon: LucideIcon;
  /** Active tint (bg + text + ring), literal for JIT safety. */
  active: string;
}

const FLAG_CHIPS: FlagChipDef[] = [
  {
    key: "isFlagshipLocation",
    label: "Flagship location",
    description: "The brand's premier / showcase location",
    Icon: Sparkles,
    active: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  },
  {
    key: "isLargeSelection",
    label: "Large selection",
    description: "Big warehouse / huge inventory",
    Icon: Warehouse,
    active: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  },
  {
    key: "isBespoke",
    label: "Bespoke / curated",
    description: "Hand-curated, exclusive collection",
    Icon: Gem,
    active: "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  },
  {
    key: "isDesignerOnly",
    label: "Designer-only",
    description: "Advertises working with designers only",
    Icon: Users,
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {FLAG_CHIPS.map(({ key, label, description, Icon, active }) => {
        const on = value[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(key)}
            className={`group flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
              on
                ? `ring-1 ${active}`
                : "bg-card text-muted-foreground ring-1 ring-border/40 hover:bg-muted/40 hover:text-foreground"
            }`}
          >
            <span
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                on ? "bg-white/10" : "bg-muted"
              }`}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium">{label}</span>
              <span
                className={`block text-[11px] leading-snug ${
                  on ? "text-foreground/70" : "text-muted-foreground/70"
                }`}
              >
                {description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
