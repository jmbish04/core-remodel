/**
 * @fileoverview FloorplanLiveApp — the phone/desktop surface for a live measuring
 * session (0006 Phase 2C).
 *
 * Renders the traced wall SVG for a level, connects to the room's `FloorplanSessionDO`
 * over a WebSocket, and runs the bidirectional highlight loop:
 *   - tap a wall segment  → broadcast `WALL_TOUCH` (Claude/other peers see it) + a cyan
 *     self-flash confirming it was sent;
 *   - inbound `WALL_TOUCH` → an amber flash on that segment ("Claude is pointing here").
 *
 * Manual entry (a backup, or for a second person entering while you measure) lives on
 * the existing `/measurements` page, linked from the header.
 *
 * The traced SVGs use black strokes (for print); we recolor them for the dark theme and
 * make each `*_wall_segment_*` line tappable. The SVG is fetched + injected, and the
 * click listener is attached natively to the container (not a JSX onClick) so delegation
 * works on the injected nodes.
 */

import * as React from "react";
import { Loader2, Ruler, Wifi, WifiOff } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFloorplanSocket, type SocketStatus } from "@/lib/use-floorplan-socket";
import { cn } from "@/lib/utils";

type Level = "lower" | "upper";

/** Room name for this house's session. One DO instance is keyed by this string. */
const ROOM = "126-colby";
const FLASH_MS = 1500;

/**
 * Make a traced SVG responsive: add a viewBox derived from width/height (the traced
 * files have none) and strip the fixed width/height so CSS can scale it to the viewport.
 */
function ensureResponsiveSvg(svgText: string): string {
  return svgText.replace(/<svg\b([^>]*)>/, (_match, rawAttrs: string) => {
    let attrs = rawAttrs;
    const width = attrs.match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1];
    const height = attrs.match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1];
    if (!/viewBox=/.test(attrs) && width && height) {
      attrs += ` viewBox="0 0 ${width} ${height}"`;
    }
    attrs = attrs.replace(/\s(?:width|height)="[^"]*"/g, "");
    return `<svg${attrs}>`;
  });
}

/** Segment + state styling for the injected SVG (scoped under `.fp-canvas`). */
const CANVAS_STYLES = `
.fp-canvas svg { width: 100%; height: auto; max-height: 78svh; display: block; margin: 0 auto; touch-action: manipulation; }
.fp-canvas [id*="_wall_segment_"] {
  stroke: hsl(var(--muted-foreground));
  stroke-width: 3;
  cursor: pointer;
  pointer-events: stroke;
  transition: stroke 0.15s ease, stroke-width 0.15s ease;
}
.fp-canvas [id*="_wall_segment_"]:hover { stroke: hsl(var(--foreground)); stroke-width: 4; }
.fp-canvas [id*="_wall_segment_"].fp-flash-self { stroke: #38bdf8; animation: fp-pulse 1.4s ease-out; }
.fp-canvas [id*="_wall_segment_"].fp-flash-peer { stroke: #f59e0b; animation: fp-pulse 1.4s ease-out; }
@keyframes fp-pulse { 0% { stroke-width: 11; } 100% { stroke-width: 4; } }
`;

function StatusPill({ status }: { status: SocketStatus }) {
  const map = {
    open: { label: "Live", cls: "text-emerald-400", Icon: Wifi },
    connecting: { label: "Connecting…", cls: "text-amber-400", Icon: Wifi },
    closed: { label: "Offline", cls: "text-rose-400", Icon: WifiOff },
  } as const;
  const { label, cls, Icon } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg bg-muted/40 px-2.5 py-1 text-xs font-medium ring-1 ring-border/40",
        cls,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

export function FloorplanLiveApp() {
  const [level, setLevel] = React.useState<Level>("lower");
  const [svg, setSvg] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const flashTimers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** Briefly highlight a segment: "self" = cyan (you sent), "peer" = amber (incoming). */
  const flashSegment = React.useCallback((elementId: string, kind: "self" | "peer") => {
    const root = canvasRef.current;
    if (!root) return;
    let el: Element | null = null;
    try {
      el = root.querySelector(`#${CSS.escape(elementId)}`);
    } catch {
      return;
    }
    if (!el) return;
    const cls = kind === "self" ? "fp-flash-self" : "fp-flash-peer";
    el.classList.remove("fp-flash-self", "fp-flash-peer");
    void el.getBoundingClientRect(); // restart the animation
    el.classList.add(cls);
    const prev = flashTimers.current.get(elementId);
    if (prev) clearTimeout(prev);
    flashTimers.current.set(
      elementId,
      setTimeout(() => {
        el?.classList.remove(cls);
        flashTimers.current.delete(elementId);
      }, FLASH_MS),
    );
  }, []);

  const socket = useFloorplanSocket(
    ROOM,
    "phone",
    React.useCallback(
      (msg) => {
        flashSegment(msg.elementId, "peer");
      },
      [flashSegment],
    ),
  );

  // Load the traced SVG for the active level.
  React.useEffect(() => {
    let active = true;
    setSvg(null);
    setLoadError(null);
    fetch(`/floorplans/traced_${level}_walls.svg`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (active) setSvg(ensureResponsiveSvg(text));
      })
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : "Failed to load floor plan");
      });
    return () => {
      active = false;
    };
  }, [level]);

  // Delegate clicks on the injected SVG → broadcast a touch + self-flash.
  React.useEffect(() => {
    const root = canvasRef.current;
    if (!root || !svg) return;
    const handler = (event: Event) => {
      const target = event.target as Element | null;
      const segment = target?.closest('[id*="_wall_segment_"]');
      if (!segment?.id) return;
      socket.sendWallTouch(segment.id);
      flashSegment(segment.id, "self");
    };
    root.addEventListener("click", handler);
    return () => root.removeEventListener("click", handler);
  }, [svg, socket, flashSegment]);

  // Clear any pending flash timers on unmount.
  React.useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return (
    <div className="space-y-4">
      <style>{CANVAS_STYLES}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live floor plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap a wall to flag it for Claude; it flashes here when Claude points to one.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={socket.status} />
          <a href="/measurements" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Ruler className="mr-2 size-4" />
            Manual entry
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 ring-1 ring-border/40">
          {(["lower", "upper"] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevel(lvl)}
              aria-pressed={level === lvl}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                level === lvl
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {lvl} level
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#38bdf8]" /> You
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#f59e0b]" /> Claude / peer
          </span>
        </div>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardContent>
          {loadError ? (
            <p className="py-12 text-center text-sm text-destructive">{loadError}</p>
          ) : !svg ? (
            <div className="flex min-h-[40svh] items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              Loading floor plan…
            </div>
          ) : (
            <div
              ref={canvasRef}
              className="fp-canvas"
              role="application"
              aria-label={`${level} level floor plan — tap a wall segment to flag it`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
