import * as React from "react";

import { InputGroup, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

/**
 * Parse free-text currency ("$1,299.00", "1,299", "1299") to INTEGER CENTS, or
 * null when there's no parseable number ("call for pricing"). Mirrors the
 * backend `parsePriceCents` so the numeric field the API stores matches what the
 * user sees. Best-effort — the free text is always preserved verbatim too.
 */
export function parsePriceCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const dollars = Number.parseFloat(cleaned);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

export interface CurrencyInputProps
  extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  /** The free-text value, verbatim (e.g. "1,299.00"). */
  value: string;
  /**
   * Fires on every edit with BOTH representations — the verbatim text and the
   * derived integer cents (null when not numeric). Store both: a `*_text` column
   * and a numeric `*_cents` column, per the AGENTS.md currency rule.
   */
  onValueChange: (text: string, cents: number | null) => void;
  /** Currency symbol shown in the (non-interactive) prepend addon. Default "$". */
  symbol?: string;
}

/**
 * Reusable currency / price input. Renders a `$`-prepended field and hands back
 * both the verbatim text and integer cents on every change. USE THIS for every
 * price/currency data-entry field — never a bare `<Input>` for money.
 */
export function CurrencyInput({
  value,
  onValueChange,
  symbol = "$",
  placeholder = "0.00",
  className,
  ...props
}: CurrencyInputProps) {
  return (
    <InputGroup className={className}>
      <InputGroupText
        aria-hidden="true"
        className="pointer-events-none bg-muted px-3 font-mono text-muted-foreground"
      >
        {symbol}
      </InputGroupText>
      <InputGroupInput
        inputMode="decimal"
        placeholder={placeholder}
        aria-label={props["aria-label"] ?? "Amount"}
        value={value}
        onChange={(e) => onValueChange(e.target.value, parsePriceCents(e.target.value))}
        {...props}
      />
    </InputGroup>
  );
}
