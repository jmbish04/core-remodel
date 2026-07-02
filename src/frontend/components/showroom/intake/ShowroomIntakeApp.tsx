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
 *           react-hook-form. Inferred categories prefill as removable badges.
 *           Submit POSTs to the EXISTING `/api/showroom-stores` create endpoint
 *           (reusing showroom_stores — no new entity).
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
  Loader2,
  MapPin,
  Plus,
  Search,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  formatOpeningHours,
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
  googleMapsLink: "",
  weekdayHours: "",
  weekendHours: "",
  isOpenWeekends: false,
  isAppointmentOnly: false,
  isFlagshipLocation: false,
  scale: "",
  inventoryFocus: "",
  targetDemographic: "",
  locationNotes: "",
  categoryIds: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Match inferred category NAMES to live category IDs. Case-insensitive: a live
 * category qualifies when its name contains the inferred label OR the label
 * contains the live name (handles "Bathroom Tile" ⊇ "tile" both directions).
 */
function resolveCategoryIds(
  labels: string[],
  categories: Category[],
): number[] {
  const ids = new Set<number>();
  for (const label of labels) {
    const l = label.toLowerCase();
    for (const cat of categories) {
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
}: {
  onSelect: (placeId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
    setQuery(value);
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
                      setQuery(s.text);
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

function ToggleRow({
  label,
  checked,
  onChange,
  id,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-card px-3 py-2.5 ring-1 ring-border/40">
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export function ShowroomIntakeApp() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const [hydrated, setHydrated] = useState(false);
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
  const isOpenWeekends = watch("isOpenWeekends");
  const isAppointmentOnly = watch("isAppointmentOnly");
  const isFlagshipLocation = watch("isFlagshipLocation");

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
        const hours = formatOpeningHours(place.regularOpeningHours);
        const resolvedIds = resolveCategoryIds(
          mapped._inferredCategoryLabels,
          categories,
        );

        reset({
          ...EMPTY_VALUES,
          ...mapped,
          weekdayHours: hours.weekdayHours,
          weekendHours: hours.weekendHours,
          isOpenWeekends: hours.isOpenWeekends,
          categoryIds: resolvedIds,
        });

        setContext({
          businessStatus: mapped._businessStatus,
          rating: mapped._rating,
          userRatingCount: mapped._userRatingCount,
        });
        setHydrated(true);

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
    const body: Record<string, unknown> = { name: values.name.trim() };
    const optionalStringKeys: (keyof ShowroomIntakeValues)[] = [
      "description",
      "locationAddress",
      "zipCode",
      "phoneNumber",
      "emailAddress",
      "websiteUrl",
      "googleMapsLink",
      "weekdayHours",
      "weekendHours",
      "scale",
      "inventoryFocus",
      "targetDemographic",
      "locationNotes",
    ];
    for (const key of optionalStringKeys) {
      const v = values[key];
      if (typeof v === "string" && v.trim()) body[key] = v.trim();
    }
    if (values.pricePoint) body.pricePoint = values.pricePoint;
    body.isOpenWeekends = !!values.isOpenWeekends;
    body.isAppointmentOnly = !!values.isAppointmentOnly;
    body.isFlagshipLocation = !!values.isFlagshipLocation;
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
      setContext({});
      setHydrated(false);
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

      {/* Step 1 — Search */}
      <Card className="p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-1 ring-primary/30">
            1
          </span>
          <span className="text-sm font-medium">Find the business</span>
        </div>
        <PlaceSearch
          key={sessionEpoch}
          onSelect={handleSelectPlace}
          disabled={loadingPlace}
        />
        {loadingPlace && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Fetching details from Google…
          </div>
        )}
      </Card>

      {/* Step 2 — Review & edit */}
      {hydrated && (
        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          {/* Read-only context strip */}
          {(context.rating != null || statusWarning) && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card px-4 py-3 ring-1 ring-border/40">
              {context.rating != null && (
                <span className="flex items-center gap-1.5 text-sm">
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                  <span className="font-medium">{context.rating.toFixed(1)}</span>
                  {context.userRatingCount != null && (
                    <span className="text-muted-foreground">
                      ({context.userRatingCount.toLocaleString()} reviews)
                    </span>
                  )}
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                    Google
                  </span>
                </span>
              )}
              {statusWarning && (
                <Badge className="gap-1 bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
                  <AlertTriangle className="size-3.5" />
                  {statusWarning}
                </Badge>
              )}
            </div>
          )}

          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-1 ring-primary/30">
                2
              </span>
              <span className="text-sm font-medium">Review &amp; edit</span>
            </div>

            <FormRow label="Name" htmlFor="name">
              <Input id="name" {...register("name")} placeholder="Business name" />
              {errors.name && (
                <p className="text-[11px] text-destructive">{errors.name.message}</p>
              )}
            </FormRow>

            <FormRow label="Address" htmlFor="locationAddress">
              <Input
                id="locationAddress"
                {...register("locationAddress")}
                placeholder="123 Design St, San Francisco, CA"
              />
            </FormRow>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormRow label="ZIP code" htmlFor="zipCode">
                <Input id="zipCode" {...register("zipCode")} placeholder="94103" />
              </FormRow>
              <FormRow label="Price point" htmlFor="pricePoint">
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
                  <SelectTrigger id="pricePoint" className="w-full">
                    <SelectValue placeholder="Select price point" />
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
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormRow label="Phone" htmlFor="phoneNumber">
                <Input
                  id="phoneNumber"
                  {...register("phoneNumber")}
                  placeholder="(415) 555-0100"
                />
              </FormRow>
              <FormRow label="Email" htmlFor="emailAddress">
                <Input
                  id="emailAddress"
                  {...register("emailAddress")}
                  placeholder="hello@showroom.com"
                />
              </FormRow>
            </div>

            <FormRow label="Website" htmlFor="websiteUrl">
              <Input
                id="websiteUrl"
                {...register("websiteUrl")}
                placeholder="https://…"
              />
            </FormRow>
          </Card>

          {/* Categories */}
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

          {/* Hours */}
          <Card className="space-y-4 p-4 sm:p-5">
            <span className="text-sm font-medium">Hours &amp; access</span>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormRow
                label="Weekday hours"
                htmlFor="weekdayHours"
                hint="Mon–Fri, one row per line"
              >
                <Textarea
                  id="weekdayHours"
                  rows={5}
                  {...register("weekdayHours")}
                  placeholder="Monday: 9 AM–5 PM"
                />
              </FormRow>
              <FormRow
                label="Weekend hours"
                htmlFor="weekendHours"
                hint="Sat/Sun, one row per line"
              >
                <Textarea
                  id="weekendHours"
                  rows={5}
                  {...register("weekendHours")}
                  placeholder="Saturday: Closed"
                />
              </FormRow>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ToggleRow
                id="isOpenWeekends"
                label="Open weekends"
                checked={!!isOpenWeekends}
                onChange={(v) => setValue("isOpenWeekends", v, { shouldDirty: true })}
              />
              <ToggleRow
                id="isAppointmentOnly"
                label="Appointment only"
                checked={!!isAppointmentOnly}
                onChange={(v) => setValue("isAppointmentOnly", v, { shouldDirty: true })}
              />
              <ToggleRow
                id="isFlagshipLocation"
                label="Flagship"
                checked={!!isFlagshipLocation}
                onChange={(v) => setValue("isFlagshipLocation", v, { shouldDirty: true })}
              />
            </div>
          </Card>

          {/* Notes */}
          <Card className="space-y-4 p-4 sm:p-5">
            <span className="text-sm font-medium">Notes</span>
            <FormRow
              label="Description"
              htmlFor="description"
              hint="Seeded from Google's summary — edit as needed"
            >
              <Textarea
                id="description"
                rows={3}
                {...register("description")}
                placeholder="What this showroom is known for…"
              />
            </FormRow>
            <FormRow label="Location notes" htmlFor="locationNotes">
              <Textarea
                id="locationNotes"
                rows={2}
                {...register("locationNotes")}
                placeholder="Parking, entrance, who to ask for…"
              />
            </FormRow>
          </Card>

          <Separator className="bg-border/40" />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset({ ...EMPTY_VALUES });
                setContext({});
                setHydrated(false);
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
      )}
    </main>
  );
}
