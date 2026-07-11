/**
 * @fileoverview Showroom Drive viewport island.
 *
 * Renders one drive sheet from D1 (`GET /api/drive-lists/:slug`): stops grouped
 * by leg/city, each with details and a tap-to-navigate address (a Google Maps
 * directions URL the Tesla browser hands off to Navigate). Tapping a stop's node
 * toggles its visited check-off, persisted via `PATCH …/stops/:id` so progress
 * survives across devices (unlike the client-only artifact prototype).
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
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

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

type Drive = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  notes: string | null;
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

export function DriveViewportApp({ slug }: { slug: string }) {
  const [drive, setDrive] = useState<Drive | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const progress = useMemo(() => {
    if (!drive) return { total: 0, done: 0, pct: 0 };
    const total = drive.stops.length;
    const done = drive.stops.filter((s) => s.visited).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [drive]);

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

  // Number the core (non-optional) stops sequentially as we render.
  let coreN = 0;
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
        <p className="mt-2 text-xs text-muted-foreground">
          Tap an address to hand off to your Tesla's navigation. Tap a stop's circle to mark it
          visited.
        </p>
      </section>

      {/* Route */}
      <div className="mt-6">
        {drive.stops.map((stop) => {
          if (!stop.isOptional) coreN += 1;
          const stopNumber = stop.isOptional ? null : coreN;
          const showLeg = stop.leg && stop.leg !== lastLeg;
          if (stop.leg) lastLeg = stop.leg;

          return (
            <div key={stop.id}>
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
                {/* Node — tap to mark visited */}
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    aria-pressed={stop.visited}
                    aria-label={`Mark ${stop.name} visited`}
                    onClick={() => toggleVisited(stop)}
                    className={cn(
                      "flex items-center justify-center rounded-full border-2 text-lg font-extrabold transition-transform active:scale-90",
                      stop.isOptional ? "size-11" : "size-14",
                      stop.visited
                        ? "border-primary bg-primary text-primary-foreground"
                        : stop.isOptional
                          ? "border-dashed border-primary/60 bg-card text-primary"
                          : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {stop.visited ? (
                      <Check className="size-6" strokeWidth={3} />
                    ) : stopNumber !== null ? (
                      stopNumber
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

                    {stop.address ? (
                      <>
                        <Separator className="my-3" />
                        <a
                          href={navUrl(stop)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-14 items-center gap-3 rounded-xl bg-muted px-4 text-sm font-semibold transition-colors hover:bg-accent"
                        >
                          <MapPin className="size-5 shrink-0 text-primary" />
                          <span className="flex-1 leading-snug">{stop.address}</span>
                          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-bold text-primary">
                            Navigate
                            <Navigation className="size-4" />
                          </span>
                        </a>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          );
        })}
      </div>

      {drive.notes ? (
        <footer className="mt-8 text-sm leading-relaxed text-muted-foreground">{drive.notes}</footer>
      ) : null}
    </div>
  );
}

export default DriveViewportApp;
