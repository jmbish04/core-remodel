import React from "react";
import { LazyImage } from "@/components/lazy-image";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { ImageGalleryContextAction, ImageGalleryItem } from "@/components/ui/image-gallery";

export interface ImageGalleryMasonryProps {
  items: ImageGalleryItem[];
  selectedId?: string | null;
  onSelect?: (item: ImageGalleryItem) => void;
  contextActions?: ImageGalleryContextAction[];
  className?: string;
}

const RATIOS = [1, 4 / 3, 3 / 4, 16 / 9, 2 / 3] as const;

function ratioForId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }
  const normalized = Math.abs(hash) % RATIOS.length;
  return RATIOS[normalized] ?? 1;
}

export function ImageGalleryMasonry(props: ImageGalleryMasonryProps) {
  const { items, selectedId, onSelect, contextActions, className } = props;

  return (
    <div className={cn("columns-1 gap-4 sm:columns-2 md:columns-3 xl:columns-4", className)}>
      {items.map((item) => {
        const selected = selectedId === item.id;
        const hasContextActions = Boolean(contextActions && contextActions.length > 0);
        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger>
              <button
                type="button"
                onClick={() => onSelect?.(item)}
                className={cn(
                  "mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border bg-card text-left",
                  "ring-1 ring-border/40 transition hover:-translate-y-0.5 hover:shadow-lg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "ring-2 ring-ring",
                )}
              >
                <div className="relative overflow-hidden">
                  <LazyImage
                    alt={item.alt || item.title || item.id}
                    src={item.src}
                    ratio={ratioForId(item.id)}
                    inView
                    className="transition-transform duration-300 hover:scale-[1.02]"
                    containerClassName="border-0 bg-muted/40"
                  />
                  {item.badge && (
                    <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white">
                      {item.badge}
                    </span>
                  )}
                </div>

                {(item.title || item.subtitle || (item.tags && item.tags.length > 0)) && (
                  <div className="space-y-1 p-2.5">
                    {item.title && <p className="truncate text-sm font-medium">{item.title}</p>}
                    {item.subtitle && (
                      <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.slice(0, 2).map((tag) => (
                          <span
                            key={`${item.id}-${tag}`}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {item.tags.length > 2 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            +{item.tags.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
