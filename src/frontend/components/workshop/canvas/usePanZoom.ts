// ---------------------------------------------------------------------------
// usePanZoom — the canvas chrome kept from the devl.dev shell: ⌘/ctrl-wheel
// zoom centered on the cursor, plain-wheel pan, space-to-pan, and fit-to-screen
// over the current nodes' bounds. Adapted from layouts-canvas-tools.tsx but
// decoupled from any node model (fit-to-screen takes a bounds getter).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export interface UsePanZoomResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  pan: Point;
  spaceDown: boolean;
  setPan: React.Dispatch<React.SetStateAction<Point>>;
  zoomBy: (delta: number) => void;
  fitToScreen: (bounds: Bounds | null) => void;
}

export function usePanZoom(): UsePanZoomResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState<Point>({ x: 120, y: 80 });
  const [spaceDown, setSpaceDown] = useState(false);

  // Keep the latest pan available to the non-reactive wheel listener.
  const panRef = useRef(pan);
  panRef.current = pan;

  // Wheel: cmd/ctrl-wheel zooms centered on cursor; plain wheel pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.01);
        setZoom((current) => {
          const next = clampZoom(current * factor);
          const p = panRef.current;
          const wx = (sx - p.x) / current;
          const wy = (sy - p.y) / current;
          setPan({ x: sx - wx * next, y: sy - wy * next });
          return next;
        });
      } else {
        event.preventDefault();
        setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Space-to-pan.
  useEffect(() => {
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable);
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const el = containerRef.current;
    if (!el) {
      setZoom((z) => clampZoom(z + delta));
      return;
    }
    const rect = el.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;
    setZoom((current) => {
      const next = clampZoom(current + delta);
      const p = panRef.current;
      const wx = (sx - p.x) / current;
      const wy = (sy - p.y) / current;
      setPan({ x: sx - wx * next, y: sy - wy * next });
      return next;
    });
  }, []);

  const fitToScreen = useCallback((bounds: Bounds | null) => {
    const el = containerRef.current;
    if (!el || !bounds) {
      setZoom(0.85);
      setPan({ x: 120, y: 80 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const padding = 96;
    const scaleX = (rect.width - padding * 2) / w;
    const scaleY = (rect.height - padding * 2) / h;
    const next = clampZoom(Math.min(scaleX, scaleY));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setZoom(next);
    setPan({ x: rect.width / 2 - cx * next, y: rect.height / 2 - cy * next });
  }, []);

  return { containerRef, zoom, pan, spaceDown, setPan, zoomBy, fitToScreen };
}
