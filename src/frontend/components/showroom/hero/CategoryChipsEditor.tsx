/**
 * @fileoverview CategoryChipsEditor — the hero's dedicated category section.
 *
 * Shows the showroom's assigned categories as chips with an always-available
 * edit affordance, so the user can correct the AI-assigned categories (or set
 * them when the agent found none). Editing opens a Dialog listing the live
 * category vocabulary (`GET /api/showroom-stores/meta/categories`) as
 * checkboxes; saving replaces the store's set via
 * `PUT /api/showroom-stores/:id/categories`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Star, Tag } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TOUCH_DIALOG_BODY_CLASS, TOUCH_DIALOG_CLASS } from "./touch-dialog";

/** A category mapping row as served by GET /api/showroom-stores/:id. */
export interface StoreCategoryChip {
  categoryId: number;
  categoryName: string;
  /** Present when the mapping was AI-inferred; shown as a tooltip. */
  aiRationale?: string | null;
}

interface CategoryOption {
  id: number;
  name: string;
  description: string | null;
  /** Parent UI bucket (showroom_store_category.ui_group). Falls back to "General". */
  uiGroup?: string | null;
}

/**
 * Fixed display order for the parent groups so the modal reads the same every
 * time (not alphabetical — "General" belongs last, not first). Any group the API
 * returns that is not listed here is appended after these, before "General".
 */
const GROUP_ORDER = [
  "Surfaces & Finishes",
  "Kitchen & Bath",
  "Structural & Openings",
  "Systems & Tech",
  "Outdoor & Exterior",
  "Specialty & Decor",
  "General",
];

/** Group the flat category vocabulary by `uiGroup`, in GROUP_ORDER. */
function groupByUiGroup(
  options: CategoryOption[],
): Array<{ group: string; items: CategoryOption[] }> {
  const buckets = new Map<string, CategoryOption[]>();
  for (const opt of options) {
    const g = opt.uiGroup?.trim() || "General";
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(opt);
  }
  const rank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length - 1.5 : i; // unknown groups before "General"
  };
  return [...buckets.entries()]
    .map(([group, items]) => ({
      group,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => rank(a.group) - rank(b.group));
}

export function CategoryChipsEditor({
  storeId,
  categories,
  onChanged,
}: {
  storeId: number;
  categories: StoreCategoryChip[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CategoryOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // The one primary category (drives the store's single directory group). Seeded
  // from categories[0] (the detail feed orders is_primary first) and sent as
  // primaryCategoryId on save (backend #409). Must always be one of `selected`.
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const currentIds = useMemo(
    () => new Set(categories.map((c) => c.categoryId)),
    [categories],
  );

  const grouped = useMemo(() => groupByUiGroup(options), [options]);

  // Load the vocabulary + seed the selection each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(currentIds));
    setPrimaryId(categories[0]?.categoryId ?? null);
    setLoadingOptions(true);
    void (async () => {
      try {
        const res = await fetch("/api/showroom-stores/meta/categories", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Categories failed (${res.status})`);
        const data = (await res.json()) as { categories: CategoryOption[] };
        setOptions(data.categories ?? []);
      } catch (e) {
        console.error("[categories/options]", e);
        toast.error(e instanceof Error ? e.message : "Failed to load categories");
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, [open, currentIds]);

  // Keep the primary valid: if it gets deselected (or none is set), fall back to
  // the first still-selected category; clear it when nothing is selected.
  useEffect(() => {
    if (selected.size === 0) {
      if (primaryId !== null) setPrimaryId(null);
      return;
    }
    if (primaryId == null || !selected.has(primaryId)) setPrimaryId([...selected][0]);
  }, [selected, primaryId]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}/categories`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: [...selected],
          // Backend #409 stamps is_primary from this (ignored by the pre-#409
          // endpoint). Guarantees the store keeps exactly one primary on save.
          primaryCategoryId: primaryId ?? [...selected][0] ?? undefined,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Save failed (${res.status})`);
      }
      toast.success("Categories updated");
      setOpen(false);
      onChanged();
    } catch (e) {
      console.error("[categories/save]", e);
      toast.error(e instanceof Error ? e.message : "Failed to update categories");
    } finally {
      setSaving(false);
    }
  }, [storeId, selected, primaryId, onChanged]);

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <Tag className="size-3" /> Category
        </span>
        {categories.length > 0 ? (
          categories.map((c, i) => (
            // categories[0] is the PRIMARY (detail feed orders is_primary first) —
            // star + tint it so the single directory group reads at a glance.
            <Badge
              key={c.categoryId}
              variant="secondary"
              className={`px-1.5 py-0 text-[10px] font-normal${
                i === 0 ? " bg-primary/15 text-primary" : ""
              }`}
              title={c.aiRationale ?? undefined}
            >
              {i === 0 ? <Star className="mr-0.5 inline size-2.5 fill-current" /> : null}
              {c.categoryName}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground/70">
            Not categorized yet
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Edit categories"
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className={TOUCH_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Edit categories</DialogTitle>
            <DialogDescription>
              Pick what this showroom actually sells — overrides anything the AI
              inferred. Tap the ★ on a selected category to make it the primary
              (its single group in the directory).
            </DialogDescription>
          </DialogHeader>

          {loadingOptions ? (
            <div className="flex min-h-[160px] flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <div className={`${TOUCH_DIALOG_BODY_CLASS} flex flex-col gap-5`}>
              {grouped.map(({ group, items }) => (
                <section key={group} className="space-y-2">
                  <h3 className="flex items-center gap-2 border-b border-border/40 pb-1.5 font-mono text-[13px] font-semibold uppercase tracking-wider text-foreground/75">
                    {group}
                    <span className="text-[11px] font-normal text-muted-foreground/60">
                      {items.length}
                    </span>
                  </h3>
                  {/* The whole row is the tap target (min-h-12 label), so the box
                      can be modest: size-5 keeps the check icon proportional (the
                      shared Checkbox's check is size-3 — a size-6 box left it a tiny
                      12px tick floating in 24px). The name label is the dominant text.
                      Checked rows get a filled highlight so selection reads at a glance. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((opt) => {
                      const isOn = selected.has(opt.id);
                      return (
                        <label
                          key={opt.id}
                          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[17px] font-medium ring-1 transition-colors ${
                            isOn
                              ? "bg-primary/10 ring-primary/50"
                              : "ring-border/40 hover:bg-muted/60"
                          }`}
                        >
                          <Checkbox
                            className="size-5"
                            checked={isOn}
                            onCheckedChange={() => toggle(opt.id)}
                          />
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={opt.description ?? undefined}
                          >
                            {opt.name}
                          </span>
                          {isOn ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setPrimaryId(opt.id);
                              }}
                              title={primaryId === opt.id ? "Primary category" : "Set as primary"}
                              aria-label={
                                primaryId === opt.id ? "Primary category" : "Set as primary category"
                              }
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                            >
                              <Star
                                className={
                                  primaryId === opt.id
                                    ? "size-4 fill-amber-400 text-amber-400"
                                    : "size-4 text-muted-foreground/40"
                                }
                              />
                            </button>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
              {options.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No categories defined.
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter className="mt-2 gap-2">
            <Button
              variant="outline"
              className="h-12 px-4"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className="h-12 px-4"
              onClick={() => void save()}
              disabled={saving || loadingOptions}
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save categories
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
