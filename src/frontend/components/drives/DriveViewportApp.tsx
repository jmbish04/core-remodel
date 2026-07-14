/**
 * @fileoverview Showroom Drive viewport island.
 *
 * Renders one drive sheet from D1 (`GET /api/drive-lists/:slug`): stops grouped
 * by leg/city, each with details and two ways to navigate.
 *
 * Stops are labeled by fork structure: core (non-optional) stops number 1, 2, 3…
 * while optional detours hang off the preceding core stop as "3a", "3b" and
 * render as an indented branch off the critical path. An optional-stops toggle
 * hides those detours from both the list and the embedded route map, and folds
 * them out of the progress math so a skipped side-trip never skews completion.
 *
 * Two navigate paths per stop:
 *   1. Google Maps directions URL (`navUrl`) — a plain link the Tesla browser
 *      hands off to Navigate. Always shown when the stop has an address.
 *   2. Tesla API — `POST /api/tesla/navigate` pushes the destination straight to
 *      the car via Tessie. Only rendered when `GET /api/tesla/status` reports the
 *      integration is configured.
 *
 * An always-visible interactive MapLibre map (`DriveRouteMap`) plots the shown
 * stops with labeled markers and a route line. Tapping a stop's node toggles its
 * visited check-off, persisted via `PATCH …/stops/:id` so progress survives
 * across devices.
 *
 * Monolith rules: dark theme, theme tokens only, no 1px borders.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Diamond,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  ShieldAlert,
  StickyNote,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { DriveRouteMap, type RouteMapStop } from "@/components/drives/DriveRouteMap";

type Stop = {
  id: number;
  sortOrder: number;
  leg: string | null;
  legWindow: string | null;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  note: string | null;
  pick: string | null;
  websiteUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isOptional: boolean;
  visited: boolean;
};

/** A stop with its precomputed fork label ("1", "3a", …). */
type LabeledStop = Stop & { label: string };

type Drive = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  notes: string[];
  status: string;
  stops: Stop[];
};

/** Google Maps directions URL — Tesla's browser offers one-tap Navigate on these. */
function navUrl(stop: Stop): string {
  const dest =
    stop.latitude != null && stop.longitude != null
      ? `${stop.latitude},${stop.longitude}`
      : (stop.address ?? `${stop.name} ${stop.city ?? ""}`.trim());
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/** Tesla "T" wordmark glyph. */
function TeslaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 4.6c2.3 0 4.2.5 5.1 1.3l1.1-1.9C16.9 3.3 14.6 2.9 12 2.9s-4.9.4-6.2 1.1l1.1 1.9c.9-.8 2.8-1.3 5.1-1.3zM12 6.2c-2 0-3.6.3-4.4.8l1.5 2.4c.6-.3 1.6-.5 2.9-.5s2.3.2 2.9.5l1.5-2.4c-.8-.5-2.4-.8-4.4-.8zM10.9 10.2v9.9h2.2v-9.9c-.4 0-.7-.1-1.1-.1s-.7.1-1.1.1z" />
    </svg>
  );
}

export function DriveViewportApp({ slug }: { slug: string }) {
  const [drive, setDrive] = useState<Drive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(true);
  const [teslaConfigured, setTeslaConfigured] = useState(false);
  const [navigatingStopId, setNavigatingStopId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/drive-lists/${encodeURIComponent(slug)}`, {
          credentials: "include",
        });
        if (res.status === 401) return active ? setError("unauthorized") : undefined;
        if (res.status === 404) return active ? setError("not-found") : undefined;
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as Drive;
        if (active) setDrive(data);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  // Is the Tesla integration configured? If not (or the probe fails), the Tesla
  // button never renders — the Google Maps link always stays.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/tesla/status", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { configured?: boolean };
        if (active) setTeslaConfigured(Boolean(data.configured));
      } catch {
        /* leave teslaConfigured false — button stays hidden */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggleVisited = useCallback(
    async (stop: Stop) => {
      const next = !stop.visited;
      // Optimistic update.
      setDrive((prev) =>
        prev
          ? { ...prev, stops: prev.stops.map((s) => (s.id === stop.id ? { ...s, visited: next } : s)) }
          : prev,
      );
      try {
        const res = await fetch(
          `/api/drive-lists/${encodeURIComponent(slug)}/stops/${stop.id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visited: next }),
          },
        );
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
      } catch (e) {
        // Revert on failure.
        setDrive((prev) =>
          prev
            ? {
                ...prev,
                stops: prev.stops.map((s) => (s.id === stop.id ? { ...s, visited: !next } : s)),
              }
            : prev,
        );
        toast.error((e as Error).message);
      }
    },
    [slug],
  );

  const sendToTesla = useCallback(
    async (stop: Stop) => {
      setNavigatingStopId(stop.id);
      try {
        const res = await fetch("/api/tesla/navigate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, stopId: stop.id }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && data.ok === true) {
          toast.success("Sent to Tesla — starting navigation");
        } else {
          toast.error(data.error ?? "Failed to send to Tesla");
        }
      } catch (e) {
        toast.error((e as Error).message || "Failed to send to Tesla");
      } finally {
        setNavigatingStopId(null);
      }
    },
    [slug],
  );

  // Precompute fork labels in sort order: core stops number 1,2,3…; optional
  // stops hang off the preceding core stop as "3a", "3b".
  const labeledStops = useMemo<LabeledStop[]>(() => {
    if (!drive) return [];
    let coreN = 0;
    let optLetter = 0;
    return drive.stops.map((stop) => {
      let label: string;
      if (!stop.isOptional) {
        coreN += 1;
        optLetter = 0;
        label = String(coreN);
      } else if (coreN === 0) {
        label = "•";
      } else {
        label = `${coreN}${String.fromCharCode(97 + optLetter)}`;
        optLetter += 1;
      }
      return { ...stop, label };
    });
  }, [drive]);

  const optionalCount = useMemo(
    () => labeledStops.filter((s) => s.isOptional).length,
    [labeledStops],
  );

  // Stops currently shown (optional detours honor the toggle).
  const shownStops = useMemo(
    () => (showOptional ? labeledStops : labeledStops.filter((s) => !s.isOptional)),
    [labeledStops, showOptional],
  );

  // Progress over the SHOWN stops only, so hiding detours doesn't skew it.
  const progress = useMemo(() => {
    const total = shownStops.length;
    const done = shownStops.filter((s) => s.visited).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [shownStops]);

  const mapStops = useMemo<RouteMapStop[]>(
    () =>
      shownStops
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({
          id: s.id,
          label: s.label,
          lat: s.latitude as number,
          lng: s.longitude as number,
          isOptional: s.isOptional,
          visited: s.visited,
        })),
    [shownStops],
  );

  const backLink = (
    <Button variant="ghost" size="sm" render={<a href="/admin/shopping/drives" />}>
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back to drives
    </Button>
  );

  if (error) {
    const isAuth = error === "unauthorized";
    const isMissing = error === "not-found";
    return (
      <div className="space-y-4">
        {backLink}
        <Alert variant="destructive">
          {isAuth ? <ShieldAlert className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertTitle>
            {isAuth ? "Admin sign-in required" : isMissing ? "Drive not found" : "Failed to load drive"}
          </AlertTitle>
          <AlertDescription>
            {isAuth
              ? "Sign in to the admin portal to view this drive."
              : isMissing
                ? "No drive exists at this slug — it may have been deleted."
                : error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!drive) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  let lastLeg: string | null = null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {backLink}

      <header className="mt-3">
        <h1 className="text-3xl font-bold tracking-tight">{drive.title}</h1>
        {drive.description ? (
          <p className="mt-2 text-muted-foreground">{drive.description}</p>
        ) : null}
      </header>

      {/* Progress */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between text-sm text-muted-foreground">
          <span>
            <span className="font-bold text-foreground">{progress.done}</span> of {progress.total}{" "}
            visited
          </span>
          <span className="font-bold text-foreground">{progress.pct}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </div>

        {optionalCount > 0 ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <label
              htmlFor="show-optional"
              className="text-sm font-medium text-muted-foreground"
            >
              Show optional stops ({optionalCount})
            </label>
            <Switch id="show-optional" checked={showOptional} onCheckedChange={setShowOptional} />
          </div>
        ) : null}

        <p className="mt-2 text-xs text-muted-foreground">
          Tap a stop's circle to mark it visited, tap an address for phone-browser directions, or tap
          Tesla to start navigation in the car. Toggle optional stops to fold detours in or out.
        </p>
      </section>

      {/* Route map */}
      <section className="mt-5">
        <DriveRouteMap stops={mapStops} />
      </section>

      {/* Route */}
      <div className="mt-6">
        {shownStops.map((stop) => {
          const showLeg = stop.leg && stop.leg !== lastLeg;
          if (stop.leg) lastLeg = stop.leg;
          const showTesla = teslaConfigured;
          const hasNav = Boolean(stop.address);

          return (
            <div key={stop.id} className={cn(stop.isOptional && "ml-10")}>
              {showLeg ? (
                <div className="mb-3 mt-8 flex items-baseline gap-3">
                  <span className="text-sm italic text-primary">Leg</span>
                  <span className="text-sm font-bold uppercase tracking-widest">{stop.leg}</span>
                  {stop.legWindow ? (
                    <span className="ml-auto text-sm text-muted-foreground">{stop.legWindow}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="mb-3 grid grid-cols-[3.5rem_1fr] gap-3">
                {/* Node — tap to mark visited. Optional stops branch off with a
                    short connector + a smaller dashed node showing the letter. */}
                <div className="relative flex justify-center pt-1">
                  {stop.isOptional ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-6 h-0.5 w-4 -translate-x-full bg-primary/30"
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={stop.visited}
                    aria-label={`Mark ${stop.name} visited`}
                    onClick={() => toggleVisited(stop)}
                    className={cn(
                      "flex items-center justify-center rounded-full border-2 font-extrabold transition-transform active:scale-90",
                      stop.isOptional ? "size-11 text-base" : "size-14 text-lg",
                      stop.visited
                        ? "border-primary bg-primary text-primary-foreground"
                        : stop.isOptional
                          ? "border-dashed border-primary/60 bg-card text-primary"
                          : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {stop.visited ? (
                      <Check className="size-6" strokeWidth={3} />
                    ) : stop.label !== "•" ? (
                      stop.label
                    ) : (
                      <Diamond className="size-5" />
                    )}
                  </button>
                </div>

                {/* Stop card */}
                <Card className={cn("gap-0 py-0", stop.isOptional && "bg-muted/40", stop.visited && "opacity-60")}>
                  <CardContent className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {stop.pick ? (
                          <p className="text-xs font-bold uppercase tracking-wide text-primary">
                            {stop.pick}
                          </p>
                        ) : null}
                        <h2
                          className={cn(
                            "text-xl font-bold leading-tight",
                            stop.visited && "line-through decoration-muted-foreground",
                          )}
                        >
                          {stop.name}
                        </h2>
                      </div>
                      {stop.city ? (
                        <Badge variant="outline" className="shrink-0 text-primary">
                          {stop.city}
                        </Badge>
                      ) : null}
                    </div>

                    {stop.note ? (
                      <p className="mt-2 text-sm text-muted-foreground">{stop.note}</p>
                    ) : null}

                    {stop.hours || stop.phone ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {stop.hours ? <Badge variant="secondary">{stop.hours}</Badge> : null}
                        {stop.phone ? (
                          <a href={`tel:${stop.phone.replace(/[^0-9+]/g, "")}`}>
                            <Badge variant="ghost" className="gap-1.5">
                              <Phone className="size-3.5" />
                              {stop.phone}
                            </Badge>
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {hasNav || showTesla ? (
                      <>
                        <Separator className="my-3" />
                        <div className="flex flex-wrap items-center gap-2">
                          {hasNav ? (
                            <a
                              href={navUrl(stop)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex min-h-14 flex-1 items-center gap-3 rounded-xl bg-muted px-4 text-sm font-semibold transition-colors hover:bg-accent"
                            >
                              <MapPin className="size-5 shrink-0 text-primary" />
                              <span className="flex-1 leading-snug">{stop.address}</span>
                              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-bold text-primary">
                                Navigate
                                <Navigation className="size-4" />
                              </span>
                            </a>
                          ) : null}
                          {showTesla ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={navigatingStopId === stop.id}
                              onClick={() => sendToTesla(stop)}
                            >
                              {navigatingStopId === stop.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <TeslaIcon className="size-4" />
                              )}
                              Tesla
                            </Button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          );
        })}
      </div>

      {drive.notes.length > 0 ? (
        <footer className="mt-8 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <StickyNote className="size-4" />
            Notes
          </h2>
          {drive.notes.map((note, i) => (
            <Card key={i} className="w-full py-0">
              <CardContent className="whitespace-pre-line px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                {note}
              </CardContent>
            </Card>
          ))}
        </footer>
      ) : null}
    </div>
  );
}

export default DriveViewportApp;
