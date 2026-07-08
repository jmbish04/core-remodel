/**
 * @fileoverview CategorySelector — reusable, searchable multi-select dropdown
 * for showroom categories. Designed to filter showrooms, brands, and products
 * by category with a single-column, full-width layout that prevents truncation.
 *
 * Usage:
 *   <CategorySelector
 *     allCategories={categories}
 *     selected={selectedNames}
 *     onToggle={(name) => { … }}
 *     onClear={() => { … }}
 *   />
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Filter, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryOption {
  id: number;
  name: string;
}

// ─── Dropdown Panel ───────────────────────────────────────────────────────────

function CategoryDropdownPanel({
  allCategories,
  selected,
  onToggle,
  onClear,
  onClose,
}: {
  allCategories: CategoryOption[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = search.trim()
    ? allCategories.filter((c) =>
        c.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : allCategories;

  return (
    <div
      ref={panelRef}
      className="absolute left-0 top-full z-50 mt-1 w-[280px] rounded-md bg-popover shadow-lg ring-1 ring-border/40"
    >
      {/* Sticky search header */}
      <div className="sticky top-0 z-10 border-b border-border/30 bg-popover p-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter categories…"
            className="h-7 w-full rounded-sm bg-muted/50 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            autoFocus
          />
        </div>
      </div>

      {/* Scrollable category list — single column */}
      <div className="max-h-[260px] overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-2.5 py-3 text-center text-xs text-muted-foreground">
            No categories match &ldquo;{search}&rdquo;
          </div>
        ) : (
          filtered.map((c) => {
            const active = selected.includes(c.name);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.name)}
                className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/80 hover:bg-muted/60"
                }`}
              >
                <div
                  className={`flex size-4 shrink-0 items-center justify-center rounded-[3px] border transition ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-transparent"
                  }`}
                >
                  {active && <Check className="size-3" />}
                </div>
                <span className="truncate">{c.name}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Clear footer — only when selections exist */}
      {selected.length > 0 && (
        <div className="border-t border-border/30 p-1.5">
          <button
            type="button"
            onClick={onClear}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm py-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-3" />
            Clear {selected.length} selected
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Public Component ─────────────────────────────────────────────────────────

export interface CategorySelectorProps {
  /** Full list of available categories. */
  allCategories: CategoryOption[];
  /** Currently selected category names. */
  selected: string[];
  /** Called when a category is toggled on/off. */
  onToggle: (name: string) => void;
  /** Called to clear all selected categories. */
  onClear: () => void;
  /** Optional label override (default: "Category"). */
  label?: string;
}

export function CategorySelector({
  allCategories,
  selected,
  onToggle,
  onClear,
  label = "Category",
}: CategorySelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        size="sm"
        variant={selected.length > 0 ? "default" : "outline"}
        onClick={() => setOpen(!open)}
        className="h-7 gap-1 text-[11px]"
      >
        <Filter className="size-3" />
        {label}
        {selected.length > 0 && (
          <Badge className="ml-0.5 h-4 px-1 text-[9px]">{selected.length}</Badge>
        )}
        <ChevronDown className="size-3" />
      </Button>
      {open && (
        <CategoryDropdownPanel
          allCategories={allCategories}
          selected={selected}
          onToggle={onToggle}
          onClear={onClear}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
