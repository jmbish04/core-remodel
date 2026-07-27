/**
 * @fileoverview Store picker with OTHER (0032 V2c).
 *
 * Wraps the shared ComboboxWithOther: selecting binds a numeric store_id;
 * OTHER creates a bare showroom (name only) via POST /api/showroom-stores and
 * binds the new id. Never stores a free-text store name on the visit (the name
 * is JOINed by the API — no denormalized *_name column).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ComboboxWithOther, type ComboboxOption } from "@/components/ui/combobox-with-other";

import { createStore, listStores } from "./api";

export function ShowroomAutocomplete({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number | null;
  onChange: (storeId: number | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [options, setOptions] = useState<ComboboxOption[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stores = await listStores();
        if (alive) setOptions(stores.map((s) => ({ value: String(s.id), label: s.name })));
      } catch (e) {
        console.error("[visits/autocomplete] load stores", e);
        // Non-fatal: the picker still allows OTHER-create.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ComboboxWithOther
      options={options}
      value={value == null ? null : String(value)}
      onChange={(v) => onChange(v == null ? null : Number(v))}
      onCreateOther={async (label) => {
        try {
          const store = await createStore(label);
          const opt = { value: String(store.id), label: store.name };
          setOptions((prev) => [...prev, opt]);
          return opt;
        } catch (e) {
          console.error("[visits/autocomplete] create store", e);
          toast.error(e instanceof Error ? e.message : "Could not create showroom");
          return null;
        }
      }}
      placeholder="Select a showroom…"
      searchPlaceholder="Search showrooms…"
      emptyMessage="No showroom — type a name to add it."
      disabled={disabled}
      className={className}
      aria-label="Showroom"
    />
  );
}
