/**
 * @fileoverview useUnitSystem — app-wide imperial/metric display preference (0006).
 *
 * The preference is persisted in localStorage (there is no auth / per-user store yet)
 * and synced across every React island on the page plus other tabs:
 *   - a custom `unitsystemchange` window event syncs islands in the SAME tab (each
 *     island is its own React root, so React state alone wouldn't propagate), and
 *   - the native `storage` event syncs OTHER tabs.
 *
 * Default is `imperial` (this is a US home); contractors/suppliers who work in metric
 * flip the toggle and every measurement/area re-renders in metres.
 */

import * as React from "react";

import type { UnitSystem } from "./units";

const STORAGE_KEY = "core-remodel:unit-system";
const CHANGE_EVENT = "unitsystemchange";

/** Read the persisted preference, defaulting to imperial. */
function readStored(): UnitSystem {
  if (typeof window === "undefined") return "imperial";
  return window.localStorage.getItem(STORAGE_KEY) === "metric" ? "metric" : "imperial";
}

/**
 * Subscribe to the active unit system and a setter that persists + broadcasts it.
 * Returns `[unitSystem, setUnitSystem]`.
 */
export function useUnitSystem(): [UnitSystem, (next: UnitSystem) => void] {
  // Lazy initializer reads storage immediately (these islands are client-only, so
  // `window` exists and there is no SSR hydration mismatch) — avoids a flash of the
  // default unit.  The effect below keeps it synced across islands + tabs.
  const [unitSystem, setState] = React.useState<UnitSystem>(readStored);

  React.useEffect(() => {
    setState(readStored());
    const sync = () => setState(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setUnitSystem = React.useCallback((next: UnitSystem) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
    setState(next);
  }, []);

  return [unitSystem, setUnitSystem];
}
