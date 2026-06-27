import * as React from "react"
import {
  Combobox as ComboboxPrimitive,
  type ComboboxRootProps,
} from "@ark-ui/react/combobox"
import { Portal } from "@ark-ui/react/portal"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

/* -------------------------------------------------------------------------- */
/*  Autocomplete — Ark UI Combobox with shadcn-style dark theme               */
/* -------------------------------------------------------------------------- */

/**
 * Root provider — thin wrapper around Ark's `Combobox.Root`.
 * Pass `collection` (from `useListCollection`), `onInputValueChange`,
 * and `onValueChange` just like the Ark docs show.
 */
function Autocomplete<T>(
  props: ComboboxRootProps<T>
) {
  return (
    <ComboboxPrimitive.Root
      {...props}
      openOnClick
      positioning={{ sameWidth: true, placement: "bottom" }}
      className={cn("group w-full", props.className)}
    />
  )
}

/**
 * The text input the user types into.
 */
function AutocompleteInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <div className="relative w-full">
      <ComboboxPrimitive.Control>
        <ComboboxPrimitive.Input
          className={cn(
            "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
            className
          )}
          {...props}
        />
        <ComboboxPrimitive.Trigger asChild>
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-muted-foreground"
          >
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.Control>
    </div>
  )
}

/**
 * Dropdown panel that holds the list. Rendered in a portal for stacking.
 */
function AutocompleteContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Content>) {
  return (
    <Portal>
      <ComboboxPrimitive.Positioner>
        <ComboboxPrimitive.Content
          className={cn(
            "z-50 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Content>
      </ComboboxPrimitive.Positioner>
    </Portal>
  )
}

/**
 * Empty state shown when the filter returns zero items.
 */
function AutocompleteEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "py-3 text-center text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      {children ?? "No results found."}
    </div>
  )
}

/**
 * Optional grouping container (renders `<optgroup>`-like semantics).
 */
function AutocompleteGroup({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ItemGroup>) {
  return (
    <ComboboxPrimitive.ItemGroup
      className={cn("p-1", className)}
      {...props}
    />
  )
}

/**
 * Label for a group.
 */
function AutocompleteGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.ItemGroupLabel>) {
  return (
    <ComboboxPrimitive.ItemGroupLabel
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * Scrollable list wrapper (no Ark primitive, just a styled div).
 */
function AutocompleteList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("max-h-60 overflow-y-auto p-1", className)}
      {...props}
    />
  )
}

/**
 * Individual selectable item inside the dropdown.
 */
function AutocompleteItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <ComboboxPrimitive.ItemIndicator>
        <Check className="size-3.5" />
      </ComboboxPrimitive.ItemIndicator>
      <ComboboxPrimitive.ItemText>
        {children}
      </ComboboxPrimitive.ItemText>
    </ComboboxPrimitive.Item>
  )
}

export {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
}
