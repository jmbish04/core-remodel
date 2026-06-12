import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ImageGalleryContextAction } from "@/components/ui/image-gallery";
import { cn } from "@/lib/utils";

export interface BentoImageItem {
  id: string;
  src: string;
  alt?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
}

export interface GridBentoProps {
  items: BentoImageItem[];
  selectedId?: string | null;
  onSelect?: (item: BentoImageItem) => void;
  contextActions?: ImageGalleryContextAction[];
  className?: string;
}

const BENTO_VARIANTS = [
  "sm:col-span-2 sm:row-span-2",
  "sm:col-span-1 sm:row-span-1",
  "sm:col-span-1 sm:row-span-2",
  "sm:col-span-2 sm:row-span-1",
] as const;

export function GridBento(props: GridBentoProps) {
  const { items, selectedId, onSelect, contextActions, className } = props;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-3 auto-rows-[8rem]",
        className,
      )}
    >
      {items.map((item, index) => {
        const isSelected = selectedId === item.id;
        const variant = BENTO_VARIANTS[index % BENTO_VARIANTS.length];
        const hasContextActions = Boolean(contextActions && contextActions.length > 0);

        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger className={cn("block", variant)}>
              <button
                type="button"
                onClick={() => onSelect?.(item)}
                className={cn(
                  "group relative h-full w-full overflow-hidden rounded-2xl border text-left",
                  "ring-1 ring-border/40 transition hover:-translate-y-0.5 hover:shadow-xl",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "ring-2 ring-ring",
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
                <img
                  src={item.src}
                  alt={item.alt || item.title || item.id}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />

                <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/15 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 space-y-1 p-3 text-white">
                  {item.badge && (
                    <span className="inline-block rounded bg-white/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                      {item.badge}
                    </span>
                  )}
                  {item.title && <p className="truncate text-sm font-medium">{item.title}</p>}
                  {item.subtitle && <p className="truncate text-xs text-white/80">{item.subtitle}</p>}
                </div>
              </button>
            </ContextMenuTrigger>
            {hasContextActions ? (
              <ContextMenuContent>
                {contextActions?.map((action) => {
                  const isDisabled =
                    typeof action.disabled === "function"
                      ? action.disabled(item)
                      : Boolean(action.disabled);
                  return (
                    <React.Fragment key={`${item.id}-${action.id}`}>
                      {action.separatorBefore ? <ContextMenuSeparator /> : null}
                      <ContextMenuItem
                        disabled={isDisabled}
                        variant={action.variant}
                        onClick={() => action.onSelect(item)}
                      >
                        {action.label}
                      </ContextMenuItem>
                    </React.Fragment>
                  );
                })}
              </ContextMenuContent>
            ) : null}
          </ContextMenu>
        );
      })}
    </div>
  );
}
