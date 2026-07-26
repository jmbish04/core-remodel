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
  ChevronDown,
  Diamond,
  Info,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Power,
  Sparkles,
  Star,
  ShieldAlert,
  SkipForward,
  StickyNote,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  showroomStoreId: number | null;
  isOptional: boolean;
  visited: boolean;
  skipped: boolean;
};

/** A note on the drive — drive-global (stopId null) or pinned to a stop. */
type DriveNote = {
  id: number;
  driveListStopId: number | null;
  body: string;
  source: "user" | "ai";
  readAt: string | number | null;
};

type DriveNotes = { drive: DriveNote[]; byStop: Record<number, DriveNote[]> };

/** Per-stop live timing from GET /:slug/plan. */
type StopTiming = {
  stopId: number;
  etaLocal: string | null;
  stayMinutes: number | null;
  feasible: boolean | null;
  reason: string | null;
  closesAt: string | null;
};

/** Condensed showroom detail (subset of GET /api/showroom-stores/:id). */
type ShowroomDetail = {
  id: number;
  name: string;
  phoneNumber: string | null;
  heroImageCfImagesUrl: string | null;
  description: string | null;
  pricePoint: string | null;
  cityName: string | null;
  websiteUrl: string | null;
  brands: { id: number; name: string; images?: { deliveryUrl?: string | null }[] }[];
  products: { id: number; name: string }[];
  hours: { day: string; openHour: number; openMinute: number; closeHour: number; closeMinute: number }[];
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
  isActive: boolean;
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

/** Clickable 1–5 star row. Read-only when `onPick` is omitted. */
function StarRow({
  value,
  onPick,
  size = "size-6",
}: {
  value: number;
  onPick?: (n: number) => void;
  size?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onPick}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onPick?.(n)}
          className={cn("transition-transform", onPick && "cursor-pointer active:scale-90")}
        >
          <Star
            className={cn(size, n <= value ? "fill-primary text-primary" : "text-muted-foreground/40")}
          />
        </button>
      ))}
    </div>
  );
}

/** Notes as collapsible alerts — collapsed shows the title + first line only. */
function NoteAlerts({
  notes,
  onToggleRead,
  onDelete,
}: {
  notes: DriveNote[];
  onToggleRead: (n: DriveNote) => void;
  onDelete: (n: DriveNote) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-2">
      {notes.map((n) => {
        const collapsed = n.readAt != null;
        const Icon = n.source === "ai" ? Sparkles : StickyNote;
        const firstLine = n.body.split("\n")[0];
        return (
          <Alert key={n.id} variant="info" className="relative pr-16">
            <Icon />
            <button
              type="button"
              onClick={() => onToggleRead(n)}
              className="col-start-2 block w-full text-left"
            >
              <AlertTitle className="flex items-center gap-2">
                {n.source === "ai" ? "AI follow-up" : "Note"}
                {collapsed ? (
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    — {firstLine}
                  </span>
                ) : null}
              </AlertTitle>
              {!collapsed ? (
                <AlertDescription className="whitespace-pre-line text-foreground/90">
                  {n.body}
                </AlertDescription>
              ) : null}
            </button>
            <div className="absolute right-2 top-2 flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => onToggleRead(n)}
                aria-label={collapsed ? "Expand note" : "Mark read (collapse)"}
              >
                {collapsed ? <ChevronDown className="size-4" /> : <Check className="size-4" />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground"
                onClick={() => onDelete(n)}
                aria-label="Delete note"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </Alert>
        );
      })}
    </div>
  );
}

/** Inline "+ Note" composer — a button that expands into a one-line input. */
function NoteComposer({ onAdd, placeholder }: { onAdd: (body: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" /> Note
      </Button>
    );
  }
  const submit = () => {
    onAdd(text);
    setText("");
    setOpen(false);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="min-h-10 flex-1 rounded-lg bg-muted px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
      />
      <Button type="button" size="sm" onClick={submit} disabled={!text.trim()}>
        Add
      </Button>
    </div>
  );
}

export function DriveViewportApp({ slug }: { slug: string }) {
  const [drive, setDrive] = useState<Drive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(true);
  const [teslaConfigured, setTeslaConfigured] = useState(false);
  const [navigatingStopId, setNavigatingStopId] = useState<number | null>(null);
  // Notes (drive-global + per-stop), the rating modal, and the skip confirmation.
  const [notes, setNotes] = useState<DriveNotes>({ drive: [], byStop: {} });
  // Live per-stop timing keyed by stopId (ETA / stay / won't-make-it).
  const [timing, setTiming] = useState<Record<number, StopTiming>>({});
  const [ratingStop, setRatingStop] = useState<Stop | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingText, setRatingText] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState<Stop | null>(null);
  // Fullscreen showroom detail modal (linked stops only).
  const [detailStop, setDetailStop] = useState<Stop | null>(null);
  const [detailData, setDetailData] = useState<ShowroomDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // THE active drive (if any) — used to name the drive a switch would deactivate.
  const [activeOther, setActiveOther] = useState<{ slug: string; title: string } | null>(null);
  const [activating, setActivating] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  const refreshActive = useCallback(async () => {
    try {
      const res = await fetch("/api/drive-lists/active", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { active: { slug: string; title: string } | null };
      setActiveOther(data.active);
    } catch {
      /* leave as-is */
    }
  }, []);

  useEffect(() => {
    void refreshActive();
  }, [refreshActive]);

  const loadTiming = useCallback(async () => {
    try {
      const res = await fetch(`/api/drive-lists/${encodeURIComponent(slug)}/plan`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { stops: StopTiming[] };
      setTiming(Object.fromEntries((data.stops ?? []).map((t) => [t.stopId, t])));
    } catch {
      /* leave timing as-is */
    }
  }, [slug]);

  /** PATCH this drive's active state; handles the 07:00–20:00 window 409. */
  const applyActive = useCallback(
    async (next: boolean) => {
      setActivating(true);
      try {
        // On activation, capture the device's location so start timing anchors
        // on where the driver actually is. Best-effort — server falls back to
        // the Tesla's GPS, then to relative-from-first-stop.
        let coords: { startLatitude: number; startLongitude: number } | null = null;
        if (next && typeof navigator !== "undefined" && navigator.geolocation) {
          coords = await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (p) => resolve({ startLatitude: p.coords.latitude, startLongitude: p.coords.longitude }),
              () => resolve(null),
              { timeout: 4000, maximumAge: 60_000 },
            );
          });
        }
        const res = await fetch(`/api/drive-lists/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive: next, ...(coords ?? {}) }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.status === 409) {
          toast.error(data.error ?? "A drive can only be made active between 07:00 and 20:00 Pacific.");
          return;
        }
        if (!res.ok || data.ok !== true) {
          toast.error(data.error ?? `Failed to update (${res.status})`);
          return;
        }
        setDrive((prev) => (prev ? { ...prev, isActive: next } : prev));
        // Activating clears any other active drive (single-active invariant),
        // and re-anchors the live timing on the new start.
        await refreshActive();
        await loadTiming();
        toast.success(next ? "This drive is now the active drive" : "Drive marked inactive");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setActivating(false);
      }
    },
    [slug, refreshActive, loadTiming],
  );

  const onActivateClick = useCallback(() => {
    if (drive?.isActive) {
      void applyActive(false);
      return;
    }
    // Another drive is active → confirm the switch (it will be deactivated).
    if (activeOther && activeOther.slug !== slug) {
      setConfirmSwitch(true);
      return;
    }
    void applyActive(true);
  }, [drive?.isActive, activeOther, slug, applyActive]);

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

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/drive-lists/${encodeURIComponent(slug)}/notes`, {
        credentials: "include",
      });
      if (!res.ok) return;
      setNotes((await res.json()) as DriveNotes);
    } catch {
      /* leave notes as-is */
    }
  }, [slug]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    void loadTiming();
  }, [loadTiming]);

  const addNote = useCallback(
    async (body: string, stopId: number | null) => {
      const text = body.trim();
      if (!text) return;
      try {
        const res = await fetch(`/api/drive-lists/${encodeURIComponent(slug)}/notes`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text, stopId }),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        await loadNotes();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [slug, loadNotes],
  );

  const toggleNoteRead = useCallback(
    async (note: DriveNote) => {
      const read = note.readAt == null; // toggle to the opposite state
      // Optimistic: flip readAt locally so the alert collapses/expands instantly.
      setNotes((prev) => {
        const flip = (n: DriveNote): DriveNote =>
          n.id === note.id ? { ...n, readAt: read ? Date.now() : null } : n;
        return {
          drive: prev.drive.map(flip),
          byStop: Object.fromEntries(Object.entries(prev.byStop).map(([k, v]) => [k, v.map(flip)])),
        };
      });
      try {
        await fetch(`/api/drive-lists/${encodeURIComponent(slug)}/notes/${note.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read }),
        });
      } catch {
        void loadNotes(); // resync on failure
      }
    },
    [slug, loadNotes],
  );

  const deleteNote = useCallback(
    async (note: DriveNote) => {
      try {
        await fetch(`/api/drive-lists/${encodeURIComponent(slug)}/notes/${note.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        await loadNotes();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [slug, loadNotes],
  );

  const openRating = useCallback((stop: Stop) => {
    setRatingStop(stop);
    setRatingValue(0);
    setRatingText("");
  }, []);

  const openDetail = useCallback(async (stop: Stop) => {
    if (stop.showroomStoreId == null) return;
    setDetailStop(stop);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/showroom-stores/${stop.showroomStoreId}`, {
        credentials: "include",
      });
      if (res.ok) setDetailData((await res.json()) as ShowroomDetail);
    } catch {
      /* leave null — modal shows an error state */
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const submitRating = useCallback(
    async (defer: boolean) => {
      if (!ratingStop || ratingValue < 1) return;
      setRatingBusy(true);
      try {
        const res = await fetch(
          `/api/drive-lists/${encodeURIComponent(slug)}/stops/${ratingStop.id}/rating`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rating: ratingValue,
              contextMarkdown: ratingText.trim() || undefined,
              deferFeedback: defer,
            }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok !== true) {
          toast.error(data.error ?? `Failed to rate (${res.status})`);
          return;
        }
        toast.success(
          defer ? "Rated — AI will follow up on feedback later" : `Rated ${ratingValue}★`,
        );
        setRatingStop(null);
        if (defer) await loadNotes();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setRatingBusy(false);
      }
    },
    [slug, ratingStop, ratingValue, ratingText, loadNotes],
  );

  const setSkipped = useCallback(
    async (stop: Stop, skipped: boolean) => {
      setDrive((prev) =>
        prev
          ? { ...prev, stops: prev.stops.map((s) => (s.id === stop.id ? { ...s, skipped } : s)) }
          : prev,
      );
      try {
        const res = await fetch(
          `/api/drive-lists/${encodeURIComponent(slug)}/stops/${stop.id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skipped }),
          },
        );
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
      } catch (e) {
        setDrive((prev) =>
          prev
            ? { ...prev, stops: prev.stops.map((s) => (s.id === stop.id ? { ...s, skipped: !skipped } : s)) }
            : prev,
        );
        toast.error((e as Error).message);
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

        {/* Active-drive control — the single most important state on this page.
            Only one drive can be active; switching from another asks first. */}
        <div className="mt-4">
          {drive.isActive ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-primary/15 px-4 py-3 ring-1 ring-inset ring-primary/40">
              <Zap className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="flex-1 text-sm font-bold text-primary">This drive is active</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={activating}
                onClick={onActivateClick}
                className="text-muted-foreground"
              >
                {activating ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                Make inactive
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={activating}
              onClick={onActivateClick}
              className="min-h-14 w-full text-base font-bold"
            >
              {activating ? <Loader2 className="size-5 animate-spin" /> : <Zap className="size-5" />}
              Make this the active drive
            </Button>
          )}
        </div>
      </header>

      {/* Confirm switching the active drive away from another one. */}
      <AlertDialog open={confirmSwitch} onOpenChange={setConfirmSwitch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch the active drive?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeOther ? (
                <>
                  Making <span className="font-semibold text-foreground">{drive.title}</span> active
                  will mark{" "}
                  <span className="font-semibold text-foreground">{activeOther.title}</span> as
                  inactive. Only one drive can be active at a time.
                </>
              ) : (
                "Only one drive can be active at a time."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSwitch(false);
                void applyActive(true);
              }}
            >
              Yes, make this active
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <Card
                  className={cn(
                    "gap-0 py-0",
                    stop.isOptional && "bg-muted/40",
                    stop.visited && "opacity-60",
                    stop.skipped && "opacity-50",
                  )}
                >
                  <CardContent className="px-5 py-4">
                    {stop.skipped ? (
                      /* Skipped — minimized + struck, with an Unskip control. */
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-semibold text-muted-foreground line-through decoration-muted-foreground">
                            {stop.name}
                          </h2>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Skipped</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="shrink-0 text-primary"
                          onClick={() => setSkipped(stop, false)}
                        >
                          <Undo2 className="size-4" /> Unskip
                        </Button>
                      </div>
                    ) : (
                      <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {stop.pick ? (
                          <p className="text-xs font-bold uppercase tracking-wide text-primary">
                            {stop.pick}
                          </p>
                        ) : null}
                        {stop.showroomStoreId != null ? (
                          <button
                            type="button"
                            onClick={() => void openDetail(stop)}
                            className="group/name text-left"
                          >
                            <h2
                              className={cn(
                                "text-xl font-bold leading-tight underline-offset-4 group-hover/name:underline",
                                stop.visited && "line-through decoration-muted-foreground",
                              )}
                            >
                              {stop.name}
                              <Info
                                className="ml-1.5 inline size-4 align-middle text-muted-foreground"
                                aria-hidden
                              />
                            </h2>
                          </button>
                        ) : (
                          <h2
                            className={cn(
                              "text-xl font-bold leading-tight",
                              stop.visited && "line-through decoration-muted-foreground",
                            )}
                          >
                            {stop.name}
                          </h2>
                        )}
                      </div>
                      {stop.city ? (
                        <Badge variant="outline" className="shrink-0 text-primary">
                          {stop.city}
                        </Badge>
                      ) : null}
                    </div>

                    {/* Rating — linked stops only. Tapping a star opens the modal. */}
                    {stop.showroomStoreId != null ? (
                      <div className="mt-3">
                        <StarRow
                          value={0}
                          onPick={(n) => {
                            setRatingStop(stop);
                            setRatingValue(n);
                            setRatingText("");
                          }}
                        />
                      </div>
                    ) : null}

                    {/* Live timing chip — ETA + suggested stay, or won't-make-it. */}
                    {timing[stop.id] && timing[stop.id].etaLocal ? (
                      (() => {
                        const t = timing[stop.id];
                        const bad = t.feasible === false;
                        return (
                          <div
                            className={cn(
                              "mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 text-sm font-semibold",
                              bad
                                ? "bg-destructive/15 text-destructive"
                                : "bg-secondary text-secondary-foreground",
                            )}
                          >
                            <span>
                              {bad ? "⚠ " : ""}
                              ETA {t.etaLocal}
                            </span>
                            {bad ? (
                              <span>· {t.reason}</span>
                            ) : t.stayMinutes != null ? (
                              <span className="text-muted-foreground">
                                · stay ~{t.stayMinutes} min
                                {t.reason ? ` · ${t.reason}` : ""}
                              </span>
                            ) : null}
                          </div>
                        );
                      })()
                    ) : null}

                    {stop.note ? (
                      <p className="mt-2 text-sm text-muted-foreground">{stop.note}</p>
                    ) : null}

                    {stop.hours || stop.phone ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {stop.hours ? (
                          <span className="inline-flex min-h-12 items-center rounded-lg bg-secondary px-3.5 text-base font-semibold text-secondary-foreground">
                            {stop.hours}
                          </span>
                        ) : null}
                        {stop.phone ? (
                          <a
                            href={`tel:${stop.phone.replace(/[^0-9+]/g, "")}`}
                            className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-muted px-4 text-base font-semibold text-foreground transition-colors hover:bg-accent active:scale-[0.98]"
                          >
                            <Phone className="size-5 text-primary" />
                            {stop.phone}
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {hasNav || showTesla ? (
                      <>
                        <Separator className="my-3" />
                        {/* Address + Navigate + Tesla share one rounded bg-muted
                            container; the Tesla control matches the Navigate bar's
                            height so both read as one control strip. */}
                        <div className="flex items-stretch overflow-hidden rounded-xl bg-muted">
                          {hasNav ? (
                            <a
                              href={navUrl(stop)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex min-h-14 flex-1 items-center gap-3 px-4 text-sm font-semibold transition-colors hover:bg-accent"
                            >
                              <MapPin className="size-5 shrink-0 text-primary" />
                              <span className="flex-1 leading-snug">{stop.address}</span>
                              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-bold text-primary">
                                Navigate
                                <Navigation className="size-4" />
                              </span>
                            </a>
                          ) : null}
                          {hasNav && showTesla ? (
                            <span aria-hidden className="my-2 w-px shrink-0 bg-border" />
                          ) : null}
                          {showTesla ? (
                            <button
                              type="button"
                              disabled={navigatingStopId === stop.id}
                              onClick={() => sendToTesla(stop)}
                              className={cn(
                                "flex min-h-14 shrink-0 items-center gap-2 px-5 text-sm font-bold text-primary transition-colors hover:bg-accent active:scale-[0.98] disabled:opacity-60",
                                !hasNav && "flex-1 justify-center",
                              )}
                            >
                              {navigatingStopId === stop.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <TeslaIcon className="size-4" />
                              )}
                              Tesla
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}

                    {/* Per-stop notes as collapsible alerts */}
                    {(notes.byStop[stop.id]?.length ?? 0) > 0 ? (
                      <div className="mt-3">
                        <NoteAlerts
                          notes={notes.byStop[stop.id] ?? []}
                          onToggleRead={toggleNoteRead}
                          onDelete={deleteNote}
                        />
                      </div>
                    ) : null}

                    {/* Card actions: add a note, or skip this stop */}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <NoteComposer
                        onAdd={(b) => addNote(b, stop.id)}
                        placeholder="Note for this stop"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setSkipConfirm(stop)}
                      >
                        <SkipForward className="size-4" /> Skip
                      </Button>
                    </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="mt-8 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <StickyNote className="size-4" />
            General notes
          </h2>
          <NoteComposer onAdd={(b) => addNote(b, null)} placeholder="Add a general note" />
        </div>
        <NoteAlerts notes={notes.drive} onToggleRead={toggleNoteRead} onDelete={deleteNote} />
        {notes.drive.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No general notes yet — per-location notes live on each stop above.
          </p>
        ) : null}
      </footer>

      {/* Rating modal — big stars, optional feedback, or defer to an AI note. */}
      <Dialog open={ratingStop !== null} onOpenChange={(o) => !o && setRatingStop(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rate {ratingStop?.name}</DialogTitle>
            <DialogDescription>
              Confirm or change your rating. Feedback is optional — or let AI follow up later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-5 py-2">
            <StarRow value={ratingValue} onPick={setRatingValue} size="size-11" />
            <Textarea
              value={ratingText}
              onChange={(e) => setRatingText(e.target.value)}
              placeholder="Optional feedback — what stood out, what to remember…"
              className="min-h-24 w-full"
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              size="lg"
              className="min-h-12 w-full"
              disabled={ratingValue < 1 || ratingBusy}
              onClick={() => void submitRating(false)}
            >
              {ratingBusy ? <Loader2 className="size-5 animate-spin" /> : <Star className="size-5" />}
              Save rating
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="min-h-12 w-full"
              disabled={ratingValue < 1 || ratingBusy}
              onClick={() => void submitRating(true)}
            >
              <Sparkles className="size-5" />
              AI: follow up with feedback later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fullscreen showroom detail — condensed card for the linked showroom. */}
      <Dialog
        open={detailStop !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDetailStop(null);
            setDetailData(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailData?.name ?? detailStop?.name}</DialogTitle>
            <DialogDescription>
              {[detailData?.cityName ?? detailStop?.city, detailData?.pricePoint]
                .filter(Boolean)
                .join(" · ") || "Showroom details"}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : detailData ? (
            <div className="space-y-4">
              {detailData.heroImageCfImagesUrl ? (
                <img
                  src={detailData.heroImageCfImagesUrl}
                  alt={detailData.name}
                  loading="lazy"
                  className="max-h-56 w-full rounded-lg object-cover"
                />
              ) : null}
              {detailData.description ? (
                <p className="text-sm text-muted-foreground">{detailData.description}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {detailData.phoneNumber ? (
                  <a
                    href={`tel:${detailData.phoneNumber.replace(/[^0-9+]/g, "")}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-muted px-4 text-sm font-semibold transition-colors hover:bg-accent"
                  >
                    <Phone className="size-4 text-primary" /> {detailData.phoneNumber}
                  </a>
                ) : null}
                {detailStop?.address ? (
                  <a
                    href={navUrl(detailStop)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-muted px-4 text-sm font-semibold text-primary transition-colors hover:bg-accent"
                  >
                    <Navigation className="size-4" /> Navigate
                  </a>
                ) : null}
                {detailStop ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => {
                      const s = detailStop;
                      setDetailStop(null);
                      setDetailData(null);
                      if (s) {
                        setRatingStop(s);
                        setRatingValue(0);
                        setRatingText("");
                      }
                    }}
                  >
                    <Star className="size-4" /> Rate
                  </Button>
                ) : null}
              </div>
              {detailData.brands?.length ? (
                <div>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Brands
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detailData.brands.slice(0, 40).map((b) => (
                      <Badge key={b.id} variant="secondary">
                        {b.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {detailData.products?.length ? (
                <div>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Products ({detailData.products.length})
                  </p>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {detailData.products.slice(0, 25).map((p) => (
                      <li key={p.id}>• {p.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Couldn't load showroom details.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Skip confirmation */}
      <AlertDialog open={skipConfirm !== null} onOpenChange={(o) => !o && setSkipConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this stop?</AlertDialogTitle>
            <AlertDialogDescription>
              {skipConfirm?.name} will be minimized and crossed out. You can unskip it anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const s = skipConfirm;
                setSkipConfirm(null);
                if (s) void setSkipped(s, true);
              }}
            >
              Yes, skip it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default DriveViewportApp;
