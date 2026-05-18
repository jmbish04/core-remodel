import { Check } from "lucide-react";
import React, { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SelectionTone = "default" | "success" | "warning" | "info" | "danger";

export interface SelectablePhotoCardItem {
  id: string;
  title: string;
  imageUrl?: string | null;
  alt?: string;
  subtitle?: string;
  statusLabel?: string;
  statusTone?: SelectionTone;
  detailText?: string;
  detailTone?: SelectionTone;
}

export interface SelectablePhotoCardsDragStartPayload<
  TItem extends SelectablePhotoCardItem = SelectablePhotoCardItem,
> {
  item: TItem;
  selectedIds: string[];
}

interface SelectablePhotoCardsProps<
  TItem extends SelectablePhotoCardItem = SelectablePhotoCardItem,
> {
  items: TItem[];
  selectedIds: string[];
  onSelectedIdsChange: (nextIds: string[]) => void;
  onDragStart?: (
    event: React.DragEvent<HTMLButtonElement>,
    payload: SelectablePhotoCardsDragStartPayload<TItem>,
  ) => void;
  onDragEnd?: () => void;
  disabled?: boolean;
  showToolbar?: boolean;
  className?: string;
  gridClassName?: string;
}

function getSelectionLabel(count: number): string {
  if (count === 1) {
    return "1 photo selected";
  }
  return `${count} photos selected`;
}

const toneClassName: Record<SelectionTone, string> = {
  default: "bg-muted/40 text-muted-foreground",
  success: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-300",
  info: "bg-sky-500/15 text-sky-300",
  danger: "bg-destructive/15 text-destructive",
};

export function SelectablePhotoCards<TItem extends SelectablePhotoCardItem>(
  props: SelectablePhotoCardsProps<TItem>,
) {
  const {
    items,
    selectedIds,
    onSelectedIdsChange,
    onDragStart,
    onDragEnd,
    disabled = false,
    showToolbar = true,
    className,
    gridClassName,
  } = props;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const selectedLabel = getSelectionLabel(selectedIds.length);

  const toggleItem = (itemId: string) => {
    if (disabled) {
      return;
    }
    if (selectedSet.has(itemId)) {
      onSelectedIdsChange(selectedIds.filter((id) => id !== itemId));
      return;
    }
    onSelectedIdsChange([...selectedIds, itemId]);
  };

  const toggleSelectAll = () => {
    if (disabled) {
      return;
    }
    if (allSelected) {
      onSelectedIdsChange([]);
      return;
    }
    onSelectedIdsChange(items.map((item) => item.id));
  };

  return (
    <div className={cn("space-y-2", className)}>
      {showToolbar ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleSelectAll}
            disabled={disabled || items.length === 0}
          >
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
          <p className="text-xs text-muted-foreground">{selectedLabel}</p>
        </div>
      ) : null}

      <motion.div
        layout
        className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", gridClassName)}
      >
        <AnimatePresence mode="popLayout">
          {items.map((item) => {
            const selected = selectedSet.has(item.id);
            const statusTone = item.statusTone || "default";
            const detailTone = item.detailTone || statusTone;
            const canDrag = Boolean(onDragStart) && !disabled;

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -16 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <button
                  type="button"
                  draggable={canDrag}
                  onDragStart={(event) => {
                    if (!onDragStart) {
                      return;
                    }
                    const nextSelectedIds = selected ? selectedIds : [item.id];
                    if (!selected) {
                      onSelectedIdsChange(nextSelectedIds);
                    }
                    onDragStart(event, { item, selectedIds: nextSelectedIds });
                  }}
                  onDragEnd={onDragEnd}
                  onClick={() => toggleItem(item.id)}
                  className={cn(
                    "group relative w-full overflow-hidden rounded-lg border text-left transition select-none",
                    selected
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border/60 hover:border-primary/40",
                    canDrag && "cursor-grab active:cursor-grabbing",
                    disabled && "pointer-events-none opacity-60",
                  )}
                >
                  <div className="relative aspect-[4/3] w-full bg-muted/30">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.alt || item.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        Preview unavailable
                      </div>
                    )}
                    <div
                      className={cn(
                        "absolute inset-0 bg-black/40 transition-opacity",
                        selected ? "opacity-100" : "opacity-0 group-hover:opacity-15",
                      )}
                    />
                    <span
                      className={cn(
                        "absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full border text-[11px]",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-white/60 bg-black/45 text-white",
                      )}
                    >
                      <Check className="size-3" />
                    </span>
                  </div>

                  <div className="space-y-1 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-xs font-medium">{item.title}</p>
                      {item.statusLabel ? (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            toneClassName[statusTone],
                          )}
                        >
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <p className="text-[11px] text-muted-foreground">{item.subtitle}</p>
                    ) : null}
                    {item.detailText ? (
                      <p className={cn("text-[11px]", toneClassName[detailTone])}>{item.detailText}</p>
                    ) : null}
                  </div>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
