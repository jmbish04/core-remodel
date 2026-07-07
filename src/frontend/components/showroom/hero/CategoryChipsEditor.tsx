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
import { Loader2, Pencil, Tag } from "lucide-react";
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
  const [saving, setSaving] = useState(false);

  const currentIds = useMemo(
    () => new Set(categories.map((c) => c.categoryId)),
    [categories],
  );

  // Load the vocabulary + seed the selection each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(currentIds));
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
        body: JSON.stringify({ categoryIds: [...selected] }),
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
  }, [storeId, selected, onChanged]);

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <Tag className="size-3" /> Category
        </span>
        {categories.length > 0 ? (
          categories.map((c) => (
            <Badge
              key={c.categoryId}
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-normal"
              title={c.aiRationale ?? undefined}
            >
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit categories</DialogTitle>
            <DialogDescription>
              Pick what this showroom actually sells — overrides anything the AI
              inferred.
            </DialogDescription>
          </DialogHeader>

          {loadingOptions ? (
            <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <div className="grid max-h-[50vh] grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {options.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selected.has(opt.id)}
                    onCheckedChange={() => toggle(opt.id)}
                  />
                  <span className="min-w-0 truncate" title={opt.description ?? undefined}>
                    {opt.name}
                  </span>
                </label>
              ))}
              {options.length === 0 ? (
                <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                  No categories defined.
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || loadingOptions}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save categories
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
