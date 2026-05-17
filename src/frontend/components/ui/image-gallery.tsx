import React from "react";
import { cn } from "@/lib/utils";

export interface ImageGalleryItem {
  id: string;
  src: string;
  alt?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  tags?: string[];
}

export interface ImageGalleryProps {
  items: ImageGalleryItem[];
  selectedId?: string | null;
  onSelect?: (item: ImageGalleryItem) => void;
  className?: string;
  columnsClassName?: string;
}

export function ImageGallery(props: ImageGalleryProps) {
  const { items, selectedId, onSelect, className, columnsClassName } = props;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
        columnsClassName,
        className,
      )}
    >
      {items.map((item) => {
        const isSelected = selectedId === item.id;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect?.(item)}
            className={cn(
              "group overflow-hidden rounded-xl border bg-card text-left transition",
              "ring-1 ring-border/40 hover:-translate-y-0.5 hover:shadow-lg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected && "ring-2 ring-ring",
            )}
          >
            <div className="relative aspect-[4/3] overflow-hidden">
              {/* biome-ignore lint/performance/noImgElement: external delivery urls are expected */}
              <img
                src={item.src}
                alt={item.alt || item.title || item.id}
                loading="lazy"
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />

              {item.badge && (
                <span className="absolute left-2 top-2 rounded bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white">
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
                    {item.tags.slice(0, 3).map((tag) => (
                      <span
                        key={`${item.id}-${tag}`}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                    {item.tags.length > 3 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        +{item.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
