/**
 * @fileoverview CollapsibleGroup — single-open accordion group section.
 *
 * Used by every grouped list in the app (showroom list/directory tabs, brands
 * landing by category, global products by brand/showroom/type) so grouping
 * behaves identically everywhere: exactly ONE group is expanded at a time.
 * Tapping a group header expands it and collapses the others (great for a small
 * touch screen — e.g. the car). Tapping the already-open group collapses it, so
 * everything can be folded away.
 *
 * `useAccordionGroup(orderedKeys)` owns the single-open state. It defaults to the
 * first group open, and resets to the first group whenever the set of groups
 * changes (e.g. the user switches the Group-By toggle or a filter) — but within
 * a stable group set the user's expand/collapse choices are respected, including
 * collapsing all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Join separator for the group-set signature — printable, never in a label. */
const GROUP_SIG_SEP = "|~|";

/**
 * Single-open accordion state for a list of ordered group keys.
 *
 * @param orderedKeys - the group keys in render order; `orderedKeys[0]` is the
 *   default-open group.
 * @returns `openKey` (the currently expanded group, or null when all collapsed)
 *   and `toggle(key)` which opens `key` (collapsing others) or collapses it if
 *   it is already open.
 */
export function useAccordionGroup(
  orderedKeys: string[],
  /**
   * Optional group to open by default / when it resolves later (e.g. the region
   * nearest the user's geolocation). When present in `orderedKeys` it wins over
   * the first-group default, and a CHANGE in this value re-opens to it — so the
   * user's local region expands the moment their location is known. Manual
   * toggles still work; they're only overridden when `preferredKey` next changes.
   */
  preferredKey?: string | null,
): {
  openKey: string | null;
  toggle: (key: string) => void;
} {
  // A stable signature of the current group set; when it changes we reset the
  // open group back to the preferred (or first) one.
  const signature = orderedKeys.join(GROUP_SIG_SEP);
  const preferredValid = preferredKey != null && orderedKeys.includes(preferredKey);
  const [openKey, setOpenKey] = useState<string | null>(
    preferredValid ? preferredKey! : (orderedKeys[0] ?? null),
  );
  const prevSignature = useRef(signature);
  const prevPreferred = useRef<string | null>(preferredKey ?? null);

  useEffect(() => {
    const valid = preferredKey != null && orderedKeys.includes(preferredKey);
    if (prevSignature.current !== signature) {
      prevSignature.current = signature;
      prevPreferred.current = preferredKey ?? null;
      setOpenKey(valid ? preferredKey! : (orderedKeys[0] ?? null));
    } else if (valid && prevPreferred.current !== preferredKey) {
      // The preferred group changed (e.g. geolocation just resolved) → open it.
      prevPreferred.current = preferredKey ?? null;
      setOpenKey(preferredKey!);
    }
  }, [signature, orderedKeys, preferredKey]);

  const toggle = useCallback((key: string) => {
    setOpenKey((current) => (current === key ? null : key));
  }, []);

  return { openKey, toggle };
}

/**
 * A collapsible group section: a full-width header button (with a rotating
 * chevron) over a body that only renders when `open`.
 *
 * `header` is the caller's existing header content (title, count badge, icon) —
 * it is laid out to the right of the chevron so grouped views keep their look.
 */
export function CollapsibleGroup({
  open,
  onToggle,
  header,
  className,
  headerClassName,
  contentClassName,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  header: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg py-1 text-left transition-opacity hover:opacity-90",
          headerClassName,
        )}
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open ? "" : "-rotate-90",
          )}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 items-center gap-3">{header}</div>
      </button>
      {open ? (
        <div className={cn("mt-4", contentClassName)}>{children}</div>
      ) : null}
    </section>
  );
}
