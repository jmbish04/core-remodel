import * as React from "react"
import { useFilter, useListCollection } from "@ark-ui/react"

import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/ui/autocomplete"

/* -------------------------------------------------------------------------- */
/*  ShowroomAutocomplete — pre-wired Autocomplete for showroom store selection */
/* -------------------------------------------------------------------------- */

export interface ShowroomOption {
  label: string
  value: string
}

interface ShowroomAutocompleteProps {
  /** Currently selected store id (as string). */
  value?: string
  /** Called with the selected store id string. */
  onChange?: (value: string) => void
  /** Placeholder text. */
  placeholder?: string
  /** Disable the input. */
  disabled?: boolean
  /** Additional class names for the root. */
  className?: string
}

/**
 * ShowroomAutocomplete — a domain-specific autocomplete that fetches showroom
 * stores from `/api/showroom-stores` and lets the user search + select one.
 *
 * The full list of stores is visible on focus; typing filters by name.
 * Works on desktop and mobile (touch-friendly, `inputMode="search"`).
 *
 * Usage:
 * ```tsx
 * const [storeId, setStoreId] = useState("")
 * <ShowroomAutocomplete value={storeId} onChange={setStoreId} />
 * ```
 */
export function ShowroomAutocomplete({
  value,
  onChange,
  placeholder = "Search showrooms…",
  disabled = false,
  className,
}: ShowroomAutocompleteProps) {
  const [stores, setStores] = React.useState<ShowroomOption[]>([])
  const [loading, setLoading] = React.useState(true)

  // Fetch showroom stores on mount
  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/showroom-stores")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { stores?: Array<{ id: number; name: string }> }

        if (cancelled) return

        // API returns { stores: [...] } with each store having id + name
        const items: ShowroomOption[] = (data.stores ?? []).map(
          (s: { id: number; name: string }) => ({
            label: s.name,
            value: String(s.id),
          })
        )
        setStores(items)
      } catch (err) {
        console.error("[ShowroomAutocomplete] Failed to load stores:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const { contains } = useFilter({ sensitivity: "base" })
  const { collection, filter } = useListCollection({
    initialItems: stores,
    itemToString: (item) => item.label,
    itemToValue: (item) => item.value,
    filter: contains,
  })

  // Re-initialize collection when stores arrive
  React.useEffect(() => {
    if (stores.length > 0) {
      filter("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores])

  return (
    <Autocomplete
      collection={collection}
      onInputValueChange={({ inputValue }: { inputValue: string }) => filter(inputValue)}
      onValueChange={({ value: values }: { value: string[] }) => {
        const selected = values[0]
        if (selected !== undefined) {
          onChange?.(selected)
        }
      }}
      value={value ? [value] : []}
      disabled={disabled}
      className={className}
    >
      <AutocompleteInput
        placeholder={loading ? "Loading stores…" : placeholder}
        disabled={disabled || loading}
      />
      <AutocompleteContent>
        <AutocompleteEmpty>
          {loading ? "Loading…" : "No showrooms found."}
        </AutocompleteEmpty>
        <AutocompleteList>
          {collection.items.map((item) => (
            <AutocompleteItem item={item} key={item.value}>
              {item.label}
            </AutocompleteItem>
          ))}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  )
}
