import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultipleSelectorOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface MultipleSelectorProps {
  options: MultipleSelectorOption[];
  value: string[];
  onValueChange: (next: string[]) => void;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  enableCreate?: boolean;
  createLabel?: string;
  onCreateOption?: (
    label: string,
  ) => Promise<MultipleSelectorOption | null | undefined> | MultipleSelectorOption | null | undefined;
}

export function MultipleSelector(props: MultipleSelectorProps) {
  const {
    options,
    value,
    onValueChange,
    placeholder = "Select options",
    title = "Select options",
    disabled,
    className,
    searchPlaceholder = "Search...",
    emptyMessage = "No matching options",
    enableCreate = false,
    createLabel = "Create",
    onCreateOption,
  } = props;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [localOptions, setLocalOptions] = React.useState<MultipleSelectorOption[]>([]);

  const normalizedQuery = query.trim().toLowerCase();
  const selectedSet = React.useMemo(() => new Set(value), [value]);

  const allOptions = React.useMemo(() => {
    const merged = new Map<string, MultipleSelectorOption>();
    for (const option of options) {
      merged.set(option.value, option);
    }
    for (const option of localOptions) {
      if (!merged.has(option.value)) {
        merged.set(option.value, option);
      }
    }
    return Array.from(merged.values());
  }, [options, localOptions]);

  const selectedOptions = React.useMemo(
    () => allOptions.filter((option) => selectedSet.has(option.value)),
    [allOptions, selectedSet],
  );

  const filteredOptions = React.useMemo(() => {
    if (!normalizedQuery) {
      return allOptions;
    }

    return allOptions.filter((option) => {
      const target = `${option.label} ${option.description || ""} ${option.value}`.toLowerCase();
      return target.includes(normalizedQuery);
    });
  }, [allOptions, normalizedQuery]);

  const hasExactMatch = React.useMemo(() => {
    if (!normalizedQuery) return false;
    return allOptions.some((option) => {
      const optionValue = option.value.trim().toLowerCase();
      const optionLabel = option.label.trim().toLowerCase();
      return optionValue === normalizedQuery || optionLabel === normalizedQuery;
    });
  }, [allOptions, normalizedQuery]);

  const showCreate = enableCreate && normalizedQuery.length > 0 && !hasExactMatch;

  const toggle = (optionValue: string) => {
    if (selectedSet.has(optionValue)) {
      onValueChange(value.filter((entry) => entry !== optionValue));
      return;
    }
    onValueChange([...value, optionValue]);
  };

  const handleCreate = async () => {
    const nextLabel = query.trim();
    if (!nextLabel || !onCreateOption) {
      return;
    }

    setCreating(true);
    try {
      const created = await onCreateOption(nextLabel);
      if (!created) {
        return;
      }

      setLocalOptions((prev) => {
        if (prev.some((item) => item.value === created.value)) {
          return prev;
        }
        return [...prev, created];
      });

      if (!selectedSet.has(created.value)) {
        onValueChange([...value, created.value]);
      }
      setQuery("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className="w-full justify-between"
              disabled={disabled}
            />
          }
        >
          <span className="truncate text-left">
            {selectedOptions.length > 0
              ? `${selectedOptions.length} selected`
              : placeholder}
          </span>
          <ChevronDown className="ml-2 size-4" />
        </PopoverTrigger>

        <PopoverContent className="w-[22rem] p-2" align="start">
          <PopoverHeader className="px-1 py-1">
            <PopoverTitle>{title}</PopoverTitle>
          </PopoverHeader>

          <div className="relative px-1 pb-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {filteredOptions.length === 0 && !showCreate ? (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                {emptyMessage}
              </div>
            ) : null}

            {filteredOptions.map((option) => {
              const selected = selectedSet.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => !option.disabled && toggle(option.value)}
                  disabled={option.disabled}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm",
                    "ring-1 ring-transparent transition hover:bg-muted",
                    selected && "bg-muted ring-border/40",
                    option.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 items-center justify-center rounded border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.description && (
                      <span className="block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

            {showCreate && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !onCreateOption}
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-left text-sm transition hover:bg-muted"
              >
                <Plus className="size-4" />
                <span className="flex-1 truncate">
                  {creating ? "Creating..." : `${createLabel} "${query.trim()}"`}
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/40 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onValueChange([])}
              disabled={value.length === 0}
              className="gap-1"
            >
              <X className="size-3.5" />
              Clear
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80"
            >
              <span>{option.label}</span>
              <X className="size-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
