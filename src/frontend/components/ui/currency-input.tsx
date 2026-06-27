import * as React from "react"

import { DollarSign } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"

interface CurrencyInputProps {
  /** Value in cents (e.g., 12345 for $123.45). */
  value?: number
  /** Called with the new value in cents whenever the user types. */
  onChange?: (value: number) => void
  /** Placeholder text shown when the input is empty. */
  placeholder?: string
  /** Disables the input. */
  disabled?: boolean
  /** Additional class names for the outer wrapper. */
  className?: string
  /** HTML id for the underlying <input> element. */
  id?: string
  /** HTML name for form submission. */
  name?: string
}

/**
 * CurrencyInput — a cents-based currency input field.
 *
 * Stores value as integer cents internally (e.g. 12345 = $123.45).
 * Renders a formatted dollar display with a $ icon addon using the
 * project's existing InputGroup system.
 *
 * Usage:
 * ```tsx
 * const [price, setPrice] = useState(0)
 * <CurrencyInput value={price} onChange={setPrice} />
 * ```
 */
function CurrencyInput({
  value = 0,
  onChange,
  placeholder = "0.00",
  disabled = false,
  className,
  id,
  name,
}: CurrencyInputProps) {
  /**
   * Format integer cents to a localized decimal string.
   * 12345 → "123.45", 0 → "0.00"
   */
  const formatDisplayValue = (cents: number): string => {
    if (!cents) return "0.00"
    return (cents / 100).toFixed(2)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip everything that isn't a digit to get the raw numeric sequence.
    // Typing "1" → "1" cents, "12" → "12" cents, "123" → $1.23, etc.
    const digitsOnly = e.target.value.replace(/\D/g, "")

    // Prevent leading-zero buildup when the field is cleared.
    const centsValue = digitsOnly === "" ? 0 : parseInt(digitsOnly, 10)

    onChange?.(centsValue)
  }

  return (
    <InputGroup className={cn("max-w-xs", className)}>
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <DollarSign className="size-4" aria-hidden="true" />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        value={formatDisplayValue(value)}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className="font-mono"
      />
    </InputGroup>
  )
}

export { CurrencyInput }
export type { CurrencyInputProps }
