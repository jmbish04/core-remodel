/**
 * @fileoverview UnitToggle — compact segmented control to switch the app-wide
 * measurement display/entry units between US (imperial) and metric (0006).
 *
 * Backed by `useUnitSystem`, so toggling here updates every measurement surface on
 * the page (and other tabs) at once.  Styled per the Monolith rule — a `ring`-bounded
 * pill, no 1px borders.
 */

import { useUnitSystem } from "@/lib/use-unit-system";
import { UNIT_LABEL, type UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";

const OPTIONS: UnitSystem[] = ["imperial", "metric"];

export function UnitToggle({ className }: { className?: string }) {
  const [unitSystem, setUnitSystem] = useUnitSystem();

  return (
    <div
      role="group"
      aria-label="Measurement units"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 ring-1 ring-border/40",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = unitSystem === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setUnitSystem(option)}
            aria-pressed={active}
            title={`Show measurements in ${UNIT_LABEL[option].label} (${UNIT_LABEL[option].length})`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {UNIT_LABEL[option].label}
          </button>
        );
      })}
    </div>
  );
}
