/**
 * @fileoverview TypeEditor — the hero's business-model TYPE section + edit modal.
 *
 * Shows the showroom's single business-model type as a color-coded badge with an
 * always-available edit affordance. Editing opens a Dialog that lists the live
 * ACTIVE type vocabulary (`GET /api/showroom-stores/meta/types`) as a table;
 * saving writes the single FK via `PUT /api/showroom-stores/:id { typeId }`.
 *
 * Highlight rule (by product spec): the row matching the store's CURRENTLY SAVED
 * type is painted permanent light-yellow for the whole life of the open modal —
 * it does NOT move when the user clicks a different row (that's shown as the
 * pending selection instead). The yellow only moves after the user saves and
 * reopens, because only then has the saved value changed. We snapshot the saved
 * id on open so a parent re-render can't shift it mid-session.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, Shapes } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TOUCH_DIALOG_BODY_CLASS, TOUCH_DIALOG_CLASS } from "./touch-dialog";

interface TypeOption {
  id: number;
  key: string;
  displayName: string;
  description: string | null;
  htmlColor: string | null;
}

export function TypeEditor({
  storeId,
  typeId,
  typeName,
  typeColor,
  onChanged,
}: {
  storeId: number;
  /** The store's currently saved type id (null when untyped). */
  typeId: number | null;
  typeName: string | null;
  typeColor: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TypeOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  // The saved id FROZEN at open — drives the permanent yellow row.
  const [savedAtOpen, setSavedAtOpen] = useState<number | null>(null);
  // The user's pending pick (null = "No type").
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the vocabulary + snapshot the saved/selected id each time it opens.
  useEffect(() => {
    if (!open) return;
    setSavedAtOpen(typeId);
    setSelected(typeId);
    setLoadingOptions(true);
    void (async () => {
      try {
        const res = await fetch("/api/showroom-stores/meta/types", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Types failed (${res.status})`);
        const data = (await res.json()) as { types: TypeOption[] };
        setOptions(data.types ?? []);
      } catch (e) {
        console.error("[types/options]", e);
        toast.error(e instanceof Error ? e.message : "Failed to load types");
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, [open, typeId]);

  const dirty = selected !== savedAtOpen;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/showroom-stores/${storeId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typeId: selected }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Save failed (${res.status})`);
      }
      toast.success("Type updated");
      setOpen(false);
      onChanged();
    } catch (e) {
      console.error("[types/save]", e);
      toast.error(e instanceof Error ? e.message : "Failed to update type");
    } finally {
      setSaving(false);
    }
  }, [storeId, selected, onChanged]);

  const badgeStyle = useMemo(
    () =>
      typeColor
        ? { backgroundColor: `${typeColor}22`, borderColor: `${typeColor}66`, color: typeColor }
        : undefined,
    [typeColor],
  );

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <Shapes className="size-3" /> Type
        </span>
        {typeName ? (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] font-normal"
            style={badgeStyle}
          >
            {typeName}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground/70">Not typed yet</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Edit type"
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className={TOUCH_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Set business-model type</DialogTitle>
            <DialogDescription>
              A store is exactly one type — how the business operates. The
              <span className="mx-1 rounded bg-yellow-400/20 px-1 text-yellow-600 ring-1 ring-yellow-500/40 dark:text-yellow-300">
                highlighted
              </span>
              row is the currently saved type.
            </DialogDescription>
          </DialogHeader>

          {loadingOptions ? (
            <div className="flex min-h-[160px] flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <div className={`${TOUCH_DIALOG_BODY_CLASS} flex flex-col gap-1.5`}>
              {/* "No type" row — lets a user clear the FK back to null. */}
              <TypeRow
                label="No type"
                description="Leave this store untyped."
                swatch={null}
                isSaved={savedAtOpen === null}
                isSelected={selected === null}
                onSelect={() => setSelected(null)}
              />
              {options.map((opt) => (
                <TypeRow
                  key={opt.id}
                  label={opt.displayName}
                  description={opt.description}
                  swatch={opt.htmlColor}
                  isSaved={savedAtOpen === opt.id}
                  isSelected={selected === opt.id}
                  onSelect={() => setSelected(opt.id)}
                />
              ))}
              {options.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No types defined.
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
              disabled={saving || loadingOptions || !dirty}
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One selectable type row. `isSaved` paints the permanent light-yellow (the
 * store's saved type, frozen at open); `isSelected` shows the pending pick
 * (a primary ring + check). The two are independent — the yellow never moves
 * on click, only on save+reopen.
 */
function TypeRow({
  label,
  description,
  swatch,
  isSaved,
  isSelected,
  onSelect,
}: {
  label: string;
  description: string | null;
  swatch: string | null;
  isSaved: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-base transition-colors",
        isSaved
          ? "bg-yellow-400/15 ring-1 ring-yellow-500/40 hover:bg-yellow-400/20"
          : "ring-1 ring-border/40 hover:bg-muted/60",
        isSelected ? "outline outline-2 outline-primary" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="size-4 shrink-0 rounded-full ring-1 ring-border/60"
        style={{ backgroundColor: swatch ?? "transparent" }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{label}</span>
          {isSaved ? (
            <span className="rounded bg-yellow-400/20 px-1 py-0 font-mono text-[9px] uppercase tracking-wide text-yellow-600 dark:text-yellow-300">
              Current
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {isSelected ? <Check className="size-5 shrink-0 text-primary" /> : null}
    </button>
  );
}
