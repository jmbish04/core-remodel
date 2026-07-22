"use client";

/**
 * @fileoverview Shrink text to fit a fixed-height box.
 *
 * Slide content is AI-generated, so its length is unpredictable — one changelog
 * entry's problem statement is two sentences and the next is nine paragraphs.
 * A fixed font size either wastes most of the slide or overflows it.
 *
 * This binary-searches the largest font size at which the content still fits,
 * then sets it on the wrapper. Because Tailwind Typography sizes everything in
 * `em`, one font-size on the `prose` root scales headings, paragraphs, lists and
 * inline code together, in proportion.
 *
 * ## Why there is no state and no re-render
 *
 * The measurement writes `style.fontSize` DIRECTLY to the DOM node. Routing it
 * through `useState` would mean: render → measure → setState → render → the
 * ResizeObserver fires because the content resized → measure → setState → …
 * That is the infinite loop this component exists to avoid. Mutating the style
 * imperatively keeps the whole thing outside React's render cycle, so it costs
 * exactly one layout pass per measurement and never schedules a render.
 *
 * Re-entry from the ResizeObserver is prevented by comparing measurements, not
 * by muting on a timer — see the `last` ref for why a frame-based mute is a
 * deadlock waiting to happen.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface AutoScaleContainerProps {
  children: React.ReactNode;
  /** Smallest font size to try, in px. If even this overflows, the box scrolls. */
  min?: number;
  /** Largest font size to try, in px. Short content stops here. */
  max?: number;
  /**
   * Changes to this value re-run the fit. Pass the source text — children are a
   * new element object on every render, so they cannot be a dependency.
   */
  contentKey?: string;
  className?: string;
  /** Applied to the inner element that receives the computed font size. */
  contentClassName?: string;
}

/** Stop when the window narrows below this — half a px of font size is invisible. */
const PRECISION = 0.5;

export function AutoScaleContainer({
  children,
  min = 12,
  max = 32,
  contentKey,
  className,
  contentClassName,
}: AutoScaleContainerProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  /**
   * What the last successful fit saw. This is the whole loop-prevention
   * mechanism, and it is a MEMO rather than a mute flag on purpose.
   *
   * The earlier version muted the observers for a measurement and released the
   * mute on the next animation frame. That deadlocks: `requestAnimationFrame`
   * does not fire while the page is not being rendered, so a measurement that
   * lands just before the tab is backgrounded leaves the mute stuck on forever
   * and the container never re-fits again — observed as a slide that scaled once
   * and then ignored every later resize.
   *
   * Comparing measurements has no timing dependency at all. A schedule whose
   * box, font size and content height all match the last fit is our own write
   * echoing back through the ResizeObserver, and is dropped. Anything else — a
   * real resize, a mermaid diagram finishing its paint, a font swapping in — has
   * a different measurement and gets a fresh fit.
   */
  const last = useRef({ boxH: -1, boxW: -1, font: -1, contentH: -1 });
  const running = useRef(false);

  const fit = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || running.current) return;

    const available = box.clientHeight;
    // A zero-height box means the element is not laid out yet (display:none, a
    // slide that has not been switched to). Measuring it would "fit" at max and
    // then be wrong the moment it appears, so skip and wait for the observer.
    if (available <= 0) return;

    running.current = true;
    try {
      const fits = (size: number) => {
        content.style.fontSize = `${size}px`;
        // Reading scrollHeight forces the layout we just invalidated — one
        // synchronous reflow per probe, ~6 probes total for a 12–32px range.
        return content.scrollHeight <= available;
      };

      let size: number;
      if (fits(max)) {
        // Fast path: short content fits at max, and that answer costs one probe
        // instead of six. Note this also GROWS text back after the box does —
        // the search is re-entered from scratch every time, never from the
        // previous result, so shrinking is not a one-way door.
        size = max;
      } else {
        let lo = min;
        let hi = max;
        while (hi - lo > PRECISION) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        // `lo` is the last size known to fit. `hi` may not, so never end on it.
        size = lo;
      }

      content.style.fontSize = `${size}px`;
      last.current = {
        boxH: available,
        boxW: box.clientWidth,
        font: size,
        contentH: content.scrollHeight,
      };
    } finally {
      // Synchronous release. Nothing here waits on a frame that may never come.
      running.current = false;
    }
  }, [max, min]);

  const schedule = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || running.current) return;

    const unchanged =
      box.clientHeight === last.current.boxH &&
      box.clientWidth === last.current.boxW &&
      Number.parseFloat(content.style.fontSize) === last.current.font &&
      content.scrollHeight === last.current.contentH;
    if (unchanged) return;

    fit();
  }, [fit]);

  // Layout effect, not effect: the first paint should already be at the fitted
  // size. In a passive effect the reader sees one frame of 32px text collapsing.
  useLayoutEffect(() => {
    // Reset the memo so a new slide always measures, even if it happens to have
    // the same box dimensions as the one before it.
    last.current = { boxH: -1, boxW: -1, font: -1, contentH: -1 };
    fit();
  }, [fit, contentKey]);

  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    // Both are observed on purpose. The box changes when the viewport or the
    // surrounding layout does; the content changes when an async child resolves
    // — a mermaid diagram painting, a webfont swapping in — which is invisible
    // to a box-only observer and is exactly when the fit goes stale.
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    observer.observe(content);
    window.addEventListener("resize", schedule);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [schedule]);

  return (
    /*
      overflow-y-auto, not overflow-hidden. When content cannot fit even at `min`
      — a very short viewport against a very long slide — clipping would hide the
      tail of the text with no indication that anything was missing. Scrolling is
      a worse presentation and an honest one; hiding it is neither.
    */
    <div ref={boxRef} className={cn("relative h-full min-h-0 overflow-y-auto", className)}>
      <div ref={contentRef} className={contentClassName} style={{ fontSize: `${max}px` }}>
        {children}
      </div>
    </div>
  );
}
