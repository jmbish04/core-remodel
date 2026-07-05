import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Monolith-styled checkbox built on Base UI (matching the repo's `switch.tsx`
 * convention — NOT Radix). Renders a small rounded square that fills with the
 * primary color when checked and shows a check (or a dash for the indeterminate
 * state). Uses `ring-1 ring-border/60` for the resting edge rather than a hard
 * 1px border, per the Monolith no-borders rule.
 */
const Checkbox = React.forwardRef<
  HTMLButtonElement,
  CheckboxPrimitive.Root.Props
>(({ className, ...props }, ref) => {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      data-slot="checkbox"
      className={cn(
        "group peer size-4 shrink-0 rounded-[4px] bg-input/40 ring-1 ring-border/60 outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        "data-checked:bg-primary data-checked:ring-primary data-indeterminate:bg-primary data-indeterminate:ring-primary",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "aria-invalid:ring-destructive",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-primary-foreground transition-none"
      >
        {/* Indeterminate → dash, checked → check. Base UI mounts the Indicator
            whenever checked OR indeterminate; we swap the glyph via the Root's
            data-indeterminate state. */}
        <MinusIcon className="hidden size-3 group-data-[indeterminate]:block" strokeWidth={3} />
        <CheckIcon className="size-3 group-data-[indeterminate]:hidden" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
