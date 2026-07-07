/**
 * @fileoverview TagMultiSelect — a searchable, create-on-the-fly multi-select of
 * tag objects for the note editor.
 *
 * Explicitly NOT a CSV field: tags are first-class chip objects. Type to filter
 * the existing distinct tags (loaded from the adapter's `fetchTagOptions()`),
 * press Enter or click the "Create '…'" row to add a brand-new tag, and remove a
 * selected tag with its X. Fully keyboard accessible: ArrowUp/Down move the
 * active row, Enter selects it (or creates when the query has no exact match),
 * Backspace on an empty query pops the last chip.
 *
 * Built on the same Popover + Input + list primitive pattern as
 * `ui/multiple-selector.tsx` (which is proven against this repo's Base UI
 * Popover). Selected values ARE the tag labels — tags have no separate id.
 */

import React from "react";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface TagMultiSelectProps {
  /** Selected tag labels. */
  value: string[];
  onValueChange: (next: string[]) => void;
  /** Distinct existing options (may include already-selected ones). */
  options: string[];
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function TagMultiSelect({
  value,
  onValueChange,
  options,
  disabled = false,
  loading = false,
  placeholder = "Add tags…",
  className,
  id,
}: TagMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const normalized = query.trim();
  const lowerQuery = normalized.toLowerCase();
  const selectedSet = React.useMemo(() => new Set(value), [value]);

  // Union of persisted options + already-selected tags (so a tag selected this
  // session but not yet in the distinct list still renders as a togglable row).
  const allOptions = React.useMemo(() => {
    const merged = new Set<string>(options);
    for (const v of value) merged.add(v);
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [options, value]);

  const filtered = React.useMemo(() => {
    if (!lowerQuery) return allOptions;
    return allOptions.filter((o) => o.toLowerCase().includes(lowerQuery));
  }, [allOptions, lowerQuery]);

  const hasExact = React.useMemo(
    () => allOptions.some((o) => o.toLowerCase() === lowerQuery),
    [allOptions, lowerQuery],
  );

  const showCreate = normalized.length > 0 && !hasExact;

  // Rows = filtered options followed by an optional create row. `active` indexes
  // into this combined list for keyboard navigation.
  const rowCount = filtered.length + (showCreate ? 1 : 0);

  React.useEffect(() => {
    setActive(0);
  }, [query, open]);

  const addTag = React.useCallback(
    (tag: string) => {
      const clean = tag.trim();
      if (!clean) return;
      if (!selectedSet.has(clean)) onValueChange([...value, clean]);
      setQuery("");
      // Keep focus in the input for rapid multi-tagging.
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [onValueChange, selectedSet, value],
  );

  const toggle = React.useCallback(
    (tag: string) => {
      if (selectedSet.has(tag)) {
        onValueChange(value.filter((t) => t !== tag));
      } else {
        onValueChange([...value, tag]);
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [onValueChange, selectedSet, value],
  );

  const removeTag = React.useCallback(
    (tag: string) => onValueChange(value.filter((t) => t !== tag)),
    [onValueChange, value],
  );

  const commitActive = React.useCallback(() => {
    if (active < filtered.length) {
      toggle(filtered[active]);
      return;
    }
    if (showCreate) addTag(normalized);
  }, [active, addTag, filtered, normalized, showCreate, toggle]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (rowCount === 0 ? 0 : (a + 1) % rowCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (rowCount === 0 ? 0 : (a - 1 + rowCount) % rowCount));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rowCount > 0) commitActive();
      else if (normalized) addTag(normalized);
    } else if (e.key === "Backspace" && !query && value.length > 0) {
      e.preventDefault();
      removeTag(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        {/* Trigger is a div (role=combobox), NOT a <button>, so the chip-remove
            <button>s below are valid children — a button can't nest interactive
            descendants. Keyboard: Enter/Space/ArrowDown open the popover. */}
        <PopoverTrigger
          render={
            <div
              id={id}
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-label="Add tags"
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : 0}
              onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
              className={cn(
                "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-left text-sm ring-1 ring-border/40 transition-colors",
                "cursor-text hover:ring-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            />
          }
        >
          {value.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <TagIcon className="size-3.5" />
              {placeholder}
            </span>
          ) : (
            value.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="gap-1 pr-1 font-normal"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeTag(tag);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))
          )}
        </PopoverTrigger>

        <PopoverContent
          className="w-80 max-w-[calc(100vw-2rem)] p-2"
          align="start"
          initialFocus={inputRef}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search or create a tag…"
            className="mb-2 h-9 w-full rounded-md bg-background/60 px-2.5 text-sm ring-1 ring-border/40 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            role="combobox"
            aria-expanded="true"
            aria-controls="tag-listbox"
            aria-autocomplete="list"
          />

          <div
            id="tag-listbox"
            role="listbox"
            aria-multiselectable="true"
            className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5"
          >
            {loading ? (
              <div className="space-y-1.5 p-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-8 animate-pulse rounded-md bg-muted/50"
                  />
                ))}
              </div>
            ) : filtered.length === 0 && !showCreate ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {normalized ? "No matching tags" : "No tags yet"}
              </p>
            ) : (
              <>
                {filtered.map((tag, i) => {
                  const selected = selectedSet.has(tag);
                  const isActive = i === active;
                  return (
                    <button
                      key={tag}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => toggle(tag)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        isActive ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/60",
                        )}
                      >
                        {selected && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{tag}</span>
                    </button>
                  );
                })}

                {showCreate && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseEnter={() => setActive(filtered.length)}
                    onClick={() => addTag(normalized)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-left text-sm transition-colors",
                      active === filtered.length ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <Plus className="size-4 shrink-0" />
                    <span className="truncate">
                      Create <span className="font-medium">“{normalized}”</span>
                    </span>
                  </button>
                )}
              </>
            )}
          </div>

          {value.length > 0 && (
            <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
              <span className="text-xs text-muted-foreground">
                {value.length} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => onValueChange([])}
              >
                <X className="size-3" />
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
