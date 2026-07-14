import * as React from "react"

import { cn } from "@/lib/utils"

import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * A single selectable option. `value` is the persisted key; `label` is what the
 * user sees — both in the open list AND in the closed trigger. Because the
 * trigger label is resolved from this same `options` array (see {@link Dropdown}),
 * the trigger can never leak the raw `value`/id the way a bare
 * `<Select><SelectValue/></Select>` does.
 */
export interface DropdownOption<TValue extends string = string>
  extends SelectOption<TValue> {
  disabled?: boolean
}

export interface DropdownProps<TValue extends string = string> {
  /** The full option list. Drives both the popup items and the trigger label. */
  options: ReadonlyArray<DropdownOption<TValue>>
  /** Controlled selected value. */
  value?: TValue
  /** Uncontrolled initial value. */
  defaultValue?: TValue
  onValueChange?: (value: TValue) => void
  /** Trigger text shown when nothing is selected. */
  placeholder?: React.ReactNode
  disabled?: boolean
  size?: "sm" | "default"
  /** Extra classes for the trigger (overrides the default responsive width). */
  className?: string
  /** Extra classes for the popup content. */
  contentClassName?: string
  /** Forwarded to the trigger for a11y (e.g. matches a <label htmlFor>). */
  id?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  name?: string
}

/**
 * Dropdown — the app-standard single-select. Import this instead of hand-wiring
 * `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`.
 *
 * Fixes two things that every ad-hoc `<Select>` in this app got wrong:
 *
 *  1. **Label, not id.** base-ui's `<Select.Value>` renders the raw selected
 *     *value* when it has no label map, so triggers leaked ids/codes ("like"
 *     instead of "I like this"). This component always feeds `SelectValue` the
 *     `options` array, so the trigger shows the human label by construction.
 *
 *  2. **Consistent, responsive width.** The trigger has a fixed minimum width so
 *     short options all render at the same size, then grows with its content up
 *     to a viewport-aware maximum (wider on desktop, narrower on mobile). Pass
 *     `className` with a `w-*`/`max-w-*` utility to override per call site.
 */
export function Dropdown<TValue extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  size = "default",
  className,
  contentClassName,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: DropdownProps<TValue>) {
  return (
    <Select
      value={value}
      defaultValue={defaultValue}
      onValueChange={
        onValueChange as ((value: string) => void) | undefined
      }
      disabled={disabled}
      name={name}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        // min = consistent floor for short values; w-fit grows to the content;
        // max caps it, larger on wider viewports so long labels show more.
        className={cn(
          "w-fit min-w-[8rem] max-w-[70vw] sm:max-w-[20rem] lg:max-w-[24rem]",
          className
        )}
      >
        <SelectValue items={options} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
