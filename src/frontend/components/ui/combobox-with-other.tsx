import * as React from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional hex color — renders a swatch before the label (e.g. for colors). */
  hexCode?: string | null;
  description?: string | null;
}

export interface ComboboxWithOtherProps {
  options: ComboboxOption[];
  /** Selected option value, or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /**
   * Create an "Other" option from the typed text. Return the created option
   * (which is then selected). Omit to disable the Other affordance. Wire this to
   * the definition-table create API per the AGENTS.md multi-select rule.
   */
  onCreateOther?: (label: string) => Promise<ComboboxOption | null> | ComboboxOption | null;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

function Swatch({ hex }: { hex?: string | null }) {
  if (!hex) return null;
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-block size-3 shrink-0 rounded-[3px] ring-1 ring-border/60"
      style={{ backgroundColor: hex }}
    />
  );
}

/**
 * Reusable single-select autocomplete with an "Other" create affordance and
 * optional color swatches. USE THIS for any single-choice field backed by a
 * definition table (brand, style, single-category, …) — never a bare native
 * `<select>` when "Other" creation is expected. For multi-select use
 * `MultipleSelector`. See the AGENTS.md multi-select/config rule.
 */
export function ComboboxWithOther({
  options,
  value,
  onChange,
  onCreateOther,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  disabled,
  className,
  ...props
}: ComboboxWithOtherProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const selected = options.find((o) => o.value === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const exactExists = options.some((o) => o.label.toLowerCase() === q);
  const canCreate = Boolean(onCreateOther) && q.length > 0 && !exactExists;

  async function create() {
    if (!onCreateOther || !query.trim()) return;
    setCreating(true);
    try {
      const created = await onCreateOther(query.trim());
      if (created) {
        onChange(created.value);
        setOpen(false);
        setQuery("");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={props["aria-label"]}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
          >
            <span className="flex min-w-0 items-center truncate">
              <Swatch hex={selected?.hexCode} />
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <div className="p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                void create();
              }
            }}
          />
        </div>
        <ScrollArea className="max-h-64">
          <ul className="p-1">
            {filtered.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value === value ? null : opt.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Swatch hex={opt.hexCode} />
                  <span className="min-w-0 flex-1 truncate text-left">{opt.label}</span>
                  {opt.value === value && <Check className="ml-2 size-4 shrink-0" />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && !canCreate && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</li>
            )}
            {canCreate && (
              <li>
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => void create()}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Create “{query.trim()}”
                </button>
              </li>
            )}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
