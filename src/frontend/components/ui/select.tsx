import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

/**
 * Recursively concatenate the text content of a React node. Used to derive a
 * plain-string label from a `<SelectItem>`'s children (e.g. an icon + text item
 * yields just the text). Non-text nodes (icons, spacers) contribute nothing.
 */
function extractItemText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractItemText).join("")
  if (React.isValidElement(node)) {
    return extractItemText((node.props as { children?: React.ReactNode }).children)
  }
  return ""
}

/**
 * Walk a children tree and collect every `<SelectItem>`'s `{ value, label }`.
 * Recurses through wrappers (`SelectContent`, `SelectGroup`, fragments, and the
 * arrays produced by `.map(...)`), so both static and dynamically-mapped item
 * lists are captured. `value` is kept raw (not coerced) so base-ui's strict
 * `item.value === selectedValue` comparison keeps working for any value type.
 */
function collectSelectItems(
  children: React.ReactNode,
  acc: Array<SelectOption<unknown>>,
): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      const props = child.props as {
        value?: unknown
        children?: React.ReactNode
      }
      if (props.value !== undefined) {
        acc.push({
          value: props.value,
          label: extractItemText(props.children).trim(),
        })
      }
      return
    }
    const nested = (child.props as { children?: React.ReactNode }).children
    if (nested != null) collectSelectItems(nested, acc)
  })
}

/**
 * App-standard Select root. A thin wrapper over base-ui's `Select.Root` that
 * auto-derives the `items` label map from the `<SelectItem>` children when the
 * caller didn't supply one explicitly.
 *
 * WHY: base-ui's `<Select.Value>` renders the raw selected *value* unless the
 * Root was given an `items` map — so every bare `<Select>…<SelectValue/></Select>`
 * leaked ids/codes into the trigger (e.g. "like" instead of "I like this"). By
 * harvesting the labels the items already declare, the trigger shows the human
 * label everywhere with no per-call-site changes. Pass `items` yourself to opt
 * out (e.g. when labels aren't plain text).
 */
function Select<Value>({
  items,
  children,
  ...props
}: SelectPrimitive.Root.Props<Value>) {
  const derivedItems = React.useMemo(() => {
    if (items != null) return items
    const collected: Array<SelectOption<unknown>> = []
    collectSelectItems(children, collected)
    return collected.length > 0
      ? (collected as unknown as SelectPrimitive.Root.Props<Value>["items"])
      : undefined
  }, [items, children])

  return (
    <SelectPrimitive.Root items={derivedItems} {...props}>
      {children}
    </SelectPrimitive.Root>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

/**
 * The shape of a single labelled option, mirroring the object form that
 * `@base-ui/react`'s `<Select.Root items=…>` accepts. `value` must equal the
 * `value` you pass to the matching `<SelectItem value=…>`; `label` is what the
 * trigger should display when that item is selected.
 */
export interface SelectOption<TValue = string> {
  value: TValue
  label: React.ReactNode
}

/**
 * Every option-source shape `SelectValue` understands. Intentionally a superset
 * that matches what base-ui's own `Select.Root` `items` prop accepts, so the
 * mental model is identical whether you wire labels at the `Select` root or at
 * the `SelectValue` trigger:
 *
 * - a record map: `{ [value]: label }`
 * - an array of `{ value, label }` options
 */
export type SelectOptions<TValue = string> =
  | Record<string, React.ReactNode>
  | ReadonlyArray<SelectOption<TValue>>

/**
 * Resolves the display label for the currently-selected `value` from an `items`
 * collection, mirroring `@base-ui/react`'s internal `resolveSelectedLabel`
 * semantics (record lookup, then flat-array match). Returns `undefined` when no
 * label can be resolved so callers can fall through to the next strategy.
 */
function resolveOptionLabel<TValue>(
  value: TValue,
  items: SelectOptions<TValue> | undefined
): React.ReactNode | undefined {
  if (items == null) {
    return undefined
  }
  // Record-map form: `{ [value]: label }`.
  if (!Array.isArray(items)) {
    const record = items as Record<string, React.ReactNode>
    const key = value as unknown as string
    return key in record ? record[key] : undefined
  }
  // Array form: `[{ value, label }]`.
  const match = (items as ReadonlyArray<SelectOption<TValue>>).find(
    (item) => item.value === value
  )
  return match?.label
}

/**
 * Extra props the shared wrapper layers on top of base-ui's `Select.Value`.
 *
 * IMPORTANT — why this exists: unlike Radix, `@base-ui/react`'s `<Select.Value>`
 * renders the raw selected **value** when it cannot resolve a label (i.e. when
 * the `Select.Root` was not given an `items` map). For Selects whose value is an
 * id/code/slug that differs from its visible text (an image id, a room id, a
 * vision-node id, …) the trigger would otherwise show the id instead of the
 * human-readable name. These props let any Select opt in to value→label mapping
 * at the call site with zero changes to the surrounding `<Select>` tree.
 *
 * Precedence (first match wins):
 *   1. `renderValue(value)`  — full control over the rendered node.
 *   2. function `children`   — base-ui's native render-child, untouched.
 *   3. `getLabel(value)`     — map a value to its label.
 *   4. `items`               — record or `{value,label}[]` lookup table.
 *   5. base-ui default       — placeholder when empty, else nothing.
 */
export interface SelectValueExtraProps<TValue = string> {
  /**
   * Lookup table mapping each option `value` to its display label. Accepts the
   * same shapes as base-ui's `Select.Root` `items` prop:
   * `{ [value]: label }` or `Array<{ value, label }>`.
   * @example
   * ```tsx
   * <SelectValue
   *   items={images.map((i) => ({ value: i.id, label: i.displayName }))}
   *   placeholder="Choose a photo"
   * />
   * ```
   */
  items?: SelectOptions<TValue>
  /**
   * Imperative value→label resolver. Use when a static `items` table is awkward
   * (e.g. the label needs formatting). Return `undefined`/`null` to fall through
   * to the placeholder / base-ui default rendering.
   * @example
   * ```tsx
   * <SelectValue getLabel={(id) => byId.get(id)?.name} placeholder="Choose…" />
   * ```
   */
  getLabel?: (value: TValue) => React.ReactNode | undefined
  /**
   * Full-control renderer for the trigger contents. Receives the current value
   * (or `null` when nothing is selected). When provided it wins over every other
   * strategy, including `placeholder`.
   */
  renderValue?: (value: TValue | null) => React.ReactNode
}

/**
 * Drop-in replacement for `@base-ui/react`'s `Select.Value` that can resolve a
 * selected value to its display **label** so the trigger never leaks a raw
 * id/code. Backward compatible: with none of the extra props supplied it behaves
 * exactly like the bare base-ui component (placeholder + native rendering), so
 * existing call sites where `value === label` are unaffected.
 *
 * @see SelectValueExtraProps for the opt-in props and their precedence.
 */
function SelectValue<TValue = string>({
  className,
  items,
  getLabel,
  renderValue,
  children,
  ...props
}: SelectPrimitive.Value.Props & SelectValueExtraProps<TValue>) {
  // Only intercept rendering when the caller asked us to map value→label.
  // Otherwise pass `children` straight through so base-ui's own placeholder /
  // function-child / default behavior is preserved verbatim.
  const shouldResolve =
    renderValue != null ||
    getLabel != null ||
    items != null ||
    typeof children === "function"

  const resolvedChildren = shouldResolve
    ? (rawValue: TValue | null) => {
        if (renderValue != null) {
          return renderValue(rawValue)
        }
        if (typeof children === "function") {
          return (children as (value: TValue | null) => React.ReactNode)(rawValue)
        }
        if (rawValue != null) {
          const fromGetLabel = getLabel?.(rawValue)
          if (fromGetLabel != null) {
            return fromGetLabel
          }
          const fromItems = resolveOptionLabel(rawValue, items)
          if (fromItems != null) {
            return fromItems
          }
        }
        // Nothing resolved (e.g. no selection): defer to the placeholder if one
        // was supplied, else render nothing rather than the raw value.
        return props.placeholder ?? null
      }
    : (children as React.ReactNode)

  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    >
      {resolvedChildren as SelectPrimitive.Value.Props["children"]}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit min-w-[8rem] items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn("relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
