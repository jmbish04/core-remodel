/**
 * @fileoverview ManageShowroomsModal — bulk "backfill" flow for showrooms that
 * are missing Google-sourced fields (address, phone, hours, rating, photos, …).
 *
 * Three steps, all inside one controlled Base UI `<Dialog>`:
 *
 *   1. SELECT   — list every incomplete showroom (`GET /meta/incomplete`) with a
 *                 checkbox + a Badge per missing field. Select all / clear /
 *                 count. Continue (≥1 selected) → step 2.
 *   2. RESOLVE  — confirm/repair the Google Places match for each selected row
 *                 (`POST /backfill/resolve`). Rows that Google couldn't match
 *                 must be fixed via an inline Places autocomplete before submit.
 *   3. SUBMIT   — for each finally-chosen placeId, pull Place Details
 *                 (`skipAi=1`), run `mapPlaceToIntake`, and POST the derived
 *                 fill-blanks payload (`POST /backfill/submit`). Shows progress,
 *                 toasts the queued count + any skips, then refreshes the parent.
 *
 * Fill-blanks semantics are enforced by the backend — the UI only shows what's
 * missing and what will be filled; existing data is never overwritten.
 *
 * Base UI note: this repo's shadcn Dialog wraps @base-ui (NOT Radix). There are
 * no `onEscapeKeyDown` / `onInteractOutside` props — close is blocked while a
 * request is in-flight via the controlled `onOpenChange` guard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Search,
  Settings2,
  Star,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  mapPlaceToIntake,
  type GooglePlaceDetails,
  type GooglePlacePhoto,
} from "./intake/places-mapper";
import type { HoursJson } from "./intake/hours-types";

/**
 * UUID with a fallback for non-secure contexts. `crypto.randomUUID()` only
 * exists over HTTPS/localhost, so it throws when the app is opened over plain
 * HTTP (e.g. on a phone via the LAN IP during testing). This never throws.
 */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Wire types (mirror the backend endpoints verbatim) ───────────────────────

/** One entry of `GET /api/showroom-stores/meta/incomplete`. */
interface IncompleteShowroom {
  id: number;
  name: string;
  locationAddress: string | null;
  placeId: string | null;
  heroImageCfImagesUrl: string | null;
  missing: Array<{ key: string; label: string }>;
}

/** A Google Places match card as returned by resolve / rebuilt on edit. */
interface PlaceCard {
  placeId: string;
  displayName: string | null;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  phoneNumber: string | null;
  websiteUri: string | null;
}

type ResolveSource = "existing" | "matched" | "not_found" | "error";

/** One entry of `POST /api/showroom-stores/backfill/resolve`. */
interface ResolveResult {
  showroomId: number;
  name: string;
  currentPlaceId: string | null;
  source: ResolveSource;
  card: PlaceCard | null;
  error: string | null;
}

/** The fill-blanks field subset derived from Place Details via the mapper. */
interface BackfillFields {
  locationAddress?: string;
  phoneNumber?: string;
  websiteUrl?: string;
  googleRating?: number;
  userRatingCount?: number;
  reviewSummary?: string;
  pricePoint?: "$" | "$$" | "$$$" | "$$$$";
  hoursJson?: HoursJson;
  photos?: GooglePlacePhoto[];
}

/** Response of `POST /api/showroom-stores/backfill/submit`. */
interface SubmitResponse {
  updated: number;
  queued: number;
  skipped: Array<{ showroomId: number; reason: string }>;
}

/** Per-row working state in step 2/3: the currently-chosen place + card. */
interface RowState extends ResolveResult {
  /** The placeId the user will submit with — starts as currentPlaceId/matched. */
  chosenPlaceId: string | null;
  /** Whether the inline Places edit search is open for this row. */
  editing: boolean;
}

type Step = "select" | "resolve" | "submit";

// ─── Fetch helpers (mirror ShowroomsDirectoryApp's `api<T>()`) ────────────────

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 429) {
    throw new Error("Google Maps monthly quota reached. Try again later.");
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    throw new Error("Google Maps monthly quota reached. Try again later.");
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── Inline Places autocomplete (edit search) ─────────────────────────────────

/**
 * Compact Google Places (New) autocomplete typeahead used inline in step 2 to
 * repair a bad/missing match. Mirrors `ShowroomNameSearch` from
 * ShowroomsDirectoryApp: a debounced (~300ms) `GET /api/places/autocomplete`
 * dropdown that hands a `placeId` back on select. Holds ONE session token per
 * edit session (shared with the terminal details call by the parent) so the
 * autocomplete + details bill as one Google session.
 */
function PlaceEditSearch({
  sessionTokenRef,
  onSelect,
  disabled,
}: {
  sessionTokenRef: React.MutableRefObject<string>;
  onSelect: (placeId: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ placeId: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const runSearch = useCallback(
    async (text: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const url = `/api/places/autocomplete?q=${encodeURIComponent(text)}&sessionToken=${sessionTokenRef.current}`;
        const res = await fetch(url, { credentials: "include", signal: controller.signal });
        if (res.status === 429) {
          toast.error("Google Maps monthly quota reached. Try again later.");
          setSuggestions([]);
          return;
        }
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Autocomplete failed (${res.status})`);
        }
        const data = (await res.json()) as {
          suggestions?: { placeId: string; text: string }[];
        };
        setSuggestions(data.suggestions ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[manage/autocomplete]", err);
        toast.error(err instanceof Error ? err.message : "Autocomplete failed");
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionTokenRef],
  );

  const handleChange = (next: string) => {
    setValue(next);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = next.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(trimmed), 300);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        placeholder="Search Google for the correct place…"
        className="pl-9"
        aria-label="Search Google Places to repair this match"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/40">
          {loading && suggestions.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {value.trim().length < 2
                ? "Type at least 2 characters to search Google."
                : "No matches found."}
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setSuggestions([]);
                      setValue("");
                      onSelect(s.placeId);
                    }}
                    className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2">{s.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Place card (step 2 display) ──────────────────────────────────────────────

function ResolveTag({ source }: { source: ResolveSource }) {
  if (source === "existing") {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <CheckCircle2 className="size-3" /> Already linked
      </Badge>
    );
  }
  if (source === "matched") {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-[10px] text-emerald-300 ring-1 ring-emerald-500/30">
        <CheckCircle2 className="size-3" /> Matched
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1 text-[10px]">
      <AlertTriangle className="size-3" /> No match
    </Badge>
  );
}

function PlaceCardView({ card }: { card: PlaceCard }) {
  return (
    <div className="rounded-lg bg-muted/30 p-2.5 ring-1 ring-border/40">
      <p className="truncate text-sm font-medium text-foreground">
        {card.displayName ?? "Unnamed place"}
      </p>
      {card.formattedAddress && (
        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-muted-foreground">
          <MapPin className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2">{card.formattedAddress}</span>
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {card.rating !== null && (
          <span className="flex items-center gap-1 text-amber-300">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            {card.rating.toFixed(1)}
            {card.userRatingCount !== null && (
              <span className="text-muted-foreground">({card.userRatingCount})</span>
            )}
          </span>
        )}
        {card.phoneNumber && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Phone className="size-3" />
            {card.phoneNumber}
          </span>
        )}
        {card.websiteUri && (
          <span className="flex items-center gap-1 truncate text-muted-foreground">
            <Globe className="size-3 shrink-0" />
            <span className="truncate">{card.websiteUri.replace(/^https?:\/\//, "")}</span>
          </span>
        )}
      </div>
      <p className="mt-1.5 font-mono text-[9px] text-muted-foreground/60">{card.placeId}</p>
    </div>
  );
}

// ─── Step 1: Select ───────────────────────────────────────────────────────────

function SelectRow({
  showroom,
  checked,
  onToggle,
}: {
  showroom: IncompleteShowroom;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-card p-3 ring-1 ring-border/40 transition-colors hover:bg-muted/30">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
        aria-label={`Select ${showroom.name}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{showroom.name}</p>
        {showroom.locationAddress ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {showroom.locationAddress}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] italic text-muted-foreground/60">No address on file</p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {showroom.missing.map((m) =>
            m.key === "place_id" ? (
              <Badge key={m.key} variant="destructive" className="text-[10px]">
                {m.label}
              </Badge>
            ) : (
              <Badge key={m.key} variant="secondary" className="text-[10px] font-normal">
                {m.label}
              </Badge>
            ),
          )}
        </div>
      </div>
    </label>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

/**
 * @param onDone Called after a successful submit so the parent can refetch its
 *   showroom list (wired to `fetchStores` in ShowroomsDirectoryApp). Also fired
 *   is harmless if the parent has no list to refresh.
 */
export function ManageShowroomsModal({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("select");

  // Step 1 state
  const [loadingList, setLoadingList] = useState(false);
  const [incomplete, setIncomplete] = useState<IncompleteShowroom[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Step 2 state
  const [resolving, setResolving] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);

  // Step 3 state
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<SubmitResponse["skipped"]>([]);

  // One Places session token per edit search; regenerated after each successful
  // details fetch (mirrors AddShowroomModal.sessionTokenRef).
  const sessionTokenRef = useRef<string>(generateUUID());

  // Any in-flight request blocks dialog close.
  const busy = loadingList || resolving || submitting;

  const resetAll = useCallback(() => {
    setStep("select");
    setIncomplete([]);
    setSelectedIds(new Set());
    setRows([]);
    setProgress(null);
    setSkipped([]);
  }, []);

  // ── Step 1: load incomplete showrooms on open ──
  const loadIncomplete = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await api<{ showrooms: IncompleteShowroom[] }>(
        "/api/showroom-stores/meta/incomplete",
      );
      setIncomplete(data.showrooms ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load incomplete showrooms");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) {
      toast.info("Hang on — a request is still running…");
      return;
    }
    setOpen(next);
    if (next) {
      resetAll();
      loadIncomplete();
    }
  };

  const toggleId = (id: number) =>
    setSelectedIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });

  const selectAll = () => setSelectedIds(new Set(incomplete.map((s) => s.id)));
  const clearAll = () => setSelectedIds(new Set());

  // ── Step 1 → 2: resolve Places matches ──
  const handleContinue = async () => {
    const showroomIds = [...selectedIds];
    if (showroomIds.length === 0) return;
    setResolving(true);
    try {
      const data = await apiPost<{ results: ResolveResult[] }>(
        "/api/showroom-stores/backfill/resolve",
        { showroomIds },
      );
      setRows(
        (data.results ?? []).map((r) => ({
          ...r,
          // Seed the chosen placeId: the card's id (matched/existing) wins, then
          // any currentPlaceId; not_found/error start unresolved (null).
          chosenPlaceId: r.card?.placeId ?? r.currentPlaceId ?? null,
          editing: r.source === "not_found" || r.source === "error",
        })),
      );
      setStep("resolve");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resolve Places matches");
    } finally {
      setResolving(false);
    }
  };

  // ── Step 2: pick a place from the inline edit search ──
  const handleEditSelect = useCallback(
    async (showroomId: number, placeId: string) => {
      try {
        const url = `/api/places/details/${encodeURIComponent(placeId)}?sessionToken=${sessionTokenRef.current}&skipAi=1`;
        const place = await api<GooglePlaceDetails>(url);
        // Regenerate the session token — this details call closed the session.
        sessionTokenRef.current = generateUUID();
        const card: PlaceCard = {
          placeId: place.id ?? placeId,
          displayName: place.displayName?.text ?? null,
          formattedAddress: place.formattedAddress ?? null,
          rating: typeof place.rating === "number" ? place.rating : null,
          userRatingCount:
            typeof place.userRatingCount === "number" ? place.userRatingCount : null,
          phoneNumber:
            place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
          websiteUri: place.websiteUri ?? null,
        };
        setRows((prev) =>
          prev.map((row) =>
            row.showroomId === showroomId
              ? {
                  ...row,
                  card,
                  chosenPlaceId: card.placeId,
                  source: "matched",
                  error: null,
                  editing: false,
                }
              : row,
          ),
        );
        toast.success("Match updated from Google.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to fetch place details");
      }
    },
    [],
  );

  const setEditing = (showroomId: number, editing: boolean) =>
    setRows((prev) =>
      prev.map((row) => (row.showroomId === showroomId ? { ...row, editing } : row)),
    );

  const allRowsResolved = useMemo(
    () => rows.length > 0 && rows.every((r) => Boolean(r.chosenPlaceId)),
    [rows],
  );

  // ── Step 2 → 3: pull details, map, submit ──
  const handleSubmit = async () => {
    const readyRows = rows.filter((r) => r.chosenPlaceId);
    if (readyRows.length === 0) return;
    setStep("submit");
    setSubmitting(true);
    setSkipped([]);
    setProgress({ done: 0, total: readyRows.length });

    try {
      // Fetch Place Details for all rows in PARALLEL (sequential would take 25s+
      // for a full batch of 50). Each call gets its own session token; progress
      // increments as each resolves.
      let done = 0;
      const items = await Promise.all(
        readyRows.map(async (row) => {
          const placeId = row.chosenPlaceId as string;
          const url = `/api/places/details/${encodeURIComponent(placeId)}?sessionToken=${generateUUID()}&skipAi=1`;
          const place = await api<GooglePlaceDetails>(url);

          const mapped = mapPlaceToIntake(place);
          // Only forward what the mapper actually produced (all optional).
          const fields: BackfillFields = {};
          if (mapped.locationAddress) fields.locationAddress = mapped.locationAddress;
          if (mapped.phoneNumber) fields.phoneNumber = mapped.phoneNumber;
          if (mapped.websiteUrl) fields.websiteUrl = mapped.websiteUrl;
          if (typeof mapped.googleRating === "number") fields.googleRating = mapped.googleRating;
          if (typeof mapped.userRatingCount === "number") {
            fields.userRatingCount = mapped.userRatingCount;
          }
          if (mapped.reviewSummary) fields.reviewSummary = mapped.reviewSummary;
          if (mapped.pricePoint) fields.pricePoint = mapped.pricePoint;
          if (mapped.hoursJson) fields.hoursJson = mapped.hoursJson;
          // Raw Places photo refs (pass-through so the backend queue can upload).
          if (place.photos && place.photos.length > 0) fields.photos = place.photos;

          setProgress({ done: ++done, total: readyRows.length });
          return { showroomId: row.showroomId, placeId, fields };
        }),
      );

      const result = await apiPost<SubmitResponse>(
        "/api/showroom-stores/backfill/submit",
        { items },
      );

      setSkipped(result.skipped ?? []);
      toast.success(
        `Queued ${result.queued} showroom${result.queued === 1 ? "" : "s"} for enrichment — ` +
          "Places data saved; Gemini + scraping running in the background.",
      );
      onDone();

      // Close only when there's nothing to review; otherwise keep the modal open
      // on step 3 so the user can read the skipped-rows report.
      if ((result.skipped ?? []).length === 0) {
        setOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit backfill");
      // Fall back to step 2 so the user can retry.
      setStep("resolve");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  const selectedCount = selectedIds.size;
  const stepLabels: { id: Step; label: string }[] = [
    { id: "select", label: "Select" },
    { id: "resolve", label: "Confirm" },
    { id: "submit", label: "Run" },
  ];

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleOpenChange(true)}>
        <Settings2 className="size-3.5" />
        Manage
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Backfill Showrooms</DialogTitle>
            <DialogDescription>
              Fill missing details for showrooms straight from Google Places. Only blank
              fields are filled — your existing data is never overwritten.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex gap-1">
            {stepLabels.map((s) => (
              <div
                key={s.id}
                className={`flex-1 rounded-sm py-1 text-center text-[10px] font-medium uppercase tracking-wider transition ${
                  step === s.id
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground"
                }`}
              >
                {s.label}
              </div>
            ))}
          </div>

          {/* ── STEP 1: SELECT ── */}
          {step === "select" && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={selectAll}
                    disabled={loadingList || incomplete.length === 0}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={clearAll}
                    disabled={selectedCount === 0}
                  >
                    Clear
                  </Button>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {selectedCount} of {incomplete.length} selected
                </span>
              </div>

              <div className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1">
                {loadingList ? (
                  <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
                    <Loader2 className="size-6 animate-spin" />
                  </div>
                ) : incomplete.length === 0 ? (
                  <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                    <CheckCircle2 className="size-8 text-emerald-400" />
                    <p className="text-sm text-muted-foreground">
                      Every showroom is fully configured 🎉
                    </p>
                  </div>
                ) : (
                  incomplete.map((s) => (
                    <SelectRow
                      key={s.id}
                      showroom={s}
                      checked={selectedIds.has(s.id)}
                      onToggle={() => toggleId(s.id)}
                    />
                  ))
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleContinue}
                  disabled={selectedCount === 0 || resolving}
                  className="gap-1.5"
                >
                  {resolving && <Loader2 className="size-3.5 animate-spin" />}
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ── STEP 2: CONFIRM / REPAIR ── */}
          {step === "resolve" && (
            <>
              <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
                {rows.map((row) => {
                  const unresolved = !row.chosenPlaceId;
                  return (
                    <div
                      key={row.showroomId}
                      className={`rounded-lg bg-card p-3 ring-1 ${
                        unresolved ? "ring-destructive/40" : "ring-border/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {row.name}
                        </p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <ResolveTag source={row.source} />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 gap-1 px-1.5 text-[11px]"
                            onClick={() => setEditing(row.showroomId, !row.editing)}
                          >
                            <Pencil className="size-3" />
                            Edit
                          </Button>
                        </div>
                      </div>

                      {(row.source === "not_found" || row.source === "error") &&
                        !row.card && (
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-400">
                            <AlertTriangle className="size-3.5 shrink-0" />
                            {row.error
                              ? row.error
                              : "No match found — please pick the correct place."}
                          </p>
                        )}

                      {row.card && (
                        <div className="mt-2">
                          <PlaceCardView card={row.card} />
                        </div>
                      )}

                      {row.editing && (
                        <div className="mt-2">
                          <PlaceEditSearch
                            sessionTokenRef={sessionTokenRef}
                            disabled={submitting}
                            onSelect={(placeId) => handleEditSelect(row.showroomId, placeId)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("select")}
                  disabled={submitting}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  {!allRowsResolved && (
                    <span className="text-[11px] text-muted-foreground">
                      Resolve every row to continue
                    </span>
                  )}
                  <Button size="sm" onClick={handleSubmit} disabled={!allRowsResolved || submitting}>
                    Submit
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ── STEP 3: RUN ── */}
          {step === "submit" && (
            <div className="flex-1 space-y-4 overflow-y-auto py-2">
              {submitting ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {progress
                      ? `Pulling Google details… ${progress.done} of ${progress.total}`
                      : "Submitting…"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <CheckCircle2 className="size-8 text-emerald-400" />
                    <p className="text-sm text-foreground">Backfill queued.</p>
                    <p className="text-[11px] text-muted-foreground">
                      Places data saved; Gemini + scraping are running in the background.
                    </p>
                  </div>

                  {skipped.length > 0 && (
                    <div className="rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
                      <p className="text-[11px] font-medium text-amber-300">
                        {skipped.length} showroom{skipped.length === 1 ? "" : "s"} skipped
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[11px] text-amber-200/80">
                        {skipped.map((sk) => (
                          <li key={sk.showroomId}>
                            #{sk.showroomId}: {sk.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setOpen(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
