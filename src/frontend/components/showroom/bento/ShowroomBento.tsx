/**
 * @fileoverview ShowroomBento — a selectable bento grid of showroom sections.
 *
 * Adapted from the beste `bento1` block into a Monolith dark, keyboard-operable
 * selector grid. Each section is a tile; the active tile is highlighted
 * (ring-2 ring-primary). Clicking a tile calls `onSelect(key)`.
 *
 * This component renders ONLY the selector grid — the parent is responsible for
 * rendering the active section's content below it. Tiles take varied sizes for
 * a true bento rhythm: the first tile is the anchor (wider + taller), the rest
 * flow around it, and the layout collapses to a single column on mobile.
 */

import type React from "react";
import { cn } from "@/lib/utils";

export interface ShowroomBentoSection {
  key: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

interface ShowroomBentoProps {
  sections: ShowroomBentoSection[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}

/**
 * Varied tile spans for a bento rhythm. The pattern repeats every 6 tiles so
 * any number of sections keeps a balanced, non-uniform grid on desktop. On
 * mobile everything stacks to a single column (spans are md:+ only).
 */
const SPAN_PATTERN = [
  "md:col-span-4 md:row-span-2", // anchor — big
  "md:col-span-2",
  "md:col-span-2",
  "md:col-span-3",
  "md:col-span-3",
  "md:col-span-2",
] as const;

function tileSpan(index: number): string {
  return SPAN_PATTERN[index % SPAN_PATTERN.length];
}

export function ShowroomBento({ sections, activeKey, onSelect }: ShowroomBentoProps) {
  if (sections.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6 md:auto-rows-[minmax(120px,auto)]">
      {sections.map((section, i) => {
        const active = section.key === activeKey;
        return (
          <button
            key={section.key}
            type="button"
            onClick={() => onSelect(section.key)}
            aria-pressed={active}
            className={cn(
              "group/tile relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl bg-card p-5 text-left transition-all",
              "ring-1 ring-border/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-primary/10 ring-2 ring-primary/50 hover:bg-primary/10",
              tileSpan(i),
            )}
          >
            {section.icon && (
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                  active && "bg-primary/15 text-primary",
                )}
              >
                {section.icon}
              </span>
            )}
            <div>
              <h3
                className={cn(
                  "text-base font-semibold tracking-tight text-foreground",
                  i === 0 && "md:text-xl",
                )}
              >
                {section.title}
              </h3>
              {section.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {section.description}
                </p>
              )}
            </div>
            {active && (
              <span className="pointer-events-none absolute right-3 top-3 size-2 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
