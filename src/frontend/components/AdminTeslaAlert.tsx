/**
 * @fileoverview Global admin telemetry alert (0023 alerting).
 *
 * Renders at the top of EVERY /admin page (mounted in BaseLayout). It appears
 * ONLY when a drive list is active, and reports the telemetry state:
 *
 *   • Drive active + telemetry live  → "Telemetry active" + the compositor image
 *     of the actual car (from Tessie's vehicle_config).
 *   • Drive active + in window + toggle off → an "Enable telemetry" button.
 *   • Drive active + outside 7 AM–8 PM → a note that streaming is paused for now.
 *
 * Reads `GET /api/tesla/stream/banner` (one cheap aggregate) every 20s; writes the
 * toggle + starts the stream via the existing control routes. Self-hides on 404
 * (a worker without the ingest routes) and when no drive is active.
 *
 * LIVE TICKER: while telemetry is active it also polls `GET /api/tesla/stream/events`
 * every 5s for the newest PARSED frames and rotates through them (~3s each) in the
 * bar, so real-time data streams across the top of every admin page as it arrives.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Radio, Route } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Banner {
  activeDrive: { slug: string; title: string } | null;
  telemetryActive: boolean;
  telemetryEnabled: boolean;
  withinWindow: boolean;
  canEnable: boolean;
  windowLabel: string;
  vehicleImageUrl: string | null;
}

interface TelemetryEvent {
  id: number;
  at: string | null;
  gear: string | null;
  speed: number | null;
  batteryLevel: number | null;
  latitude: number | null;
  longitude: number | null;
  text: string;
}

const REFRESH_MS = 20_000;
/** How often to pull new parsed frames while live. */
const EVENTS_MS = 5_000;
/** How long each parsed event is shown before rotating to the next. */
const ROTATE_MS = 3_000;

export function AdminTeslaAlert() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [gone, setGone] = useState(false);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [rotateIdx, setRotateIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  // Tracks the live flag for async guards — an in-flight events fetch must not
  // repopulate the buffer after telemetry has gone inactive.
  const liveRef = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const stopTicker = useCallback(() => {
    if (eventsTimer.current) {
      clearInterval(eventsTimer.current);
      eventsTimer.current = null;
    }
    if (rotateTimer.current) {
      clearInterval(rotateTimer.current);
      rotateTimer.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tesla/stream/banner", { credentials: "include" });
      if (!mounted.current) return;
      if (res.status === 404) {
        setGone(true);
        stop();
        return;
      }
      if (res.ok) setBanner((await res.json()) as Banner);
    } catch {
      /* transient — keep the last state */
    }
  }, [stop]);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/tesla/stream/events?limit=8", { credentials: "include" });
      // Drop the result if we unmounted OR telemetry went inactive while the
      // request was in flight, so a late response can't repopulate stale frames.
      if (!mounted.current || !liveRef.current || !res.ok) return;
      const data = (await res.json()) as { events?: TelemetryEvent[] };
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      /* transient — keep the last frames */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    timer.current = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => {
      mounted.current = false;
      stop();
      stopTicker();
    };
  }, [load, stop, stopTicker]);

  // Ticker lifecycle: poll parsed frames + rotate ONLY while telemetry is live.
  const live = Boolean(banner?.telemetryActive);
  useEffect(() => {
    liveRef.current = live;
    if (!live) {
      stopTicker();
      setEvents([]);
      setRotateIdx(0);
      return;
    }
    void loadEvents();
    eventsTimer.current = setInterval(() => {
      if (!document.hidden) void loadEvents();
    }, EVENTS_MS);
    rotateTimer.current = setInterval(() => {
      // Don't advance while the tab is hidden — no one is watching and it's wasted work.
      if (!document.hidden) setRotateIdx((i) => i + 1);
    }, ROTATE_MS);
    return stopTicker;
  }, [live, loadEvents, stopTicker]);

  const enable = async () => {
    setEnabling(true);
    try {
      await fetch("/api/tesla/stream/control", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      // Prompt the DO to connect now rather than waiting for the next tick.
      await fetch("/api/tesla/stream/start", { method: "POST", credentials: "include" }).catch(
        () => {},
      );
      await load();
    } finally {
      if (mounted.current) setEnabling(false);
    }
  };

  // Only ever shown while a drive list is active (and once the routes exist).
  if (gone || !banner?.activeDrive) return null;

  const { activeDrive, telemetryActive, canEnable, withinWindow, windowLabel, vehicleImageUrl } = banner;
  // The parsed frame currently in the rotation (newest-first buffer, wraps around).
  const current = events.length > 0 ? events[rotateIdx % events.length] : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm",
        telemetryActive
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-amber-500/30 bg-amber-500/10",
      )}
      role="status"
    >
      <span className="flex items-center gap-2 font-medium">
        <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        Drive list active:{" "}
        <a href={`/admin/shopping/drives/${activeDrive.slug}`} className="underline underline-offset-2">
          {activeDrive.title}
        </a>
      </span>

      {telemetryActive ? (
        <span className="flex items-center gap-1.5 font-medium text-emerald-300">
          <Radio className="size-3.5 animate-pulse" aria-hidden />
          Telemetry active
        </span>
      ) : (
        <span className="text-muted-foreground">
          {withinWindow ? "Telemetry off" : `Telemetry paused — window is ${windowLabel}`}
        </span>
      )}

      {telemetryActive && current && (
        <span
          key={current.id}
          className="flex min-w-0 items-center gap-2 font-mono text-xs text-emerald-100/90 tabular-nums animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
          title="Latest parsed telemetry frame"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          <span className="truncate">{current.text}</span>
        </span>
      )}

      {canEnable && (
        <Button size="sm" className="h-7" onClick={() => void enable()} disabled={enabling}>
          {enabling && <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />}
          Enable telemetry
        </Button>
      )}

      {telemetryActive && vehicleImageUrl && (
        <img
          src={vehicleImageUrl}
          alt="Your Tesla"
          width={120}
          height={60}
          loading="lazy"
          className="ml-auto h-12 w-auto object-contain drop-shadow"
        />
      )}
    </div>
  );
}

export default AdminTeslaAlert;
