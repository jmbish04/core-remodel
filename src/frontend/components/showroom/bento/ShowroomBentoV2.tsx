/**
 * @fileoverview ShowroomBentoV2 — compact selector grid (V2 item 9).
 *
 * Same contract as ShowroomBento, but tuned to reduce scrolling to the content
 * below:
 *   - icon and title sit on ONE line (was: icon stacked above the title with a
 *     large gap), and
 *   - a uniform, compact 3-up grid replaces the tall bento anchor, so the big
 *     "Brands & Products" card no longer dominates the fold.
 *
 * Temporary V2 component; promotes over ShowroomBento on sign-off.
 */
import type React from "react";
import { cn } from "@/lib/utils";

export interface ShowroomBentoSection {
  key: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Optional compact preview beneath the header (no nested interactive els). */
  preview?: React.ReactNode;
}

interface ShowroomBentoV2Props {
  sections: ShowroomBentoSection[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}

export function ShowroomBentoV2({ sections, activeKey, onSelect }: ShowroomBentoV2Props) {
  if (sections.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((section) => {
        const active = section.key === activeKey;
        return (
          <button
            key={section.key}
            type="button"
            onClick={() => onSelect(section.key)}
            aria-pressed={active}
            className={cn(
              "group/tile flex flex-col gap-2 overflow-hidden rounded-xl bg-card p-4 text-left transition-all",
              "ring-1 ring-border/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-primary/10 ring-2 ring-primary/50 hover:bg-primary/10",
            )}
          >
            {/* Icon + title on one line. */}
            <div className="flex items-center gap-2.5">
              {section.icon && (
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                    active && "bg-primary/15 text-primary",
                  )}
                >
                  {section.icon}
                </span>
              )}
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {section.title}
              </h3>
              {active && (
                <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" />
              )}
            </div>
            {section.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{section.description}</p>
            )}
            {section.preview && <div className="mt-1">{section.preview}</div>}
          </button>
        );
      })}
    </div>
  );
}
