import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * scroll-progress.tsx — a reusable, sticky right-rail "table of contents" that
 * tracks which on-page section is currently in view and lets the user jump to
 * any section by clicking its entry. Built for the cloudflare-jedi Monolith
 * theme (dark, no 1px borders — uses a left rail accent + bg tint instead).
 *
 * Why reusable: the room viewport, the floor-plan page, and future long-form
 * dashboards all want the same "scroll-spy + jump" behavior, so this lives in
 * `components/ui/` rather than in any one feature folder.
 *
 * Mechanics
 * ---------
 * - Active-section detection uses an IntersectionObserver against the elements
 *   resolved from each item's `id`. The entry whose top is closest to the top
 *   of the viewport (but still intersecting) wins; this is stable while the
 *   user scrolls through tall sections.
 * - Clicking an item calls `scrollIntoView({ behavior: "smooth" })` on the
 *   matching element, then optimistically marks it active so the highlight
 *   never lags behind the click.
 * - `scrollAreaRef` lets a caller scope the observer to a scroll container
 *   (e.g. a modal body). When omitted the observer uses the viewport root.
 *
 * Accessibility
 * -------------
 * Rendered as a `<nav>` with an aria-label; each entry is a real `<button>`
 * so it is keyboard-focusable and announces its active state via
 * `aria-current="true"`. The component is purely a navigation aid — it never
 * traps focus and is hidden (not removed) on small screens by callers via
 * the `className` prop (e.g. `hidden xl:block`).
 */

/** A single navigable section entry. */
export interface ScrollProgressItem {
  /** The DOM id of the section element this entry scrolls to. */
  id: string;
  /** Human-readable label shown in the rail. */
  title: string;
  /**
   * Indentation depth (1 = top level). Deeper levels are visually inset so a
   * nested outline reads as a hierarchy. Defaults to 1 when omitted.
   */
  level?: number;
}

export interface ScrollProgressProps {
  /** Ordered list of sections to track + render, top to bottom. */
  items: ScrollProgressItem[];
  /** Extra classes for the outer `<nav>` (positioning, responsive hiding). */
  className?: string;
  /**
   * Optional scroll container to scope the IntersectionObserver to. When
   * provided, intersection is computed relative to this element instead of the
   * viewport — useful inside scrollable modals/panels.
   */
  scrollAreaRef?: React.RefObject<HTMLElement | null>;
  /**
   * Optional heading shown above the rail. Defaults to "On this page".
   * Pass `null` to render no heading.
   */
  heading?: React.ReactNode;
}

/**
 * Resolves the element each item points at, in document order, skipping any
 * ids that are not (yet) mounted. Returns parallel arrays so the observer and
 * the click handler share one source of truth.
 */
function useResolvedTargets(items: ScrollProgressItem[]) {
  return useCallback(() => {
    if (typeof document === "undefined") return [] as Array<{ id: string; el: HTMLElement }>;
    const resolved: Array<{ id: string; el: HTMLElement }> = [];
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) resolved.push({ id: item.id, el });
    }
    return resolved;
  }, [items]);
}

export function ScrollProgress({
  items,
  className,
  scrollAreaRef,
  heading = "On this page",
}: ScrollProgressProps) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  // Tracks the last id the user explicitly clicked so the smooth-scroll
  // animation does not get visually "fought" by the observer mid-flight.
  const clickLockRef = useRef<{ id: string; until: number } | null>(null);
  const resolveTargets = useResolvedTargets(items);

  useEffect(() => {
    const targets = resolveTargets();
    if (targets.length === 0) return;

    const root = scrollAreaRef?.current ?? null;

    // Track visibility ratios so we can pick the topmost visible section.
    const visibility = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("id");
          if (!id) continue;
          visibility.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        // Honor a recent click: keep the clicked section active until the
        // smooth scroll has had time to settle.
        const lock = clickLockRef.current;
        if (lock && Date.now() < lock.until) {
          setActiveId(lock.id);
          return;
        }

        // Otherwise pick the first item (in declared order) that is visible.
        let nextActive: string | null = null;
        for (const item of items) {
          if ((visibility.get(item.id) ?? 0) > 0) {
            nextActive = item.id;
            break;
          }
        }
        if (nextActive) setActiveId(nextActive);
      },
      {
        root,
        // A negative top margin biases "active" toward the section whose top
        // has scrolled to roughly the upper third of the viewport.
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0, 0.1, 0.5, 1],
      },
    );

    for (const { el } of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [items, resolveTargets, scrollAreaRef]);

  const handleJump = useCallback(
    (id: string) => {
      const el = typeof document !== "undefined" ? document.getElementById(id) : null;
      if (!el) return;
      clickLockRef.current = { id, until: Date.now() + 800 };
      setActiveId(id);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [],
  );

  const renderedItems = useMemo(() => items.filter((item) => item.title.trim().length > 0), [items]);

  if (renderedItems.length === 0) return null;

  return (
    <nav
      aria-label="Section navigation"
      className={cn("flex flex-col gap-1 text-sm", className)}
    >
      {heading != null ? (
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {heading}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {renderedItems.map((item) => {
          const isActive = item.id === activeId;
          const level = Math.max(1, item.level ?? 1);
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                onClick={() => handleJump(item.id)}
                className={cn(
                  "group/toc relative flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors",
                  isActive
                    ? "bg-muted/60 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                )}
                style={{ paddingLeft: `${0.75 + (level - 1) * 0.75}rem` }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-0.5 shrink-0 rounded-full transition-colors",
                    isActive ? "bg-primary" : "bg-transparent group-hover/toc:bg-border",
                  )}
                />
                <span className="line-clamp-1">{item.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default ScrollProgress;
