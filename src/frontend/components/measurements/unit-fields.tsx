/**
 * @fileoverview Unit-aware numeric inputs for the measurement form (0006).
 *
 * The form keeps its dimension/area state in CANONICAL US terms (feet + inches;
 * square feet) so the submit path never changes.  These components adapt entry to
 * the active unit system:
 *   - imperial → the native feet + inches (or sq ft) inputs, committing on change.
 *   - metric   → a single metres (or m²) input.  The user types freely in a local
 *     text buffer and the value is converted to canonical on BLUR (mirrors the
 *     repo's DollarInput pattern), so partial decimals like "3." don't get rewritten
 *     mid-keystroke.  The buffer re-seeds whenever the canonical value changes
 *     (form open / edit-load / a committed edit), which only happens on blur/open —
 *     never during typing.
 */

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  feetInchesToMeters,
  metersToFeetInches,
  sqftToSqm,
  sqmToSqft,
  trimDecimals,
  type UnitSystem,
} from "@/lib/units";

/** Round a real to at most 4 decimals (enough to round-trip metric entry cleanly). */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Metres string derived from a canonical feet+inches pair (empty when both blank). */
function metersSeed(feet: string, inches: string): string {
  if (!feet.trim() && !inches.trim()) return "";
  const meters = feetInchesToMeters(Number.parseFloat(feet) || 0, Number.parseFloat(inches) || 0);
  return Number.isFinite(meters) ? trimDecimals(meters, 3) : "";
}

/** m² string derived from a canonical square-footage value (empty when blank). */
function sqmSeed(sqft: string): string {
  if (!sqft.trim()) return "";
  const value = Number.parseFloat(sqft);
  return Number.isFinite(value) ? trimDecimals(sqftToSqm(value), 3) : "";
}

interface DimensionFieldProps {
  label: string;
  feet: string;
  inches: string;
  onFeet: (value: string) => void;
  onInches: (value: string) => void;
  system: UnitSystem;
}

/**
 * A labelled length input that renders feet+inches (imperial) or a single metres
 * field (metric).  Always reports back through onFeet/onInches in canonical terms.
 */
export function DimensionField({ label, feet, inches, onFeet, onInches, system }: DimensionFieldProps) {
  if (system === "metric") {
    return (
      <MetricLengthField
        label={label}
        feet={feet}
        inches={inches}
        onCommit={(metersText) => {
          const text = metersText.trim();
          if (!text) {
            onFeet("");
            onInches("");
            return;
          }
          const meters = Number.parseFloat(text);
          if (!Number.isFinite(meters)) return;
          const { feet: f, inches: i } = metersToFeetInches(meters);
          onFeet(String(f));
          onInches(String(round4(i)));
        }}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={feet}
          onChange={(e) => onFeet(e.target.value)}
          placeholder="0"
          aria-label={`${label} feet`}
        />
        <span className="text-xs text-muted-foreground">ft</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.25"
          value={inches}
          onChange={(e) => onInches(e.target.value)}
          placeholder="0"
          aria-label={`${label} inches`}
        />
        <span className="text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}

/** Metric (metres) length input — local buffer, commits to canonical on blur. */
function MetricLengthField({
  label,
  feet,
  inches,
  onCommit,
}: {
  label: string;
  feet: string;
  inches: string;
  onCommit: (metersText: string) => void;
}) {
  const seed = metersSeed(feet, inches);
  const [text, setText] = React.useState(seed);
  // Re-seed only when the canonical value actually changes (open / edit-load /
  // committed edit) — `seed` is referentially stable during typing.
  React.useEffect(() => {
    setText(seed);
  }, [seed]);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onCommit(text)}
          placeholder="0.00"
          aria-label={`${label} metres`}
        />
        <span className="text-xs text-muted-foreground">m</span>
      </div>
    </div>
  );
}

interface AreaFieldProps {
  label: string;
  /** Canonical area in square feet, as a string. */
  sqft: string;
  onChange: (value: string) => void;
  system: UnitSystem;
}

/** A labelled area input: sq ft (imperial) or m² (metric, commit-on-blur). */
export function AreaField({ label, sqft, onChange, system }: AreaFieldProps) {
  if (system === "metric") {
    return (
      <MetricAreaField
        label={label}
        sqft={sqft}
        onCommit={(sqmText) => {
          const text = sqmText.trim();
          if (!text) {
            onChange("");
            return;
          }
          const sqm = Number.parseFloat(text);
          if (!Number.isFinite(sqm)) return;
          onChange(String(round4(sqmToSqft(sqm))));
        }}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{label} (sq ft)</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={sqft}
        onChange={(e) => onChange(e.target.value)}
        placeholder="optional"
      />
    </div>
  );
}

/** Metric (m²) area input — local buffer, commits to canonical sq ft on blur. */
function MetricAreaField({
  label,
  sqft,
  onCommit,
}: {
  label: string;
  sqft: string;
  onCommit: (sqmText: string) => void;
}) {
  const seed = sqmSeed(sqft);
  const [text, setText] = React.useState(seed);
  React.useEffect(() => {
    setText(seed);
  }, [seed]);

  return (
    <div className="space-y-1.5">
      <Label>{label} (m²)</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
        placeholder="optional"
      />
    </div>
  );
}
