import * as React from "react";
import { Check, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export type FilterType = "checkbox" | "color" | "button" | "range";

export interface FilterOption {
  label: string;
  value: string;
  count?: number;
  colorHex?: string;
}

export interface FilterSection {
  id: string;
  title: string;
  type: FilterType;
  options?: FilterOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface FilterSidebarProps {
  title?: string;
  sections: FilterSection[];
  initialFilters?: Record<string, string[]>;
  initialPriceRange?: [number, number];
  /**
   * Controlled apply handler. When provided, "Apply filters" calls this with the
   * current selection + price range instead of navigating via URL params. The
   * products page uses this to drive client-side fetches.
   */
  onApply?: (selected: Record<string, string[]>, price: [number, number]) => void;
}

export function FilterSidebar({
  title = "Filters",
  sections,
  initialFilters = {},
  initialPriceRange,
  onApply,
}: FilterSidebarProps) {
  const [selected, setSelected] = React.useState<Record<string, string[]>>(initialFilters);
  const [price, setPrice] = React.useState<[number, number]>(
    initialPriceRange || [
      sections.find((s) => s.type === "range")?.min || 0,
      sections.find((s) => s.type === "range")?.max || 1000,
    ]
  );

  const toggleFilter = (sectionId: string, value: string) => {
    setSelected((prev) => {
      const current = prev[sectionId] || [];
      if (current.includes(value)) {
        return { ...prev, [sectionId]: current.filter((v) => v !== value) };
      } else {
        return { ...prev, [sectionId]: [...current, value] };
      }
    });
  };

  const removeFilter = (sectionId: string, value: string) => {
    setSelected((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).filter((v) => v !== value),
    }));
  };

  const clearAll = () => {
    setSelected({});
    const rangeSection = sections.find((s) => s.type === "range");
    if (rangeSection) {
      setPrice([rangeSection.min || 0, rangeSection.max || 1000]);
    }
  };

  const handleApply = () => {
    if (onApply) {
      onApply(selected, price);
      return;
    }
    const url = new URL(window.location.href);
    sections.forEach((s) => url.searchParams.delete(s.id));
    Object.entries(selected).forEach(([key, values]) => {
      if (values.length > 0) {
        url.searchParams.set(key, values.join(","));
      }
    });
    const rangeSection = sections.find((s) => s.type === "range");
    if (rangeSection) {
      url.searchParams.set(rangeSection.id, `${price[0]}-${price[1]}`);
    }
    window.location.assign(url.toString());
  };

  const getActivePills = () => {
    const pills: { sectionId: string; value: string; label: string; colorHex?: string }[] = [];

    Object.entries(selected).forEach(([sectionId, values]) => {
      const section = sections.find((s) => s.id === sectionId);
      if (section && section.options) {
        values.forEach((val) => {
          const opt = section.options!.find((o) => o.value === val);
          if (opt) {
            pills.push({
              sectionId,
              value: val,
              label: opt.label,
              colorHex: opt.colorHex,
            });
          }
        });
      }
    });

    const rangeSection = sections.find((s) => s.type === "range");
    if (rangeSection && (price[0] !== rangeSection.min || price[1] !== rangeSection.max)) {
      pills.push({
        sectionId: rangeSection.id,
        value: "price",
        label: `$${price[0]} - $${price[1]}`,
      });
    }

    return pills;
  };

  const activePills = getActivePills();

  return (
    <aside aria-label="Product filters" className="w-full max-w-sm">
      <div className="bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-sm ring-1 ring-border/40">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-foreground text-base font-semibold tracking-tight">{title}</h2>
          {activePills.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-4 transition-colors hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {activePills.length > 0 && (
          <>
            <div className="px-5 py-5">
              <Separator />
            </div>
            <div className="flex flex-wrap gap-1.5 px-5" aria-label="Active filters">
              {activePills.map((pill) => (
                <button
                  key={`${pill.sectionId}-${pill.value}`}
                  type="button"
                  onClick={() => {
                    if (pill.sectionId === "price") {
                      const rangeSection = sections.find((s) => s.type === "range");
                      if (rangeSection) setPrice([rangeSection.min || 0, rangeSection.max || 1000]);
                    } else {
                      removeFilter(pill.sectionId, pill.value);
                    }
                  }}
                  className="border-border bg-muted/40 text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-2 text-xs font-medium transition-colors"
                >
                  {pill.colorHex && (
                    <span
                      aria-hidden="true"
                      className="border-border/60 inline-block size-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: pill.colorHex }}
                    />
                  )}
                  {pill.label}
                  <X className="text-muted-foreground size-3 ml-1" />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="px-5 py-5">
          <Separator />
        </div>

        {sections.map((section, idx) => (
          <React.Fragment key={section.id}>
            <section className="flex flex-col gap-3 px-5" aria-labelledby={`filter-${section.id}`}>
              <h3 id={`filter-${section.id}`} className="text-foreground text-sm font-semibold tracking-tight">
                {section.title}
              </h3>

              {section.type === "checkbox" && (
                <ul className="flex flex-col gap-2.5">
                  {section.options?.map((opt) => {
                    const isChecked = selected[section.id]?.includes(opt.value) || false;
                    return (
                      <li key={opt.value} className="flex items-center gap-2.5">
                        <Checkbox
                          id={`${section.id}-${opt.value}`}
                          checked={isChecked}
                          onCheckedChange={() => toggleFilter(section.id, opt.value)}
                        />
                        <Label
                          htmlFor={`${section.id}-${opt.value}`}
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm font-normal cursor-pointer"
                        >
                          <span className="truncate">{opt.label}</span>
                          {opt.count !== undefined && (
                            <span className="text-muted-foreground tabular-nums">{opt.count}</span>
                          )}
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {section.type === "range" && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground text-xs font-medium tabular-nums">
                      <span className="text-foreground font-semibold">${price[0]}</span> -{" "}
                      <span className="text-foreground font-semibold">${price[1]}</span>
                    </span>
                  </div>
                  <Slider
                    min={section.min || 0}
                    max={section.max || 1000}
                    step={section.step || 1}
                    value={price}
                    onValueChange={(val) => setPrice(val as [number, number])}
                  />
                </div>
              )}

              {section.type === "color" && (
                <ul className="flex flex-wrap gap-3" aria-label={`${section.title} swatches`}>
                  {section.options?.map((opt) => {
                    const isActive = selected[section.id]?.includes(opt.value) || false;
                    return (
                      <li key={opt.value}>
                        <button
                          type="button"
                          aria-pressed={isActive}
                          title={opt.label}
                          onClick={() => toggleFilter(section.id, opt.value)}
                          className={`border-border relative flex size-7 items-center justify-center rounded-full border transition-shadow outline-none focus-visible:ring-ring/40 focus-visible:ring-2 focus-visible:ring-offset-2 ${
                            isActive ? "ring-foreground ring-2 ring-offset-2" : ""
                          }`}
                          style={{ backgroundColor: opt.colorHex }}
                        >
                          {isActive && <Check className="size-3 text-background" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {section.type === "button" && (
                <div className="flex flex-wrap gap-1.5" aria-label={section.title}>
                  {section.options?.map((opt) => {
                    const isActive = selected[section.id]?.includes(opt.value) || false;
                    return (
                      <Button
                        key={opt.value}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleFilter(section.id, opt.value)}
                        className="min-w-12 tabular-nums"
                      >
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </section>

            {idx < sections.length - 1 && (
              <div className="px-5 py-5">
                <Separator />
              </div>
            )}
          </React.Fragment>
        ))}

        <div className="px-5 py-5">
          <Separator />
        </div>

        <div className="flex items-center gap-2 px-5 pb-5">
          <Button onClick={handleApply} className="flex-1" size="sm">
            Apply filters
          </Button>
          <Button onClick={clearAll} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground shrink-0">
            Reset
          </Button>
        </div>
      </div>
    </aside>
  );
}
