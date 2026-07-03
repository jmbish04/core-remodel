/**
 * @fileoverview ShowroomIntakeApp — Google-powered showroom intake.
 *
 * Two-step flow:
 *   Step 1  Search a business via Google Places (New) Autocomplete. Debounced
 *           typeahead (~300ms) inside a Popover. A single session token groups
 *           every keystroke + the terminal details call into ONE Google billing
 *           session; it is regenerated only after a successful details fetch.
 *   Step 2  On select, we fetch Place Details, map the payload onto the store
 *           schema (via places-mapper), and `form.reset(...)` a fully-editable
 *           react-hook-form organized into FOUR tabs — Search, Location, Hours,
 *           Details. Inferred categories prefill as removable badges.
 *           Submit POSTs to the EXISTING `/api/showroom-stores` create endpoint
 *           (reusing showroom_stores — no new entity).
 *
 *           Selecting a Place is NOT required: an "enter manually" escape lets
 *           the user skip Google entirely and hand-fill the form. Submit is
 *           gated only on `name` (per the schema).
 *
 * Tab layout:
 *   - Search    Google Places typeahead + autofill, the Name field, the rich
 *               Description (OverviewNoteEditor → `description`), and the
 *               "enter manually" escape that jumps to the Location tab.
 *   - Location  Address, Bay Area City, ZIP, Google Maps link, Phone, Website.
 *   - Hours     Structured weekly HoursEditor.
 *   - Details   Read-only Google rating + review summary, editable price level,
 *               and the boolean Attributes (FlagsEditor).
 *
 * Conventions mirrored from ShowroomsDirectoryApp: fetch + useState (no
 * react-query), `toast` from sonner, `@/components/ui/*`, lucide-react icons,
 * Monolith dark styling (no 1px borders — `ring-1 ring-border/40`, `bg-card`,
 * `divide-y divide-border/40`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  Building2,
  Check,
  Clock,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { OverviewNoteEditor } from "../OverviewNoteEditor";

import { HoursEditor } from "./HoursEditor";
import { FlagsEditor, type ShowroomFlags } from "./FlagsEditor";
import { DEFAULT_HOURS, type HoursJson } from "./hours-types";

import {
  mapPlaceToHoursJson,
  mapPlaceToIntake,
  showroomIntakeSchema,
  type GooglePlaceDetails,
  type ShowroomIntakeInput,
  type ShowroomIntakeValues,
} from "./places-mapper";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  placeId: string;
  text: string;
}

interface Category {
  id: number;
  name: string;
}

interface City {
  id: number;
  bayAreaCityName: string;
  hubRoute: string | null;
  hubName: string | null;
}

const PRICE_POINTS = ["$", "$$", "$$$", "$$$$"] as const;

/**
 * Empty defaults for react-hook-form. Every field is seeded so the inputs stay
 * controlled from mount; `form.reset({ ...EMPTY_VALUES, ...mapped })` never
 * leaves a field `undefined`.
 */
const EMPTY_VALUES: ShowroomIntakeInput = {
  name: "",
  description: "",
  pricePoint: undefined,
  locationAddress: "",
  zipCode: "",
  phoneNumber: "",
  emailAddress: "",
  websiteUrl: "",
  instagramUrl: "",
  googleMapsLink: "",
  weekdayHours: "",
  weekendHours: "",
  hoursJson: DEFAULT_HOURS,
  isOpenWeekends: false,
  isAppointmentOnly: false,
  isFlagshipLocation: false,
  isLargeSelection: false,
  isBespoke: false,
  isDesignerOnly: false,
  isTradeRepRequired: false,
  scale: "",
  inventoryFocus: "",
  targetDemographic: "",
  locationNotes: "",
  overviewNoteHtml: "",
  overviewNoteMarkdown: "",
  googleRating: undefined,
  userRatingCount: undefined,
  reviewSummary: "",
  categoryIds: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Match inferred category NAMES to live category IDs. Case-insensitive: a live
 * category qualifies when its name contains the inferred label OR the label
 * contains the live name (handles "Bathroom Tile" ⊇ "tile" both directions).
 */
function resolveCategoryIds(
  labels: string[] | null | undefined,
  categories: Category[] | null | undefined,
): number[] {
  const safeLabels = labels ?? [];
  const safeCategories = categories ?? [];
  const ids = new Set<number>();
  for (const label of safeLabels) {
    const l = label.toLowerCase();
    for (const cat of safeCategories) {
      const n = cat.name.toLowerCase();
      if (n === l || n.includes(l) || l.includes(n)) ids.add(cat.id);
    }
  }
  return [...ids];
}

const BUSINESS_STATUS_COPY: Record<string, string> = {
  CLOSED_TEMPORARILY: "Temporarily closed",
  CLOSED_PERMANENTLY: "Permanently closed",
};

// ─── Search step ──────────────────────────────────────────────────────────────

function PlaceSearch({
  onSelect,
  disabled,
  query,
  onQueryChange,
}: {
  onSelect: (placeId: string) => void;
  disabled: boolean;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // One session token per search session; regenerated when this component is
  // re-mounted (parent bumps a `key` after each successful save).
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown when clicking outside the search container.
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

  // On unmount, clear any pending debounce timer and abort any in-flight
  // autocomplete fetch — prevents a late timeout/response from calling setState
  // on an unmounted component (memory leak / "update on unmounted" warning).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const runSearch = useCallback(async (text: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const url = `/api/places/autocomplete?q=${encodeURIComponent(text)}&sessionToken=${sessionTokenRef.current}`;
      const res = await fetch(url, {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 429) {
        toast.error("Google Maps monthly quota reached. Try again later.");
        setSuggestions([]);
        return;
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Autocomplete failed (${res.status})`);
      }
      const data = (await res.json()) as { suggestions?: Suggestion[] };
      setSuggestions(data.suggestions ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[intake/autocomplete]", err);
      toast.error(err instanceof Error ? err.message : "Autocomplete failed");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    onQueryChange(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
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
        value={query}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        placeholder="Search a showroom or business by name or address…"
        className="pl-9"
        aria-label="Search Google Places"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/40">
          {loading && suggestions.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {query.trim().length < 2
                ? "Type at least 2 characters to search."
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
                      onQueryChange(s.text);
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

// ─── Field wrapper ────────────────────────────────────────────────────────────

function FormRow({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Read-only 5-star rating display. Renders filled stars up to `value` (rounded
 * to the nearest whole star) against muted empties. Amber fill matches the
 * Monolith accent used elsewhere in the intake surface.
 */
function RatingStars({ value }: { value: number }) {
  const filled = Math.round(Math.min(Math.max(value, 0), 5));
  return (
    <span
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={
            i < filled
              ? "size-4 fill-amber-400 text-amber-400"
              : "size-4 text-muted-foreground/40"
          }
        />
      ))}
    </span>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export function ShowroomIntakeApp() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [bayAreaCityId, setBayAreaCityId] = useState<string>("");
  const [loadingPlace, setLoadingPlace] = useState(false);
  // Controlled tab: default "search"; the "enter manually" escape jumps to
  // "location", and a place selection surfaces the form on "search".
  const [activeTab, setActiveTab] = useState<string>("search");
  // Lifted so the "enter manually" escape can seed the Name field with whatever
  // the user already typed into the Places typeahead.
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [context, setContext] = useState<{
    businessStatus?: string;
    rating?: number;
    userRatingCount?: number;
  }>({});
  // Bumped after a successful save so PlaceSearch resets its session token.
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const sessionTokenRef = useRef<string>(crypto.randomUUID());

  const form = useForm<ShowroomIntakeInput, unknown, ShowroomIntakeValues>({
    resolver: zodResolver(showroomIntakeSchema),
    defaultValues: EMPTY_VALUES,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const categoryIds = watch("categoryIds") ?? [];
  const pricePoint = watch("pricePoint");
  const googleRating = watch("googleRating");
  const userRatingCount = watch("userRatingCount");
  const reviewSummary = watch("reviewSummary");

  // ── Load the live category vocabulary on mount ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/showroom-stores/meta/categories", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Categories failed (${res.status})`);
        const data = (await res.json()) as { categories?: Category[] };
        setCategories(data.categories ?? []);
      } catch (err) {
        console.error("[intake/categories]", err);
        toast.error("Could not load category list.");
      }
    })();
  }, []);

  // ── Load the Bay Area city vocabulary on mount ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/showroom-stores/meta/cities", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Cities failed (${res.status})`);
        const data = (await res.json()) as { cities?: City[] };
        setCities(data.cities ?? []);
      } catch (err) {
        console.error("[intake/cities]", err);
        toast.error("Could not load Bay Area city list.");
      }
    })();
  }, []);

  const categoriesById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const availableCategories = useMemo(
    () => categories.filter((c) => !categoryIds.includes(c.id)),
    [categories, categoryIds],
  );

  // ── Fetch Place Details + hydrate the form ──
  const handleSelectPlace = useCallback(
    async (placeId: string) => {
      setLoadingPlace(true);
      try {
        const url = `/api/places/details/${encodeURIComponent(placeId)}?sessionToken=${sessionTokenRef.current}`;
        const res = await fetch(url, { credentials: "include" });
        if (res.status === 429) {
          toast.error("Google Maps monthly quota reached. Try again later.");
          return;
        }
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Details failed (${res.status})`);
        }
        const place = (await res.json()) as GooglePlaceDetails;

        const mapped = mapPlaceToIntake(place);
        const h = mapPlaceToHoursJson(place.regularOpeningHours);
        const resolvedIds = resolveCategoryIds(
          mapped._inferredCategoryLabels,
          categories,
        );

        reset({
          ...EMPTY_VALUES,
          ...mapped,
          googleRating: mapped.googleRating,
          userRatingCount: mapped.userRatingCount,
          reviewSummary: mapped.reviewSummary ?? "",
          hoursJson: h ?? DEFAULT_HOURS,
          categoryIds: resolvedIds,
        });
        // Bay Area city is not sourced from Google — the user picks it. Clear any
        // prior selection so a fresh place starts unassigned.
        setBayAreaCityId("");

        setContext({
          businessStatus: mapped._businessStatus,
          rating: mapped._rating,
          userRatingCount: mapped._userRatingCount,
        });

        // Successful details call closes the billing session → new token next search.
        sessionTokenRef.current = crypto.randomUUID();
      } catch (err) {
        console.error("[intake/details]", err);
        toast.error(err instanceof Error ? err.message : "Failed to load place details");
      } finally {
        setLoadingPlace(false);
      }
    },
    [categories, reset],
  );

  // ── "Enter manually" escape ──
  // Skip Place selection entirely: keep any typed name and jump straight to the
  // Location tab so the user can hand-fill. Submit stays gated only on `name`.
  const handleEnterManually = useCallback(() => {
    const typed = searchQuery.trim();
    if (typed) setValue("name", typed, { shouldDirty: true });
    setActiveTab("location");
  }, [searchQuery, setValue]);

  const addCategory = (id: number) => {
    if (!categoryIds.includes(id)) {
      setValue("categoryIds", [...categoryIds, id], { shouldDirty: true });
    }
  };

  const removeCategory = (id: number) => {
    setValue(
      "categoryIds",
      categoryIds.filter((c) => c !== id),
      { shouldDirty: true },
    );
  };

  // ── Submit → POST /api/showroom-stores ──
  const onSubmit = handleSubmit(async (values) => {
    // Strip empty strings so we send `undefined` (server treats absent as null)
    // rather than persisting "". Booleans + categoryIds always pass through.
    // NOTE: email / POC / instagram / inventoryFocus / scale / targetDemographic /
    // isDesignerOnly / isOpenWeekends / weekday+weekendHours are intentionally NOT
    // sent — the UI stopped collecting them.
    const body: Record<string, unknown> = { name: values.name.trim() };
    const optionalStringKeys: (keyof ShowroomIntakeValues)[] = [
      "description",
      "locationAddress",
      "zipCode",
      "phoneNumber",
      "websiteUrl",
      "googleMapsLink",
      "reviewSummary",
      "overviewNoteHtml",
      "overviewNoteMarkdown",
    ];
    for (const key of optionalStringKeys) {
      const v = values[key];
      if (typeof v === "string" && v.trim()) body[key] = v.trim();
    }
    if (values.pricePoint) body.pricePoint = values.pricePoint;
    // Bay Area city (component-local — not a Google-sourced field).
    if (bayAreaCityId) body.bayAreaCityId = Number(bayAreaCityId);
    // Google-sourced numeric signals.
    if (typeof values.googleRating === "number") body.googleRating = values.googleRating;
    if (typeof values.userRatingCount === "number") {
      body.userRatingCount = values.userRatingCount;
    }
    // Send structured hours; the server derives isOpenWeekends / weekdayHours /
    // weekendHours from this — so we intentionally omit those from the body.
    if (values.hoursJson) body.hoursJson = values.hoursJson;
    body.isAppointmentOnly = !!values.isAppointmentOnly;
    body.isFlagshipLocation = !!values.isFlagshipLocation;
    body.isLargeSelection = !!values.isLargeSelection;
    body.isBespoke = !!values.isBespoke;
    body.isTradeRepRequired = !!values.isTradeRepRequired;
    body.categoryIds = values.categoryIds;

    try {
      const res = await fetch("/api/showroom-stores", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Create failed (${res.status})`);
      }
      toast.success(`${values.name.trim()} added to the showroom directory.`);
      reset({ ...EMPTY_VALUES });
      setBayAreaCityId("");
      setContext({});
      setSearchQuery("");
      setActiveTab("search");
      sessionTokenRef.current = crypto.randomUUID();
      setSessionEpoch((n) => n + 1);
    } catch (err) {
      console.error("[intake/create]", err);
      toast.error(err instanceof Error ? err.message : "Failed to create showroom");
    }
  });

  const statusWarning = context.businessStatus
    ? BUSINESS_STATUS_COPY[context.businessStatus]
    : undefined;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      {/* Header */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Building2 className="size-6 text-muted-foreground" />
          Add Showroom
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search a business on Google, review the auto-filled details, then save
          it to the Bay Area directory.
        </p>
      </div>

      {/* Review & edit — four tabs: Search · Location · Hours · Details */}
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Business-status warning strip (rating now lives in the Details tab) */}
        {statusWarning && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card px-4 py-3 ring-1 ring-border/40">
            <Badge className="gap-1 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
              <AlertTriangle className="size-3.5" />
              {statusWarning}
            </Badge>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="search" className="gap-1.5">
              <Search className="size-4" /> Search
            </TabsTrigger>
            <TabsTrigger value="location" className="gap-1.5">
              <MapPin className="size-4" /> Location
            </TabsTrigger>
            <TabsTrigger value="hours" className="gap-1.5">
              <Clock className="size-4" /> Hours
            </TabsTrigger>
            <TabsTrigger value="details" className="gap-1.5">
              <SlidersHorizontal className="size-4" /> Details
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1 — Search ── */}
          <TabsContent value="search" className="mt-4 space-y-5">
            <Card className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-1 ring-primary/30">
                  1
                </span>
                <span className="text-sm font-medium">Find the business</span>
              </div>
              <PlaceSearch
                key={sessionEpoch}
                onSelect={handleSelectPlace}
                disabled={loadingPlace}
                query={searchQuery}
                onQueryChange={setSearchQuery}
              />
              {loadingPlace ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Fetching details from
                  Google…
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleEnterManually}
                  className="h-auto gap-1.5 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  <PencilLine className="size-4" />
                  Can&rsquo;t find it? Enter the showroom manually
                </Button>
              )}
            </Card>

            <Card className="space-y-4 p-4 sm:p-5">
              <FormRow label="Name" htmlFor="name">
                <Input id="name" {...register("name")} placeholder="Business name" />
                {errors.name && (
                  <p className="text-[11px] text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </FormRow>

              <div className="w-full space-y-1.5 [&_[contenteditable]]:min-h-[220px]">
                <Label>Description</Label>
                <OverviewNoteEditor
                  key={`description-${sessionEpoch}`}
                  initialMarkdown={watch("description") ?? ""}
                  onChange={({ markdown }) =>
                    setValue("description", markdown, { shouldDirty: true })
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Seeded from Google&rsquo;s summary — edit as needed.
                </p>
              </div>
            </Card>

            {/* Categories — inferred from Google, visible alongside search */}
            <Card className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Categories</span>
                <span className="text-[11px] text-muted-foreground">
                  Inferred from Google — edit freely
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {categoryIds.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    No categories yet.
                  </span>
                )}
                {categoryIds.map((id) => {
                  const cat = categoriesById.get(id);
                  if (!cat) return null;
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="gap-1 py-1 pl-2.5 pr-1"
                    >
                      {cat.name}
                      <button
                        type="button"
                        onClick={() => removeCategory(id)}
                        className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                        aria-label={`Remove ${cat.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
              {availableCategories.length > 0 && (
                <div className="pt-1">
                  <Select
                    value=""
                    onValueChange={(v) => {
                      const id = Number(v);
                      if (Number.isFinite(id) && id > 0) addCategory(id);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-64">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Plus className="size-3.5" /> Add category
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {availableCategories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── Tab 2 — Location ── */}
          <TabsContent value="location" className="mt-4 space-y-5">
            <Card className="space-y-4 p-4 sm:p-5">
              <FormRow label="Address" htmlFor="locationAddress">
                  <Input
                    id="locationAddress"
                    {...register("locationAddress")}
                    placeholder="123 Design St, San Francisco, CA"
                  />
                </FormRow>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormRow label="Bay Area city" htmlFor="bayAreaCityId">
                    <Select
                      value={bayAreaCityId}
                      onValueChange={(v) => setBayAreaCityId(v ?? "")}
                    >
                      <SelectTrigger id="bayAreaCityId" className="w-full">
                        <SelectValue placeholder="Select a city" />
                      </SelectTrigger>
                      <SelectContent>
                        {cities.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.bayAreaCityName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormRow>
                  <FormRow label="ZIP code" htmlFor="zipCode">
                    <Input id="zipCode" {...register("zipCode")} placeholder="94103" />
                  </FormRow>
                </div>

                <FormRow label="Google Maps link" htmlFor="googleMapsLink">
                  <Input
                    id="googleMapsLink"
                    {...register("googleMapsLink")}
                    placeholder="https://www.google.com/maps/place/…"
                  />
                </FormRow>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormRow label="Phone" htmlFor="phoneNumber">
                    <Input
                      id="phoneNumber"
                      {...register("phoneNumber")}
                      placeholder="(415) 555-0100"
                    />
                  </FormRow>
                  <FormRow label="Website" htmlFor="websiteUrl">
                    <Input
                      id="websiteUrl"
                      {...register("websiteUrl")}
                      placeholder="https://…"
                    />
                  </FormRow>
                </div>
              </Card>

              {/* Overview / visit note */}
              <Card className="space-y-4 p-4 sm:p-5">
                <span className="text-sm font-medium">Overview note</span>
                <div className="space-y-1.5">
                  <OverviewNoteEditor
                    key={`overview-${sessionEpoch}`}
                    onChange={({ html, markdown }) => {
                      setValue("overviewNoteHtml", html, { shouldDirty: true });
                      setValue("overviewNoteMarkdown", markdown, {
                        shouldDirty: true,
                      });
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Rich narrative — headings, bold, lists. Saved with the showroom.
                  </p>
                </div>
              </Card>
            </TabsContent>

            {/* ── Tab 2 — Hours ── */}
            <TabsContent value="hours" className="mt-4">
              <Card className="space-y-4 p-4 sm:p-5">
                <span className="text-sm font-medium">Hours</span>
                <HoursEditor
                  value={(watch("hoursJson") as HoursJson | undefined) ?? null}
                  onChange={(h) => setValue("hoursJson", h, { shouldDirty: true })}
                />
              </Card>
            </TabsContent>

            {/* ── Tab 3 — Details ── */}
            <TabsContent value="details" className="mt-4 space-y-5">
              {/* Rating (read-only, autofilled) */}
              <Card className="space-y-3 p-4 sm:p-5">
                <span className="text-sm font-medium">Google rating</span>
                {typeof googleRating === "number" ? (
                  <div className="flex items-center gap-2">
                    <RatingStars value={googleRating} />
                    <span className="text-sm font-medium">
                      {googleRating.toFixed(1)}
                    </span>
                    {typeof userRatingCount === "number" && (
                      <span className="text-sm text-muted-foreground">
                        ({userRatingCount.toLocaleString()} reviews)
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/70">
                    No Google rating available.
                  </p>
                )}
              </Card>

              {/* Review summary (read-only) */}
              <Card className="space-y-3 p-4 sm:p-5">
                <span className="text-sm font-medium">Review summary</span>
                {reviewSummary && reviewSummary.trim() ? (
                  <OverviewNoteEditor
                    key={`review-${sessionEpoch}`}
                    editable={false}
                    initialMarkdown={reviewSummary}
                    onChange={() => {}}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground/70">
                    No review summary available.
                  </p>
                )}
              </Card>

              {/* Price level (editable, autofilled) */}
              <Card className="space-y-3 p-4 sm:p-5">
                <FormRow label="Price level" htmlFor="pricePoint">
                  <Select
                    value={pricePoint ?? ""}
                    onValueChange={(v) =>
                      setValue(
                        "pricePoint",
                        (v || undefined) as ShowroomIntakeValues["pricePoint"],
                        { shouldDirty: true },
                      )
                    }
                  >
                    <SelectTrigger id="pricePoint" className="w-full sm:w-64">
                      <SelectValue placeholder="Select price level" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICE_POINTS.map((pp) => (
                        <SelectItem key={pp} value={pp}>
                          <span className="font-mono">{pp}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>
              </Card>

              {/* Attributes (FlagsEditor) */}
              <Card className="space-y-3 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Attributes</span>
                  <span className="text-[11px] text-muted-foreground">
                    Select all that apply
                  </span>
                </div>
                <FlagsEditor
                  value={{
                    isAppointmentOnly: !!watch("isAppointmentOnly"),
                    isFlagshipLocation: !!watch("isFlagshipLocation"),
                    isLargeSelection: !!watch("isLargeSelection"),
                    isBespoke: !!watch("isBespoke"),
                    isTradeRepRequired: !!watch("isTradeRepRequired"),
                  }}
                  onChange={(v: ShowroomFlags) => {
                    setValue("isAppointmentOnly", v.isAppointmentOnly, {
                      shouldDirty: true,
                    });
                    setValue("isFlagshipLocation", v.isFlagshipLocation, {
                      shouldDirty: true,
                    });
                    setValue("isLargeSelection", v.isLargeSelection, {
                      shouldDirty: true,
                    });
                    setValue("isBespoke", v.isBespoke, { shouldDirty: true });
                    setValue("isTradeRepRequired", v.isTradeRepRequired, {
                      shouldDirty: true,
                    });
                  }}
                />
              </Card>
            </TabsContent>
          </Tabs>

          <Separator className="bg-border/40" />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset({ ...EMPTY_VALUES });
                setBayAreaCityId("");
                setContext({});
                setSearchQuery("");
                setActiveTab("search");
                sessionTokenRef.current = crypto.randomUUID();
                setSessionEpoch((n) => n + 1);
              }}
              disabled={isSubmitting}
            >
              Discard
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-1.5">
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save showroom
            </Button>
          </div>
        </form>
    </main>
  );
}
