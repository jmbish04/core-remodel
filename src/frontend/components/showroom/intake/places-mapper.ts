/**
 * @fileoverview places-mapper — pure mapping utilities + Zod schema for the
 * Showroom Intake Form.
 *
 * This module is the single source of truth for translating a raw Google Places
 * (New) Details payload into the shape that `POST /api/showroom-stores` expects
 * (`createStoreSchema`). Every function here is PURE — no fetch, no React, no
 * DOM — so it can be unit-tested in isolation and imported from both the island
 * and any future server-side path.
 *
 * Contract references (verbatim from the backend):
 *   - `POST /api/showroom-stores` body === `createStoreSchema` (see
 *     src/backend/api/routes/showroom-stores.ts). `name` is the only required
 *     field; everything else is optional/nullable. `categoryIds:number[]` is
 *     NOT a store column — the route inserts mapping rows after persisting.
 *   - Google Places Details payload — every field optional; render defensively.
 *     (see src/backend/api/routes/places.ts `PlaceDetailsResponseSchema`).
 *
 * The internal showroom category vocabulary lives in D1 and is seeded from
 * src/backend/db/seeds/seed-reference-data.sql. `inferCategoryLabels` returns
 * category NAMES from that vocabulary; the component resolves those names to
 * numeric IDs against the live `/meta/categories` list (case-insensitive
 * contains match).
 */

import { z } from "zod";

import { DAY_KEYS, type DayKey, type HoursJson } from "./hours-types";

// ─── Zod schema (mirrors createStoreSchema on the backend) ────────────────────

/**
 * Client-side schema for the intake form. Mirrors the server `createStoreSchema`
 * so a value that passes here will pass the server too. `name` is required
 * (min 1); everything else is optional. `categoryIds` defaults to `[]`.
 *
 * We intentionally keep the optional fields as plain `.optional()` (not
 * `.nullable()`) — the form seeds every field with a string/boolean, and empty
 * strings are stripped before POST in the component. Keeping them non-nullable
 * keeps react-hook-form's default-value typing simple.
 */
export const showroomIntakeSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional(),
  pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
  locationAddress: z.string().optional(),
  zipCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  emailAddress: z.string().optional(),
  websiteUrl: z.string().optional(),
  // Instagram profile URL. Google Places Details has no IG field, so this stays
  // blank on auto-fill and is entered by hand.
  instagramUrl: z.string().optional(),
  googleMapsLink: z.string().optional(),
  // Structured weekly hours (source of truth). The server derives isOpenWeekends
  // from this when present, so the client must NOT also send that. A permissive
  // `z.custom` is fine here — this is the form validator, not the server one.
  hoursJson: z.custom<HoursJson>().optional(),
  isOpenWeekends: z.boolean().optional(),
  isAppointmentOnly: z.boolean().optional(),
  isFlagshipLocation: z.boolean().optional(),
  // "Select all that apply" showroom traits (see FlagsEditor).
  isLargeSelection: z.boolean().optional(),
  isBespoke: z.boolean().optional(),
  isDesignerOnly: z.boolean().optional(),
  scale: z.string().optional(),
  inventoryFocus: z.string().optional(),
  targetDemographic: z.string().optional(),
  locationNotes: z.string().optional(),
  // Rich-text "overview note" (PlateJS). Stored as BOTH HTML (for render) and
  // Markdown (source of truth / round-trip). Both optional; only sent when set.
  overviewNoteHtml: z.string().optional(),
  overviewNoteMarkdown: z.string().optional(),
  // Google Places–sourced signals (persisted so consumers can send them).
  googleRating: z.number().optional(),
  userRatingCount: z.number().optional(),
  reviewSummary: z.string().optional(),
  isTradeRepRequired: z.boolean().optional(),
  categoryIds: z.array(z.number()).default([]),
});

export type ShowroomIntakeValues = z.infer<typeof showroomIntakeSchema>;

/**
 * The INPUT type of the schema (before defaults are applied). `categoryIds` is
 * optional here but required on the parsed output. react-hook-form's form values
 * correspond to the input type, so the island types its `useForm` with this to
 * keep the zodResolver's input/output generics aligned.
 */
export type ShowroomIntakeInput = z.input<typeof showroomIntakeSchema>;

// ─── Google Places payload types (permissive — all optional) ──────────────────

interface LocalizedText {
  text?: string | null;
  languageCode?: string | null;
}

interface OpeningHours {
  weekdayDescriptions?: string[] | null;
}

/**
 * The subset of the Google Places (New) Details payload we actually read.
 * Mirrors `PlaceDetailsResponseSchema` on the backend but stays permissive:
 * every field is optional/nullable because Google omits anything the place
 * hasn't populated.
 */
export interface GooglePlaceDetails {
  id?: string | null;
  displayName?: LocalizedText | null;
  formattedAddress?: string | null;
  location?: { latitude?: number | null; longitude?: number | null } | null;
  nationalPhoneNumber?: string | null;
  internationalPhoneNumber?: string | null;
  websiteUri?: string | null;
  regularOpeningHours?: OpeningHours | null;
  currentOpeningHours?: OpeningHours | null;
  priceLevel?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  editorialSummary?: LocalizedText | null;
  /** Google returns this as an object; `.text` (or `.overview.text`) holds the copy. */
  generativeSummary?: Record<string, unknown> | null;
  /** Google "review summary" (AI-condensed review copy); `.text.text` holds it. */
  reviewSummary?: { text?: { text?: string | null } | null } | null;
  types?: string[] | null;
  primaryType?: string | null;
  businessStatus?: string | null;
  /**
   * Google Places (New) photo references. `name` is the photo resource id
   * ("places/{place}/photos/{photo}") used to fetch the media bytes. Forwarded
   * (first 5) to the create body as `_photos`; never a persisted intake field.
   */
  photos?: Array<{
    name: string;
    widthPx?: number | null;
    heightPx?: number | null;
    authorAttributions?: Array<{
      displayName?: string | null;
      uri?: string | null;
      photoUri?: string | null;
    }> | null;
    flagContentUri?: string | null;
    googleMapsUri?: string | null;
  }> | null;
  /** Raw Google reviews (rating + text) — kept for potential downstream use. */
  reviews?: Array<{
    rating?: number | null;
    text?: { text?: string | null } | null;
  }> | null;
  /**
   * AI-derived insight attached by the backend Places-details proxy (Gemini via
   * AI Gateway). Present only when reviews were available and the AI call
   * succeeded. `inferredPricePoint` is a FALLBACK used when Google returns no
   * structured `priceLevel`; `isLargeSelection` seeds the Large-selection flag.
   */
  aiInference?: {
    inferredPricePoint?: "$" | "$$" | "$$$" | "$$$$" | "PRICE_LEVEL_UNSPECIFIED" | null;
    priceReasoning?: string | null;
    /** Per-attribute detection with AI rationale, from the review analysis. */
    attributes?: {
      appointmentOnly?: { value?: boolean; rationale?: string };
      flagshipLocation?: { value?: boolean; rationale?: string };
      largeSelection?: { value?: boolean; rationale?: string };
      bespokeCurated?: { value?: boolean; rationale?: string };
      tradeRepRequired?: { value?: boolean; rationale?: string };
    } | null;
    /** Whether the Google reviews look genuine (Gemini + Google-Search grounding). */
    reviewAuthenticity?: {
      assessment?: string;
      rationale?: string;
      sources?: string[];
    } | null;
    /** Brands the showroom carries, extracted from reviews/knowledge. */
    brands?: Array<{ name?: string; type?: string; websiteUrl?: string }> | null;
  } | null;
}

/** A single Places photo reference, as forwarded on `_photos`. */
export type GooglePlacePhoto = NonNullable<GooglePlaceDetails["photos"]>[number];

/**
 * Per-field autofill diagnostic. Powers the red "why this field didn't
 * autofill" labels next to each form input.
 *
 * - `source` — the exact Google field path this value was read from
 *   (e.g. `"priceLevel"`, `"displayName.text"`, `"regularOpeningHours.periods"`).
 * - `raw`    — the exact raw Google value that was inspected (or `null` absent).
 * - `ok`     — whether a usable value was produced for the form.
 * - `reason` — a short human explanation, present ONLY when `ok === false`.
 */
export interface FieldDiag {
  source: string;
  raw: unknown;
  ok: boolean;
  reason?: string;
}

/** Map of intake field key → its autofill diagnostic. */
export type IntakeDiagnostics = Record<string, FieldDiag>;

/**
 * The result of `mapPlaceToIntake`: the subset of intake form values Google can
 * fill, plus a few underscore-prefixed "meta" fields the component uses for
 * display and category resolution but which are NOT sent to the server.
 */
export type MappedIntake = Partial<ShowroomIntakeValues> & {
  /** Internal category NAMES inferred from Google types; resolved to IDs in the UI. */
  _inferredCategoryLabels: string[];
  /** "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | undefined. */
  _businessStatus?: string;
  /** Google aggregate rating (0–5), for the read-only context strip. */
  _rating?: number;
  /** Google review count backing the rating. */
  _userRatingCount?: number;
  /**
   * First 5 raw Google photo references, forwarded to the create body so the
   * server can fetch + persist the media. NOT a persisted intake field.
   */
  _photos: GooglePlacePhoto[];
  /** Per-field autofill diagnostics for the red "why it didn't autofill" labels. */
  _diagnostics: IntakeDiagnostics;
};

// ─── Price-level mapping ──────────────────────────────────────────────────────

/**
 * Google `priceLevel` enum → our `pricePoint` symbol. Anything unrecognized
 * (including the "FREE"/"UNSPECIFIED" levels) maps to `undefined` so we leave
 * the field blank rather than guessing.
 */
const PRICE_LEVEL_MAP: Record<string, "$" | "$$" | "$$$" | "$$$$"> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

/**
 * Pull the best available AI/editorial summary text out of a place. Google's
 * `generativeSummary` is an object whose copy lives at `.text.text` or
 * `.overview.text` depending on API surface; we probe a few shapes defensively
 * and fall back to `editorialSummary.text`.
 */
function extractSummary(place: GooglePlaceDetails): string | undefined {
  const gen = place.generativeSummary as
    | { text?: LocalizedText | string; overview?: LocalizedText }
    | null
    | undefined;
  if (gen) {
    const t = gen.text;
    if (typeof t === "string" && t.trim()) return t.trim();
    if (t && typeof t === "object" && t.text?.trim()) return t.text.trim();
    if (gen.overview?.text?.trim()) return gen.overview.text.trim();
  }
  const editorial = place.editorialSummary?.text;
  if (editorial && editorial.trim()) return editorial.trim();
  return undefined;
}

/**
 * Parse a trailing US ZIP (5-digit or ZIP+4) out of a formatted address.
 * Google addresses look like "123 Main St, San Francisco, CA 94103, USA" — the
 * ZIP sits just before the (optional) country. Returns `undefined` when no ZIP
 * is present (common for non-US or partially-populated listings).
 */
function parseZip(formattedAddress?: string | null): string | undefined {
  if (!formattedAddress) return undefined;
  // Match a 5-digit ZIP (optionally +4) that is preceded by a 2-letter state
  // abbreviation, e.g. "…, Los Gatos, CA 95032, USA". Anchoring on the state
  // avoids mis-grabbing a 5-digit STREET number when the address has no ZIP
  // (e.g. "12345 5th Ave, New York, NY" → undefined, not "12345"). For an
  // intake form the user reviews, leaving it blank beats a wrong value.
  const match = /\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/i.exec(formattedAddress);
  return match ? match[1] : undefined;
}

// ─── mapPlaceToIntake ─────────────────────────────────────────────────────────

/**
 * Map a Google Places Details payload onto intake form values.
 *
 * Field mapping:
 *   - displayName.text                              → name
 *   - formattedAddress                              → locationAddress
 *   - trailing ZIP parsed from formattedAddress     → zipCode
 *   - internationalPhoneNumber || nationalPhoneNumber → phoneNumber
 *   - websiteUri                                    → websiteUrl
 *   - https://www.google.com/maps/place/?q=place_id:{id} → googleMapsLink
 *   - generativeSummary?.text || editorialSummary?.text  → description
 *   - priceLevel                                    → pricePoint (via PRICE_LEVEL_MAP)
 *
 * Pass-through meta (display only, NOT posted): _inferredCategoryLabels,
 * _businessStatus, _rating, _userRatingCount.
 *
 * Every field is written only when Google actually supplied a value, so the
 * caller can `form.reset({ ...emptyDefaults, ...mapPlaceToIntake(place) })`
 * without clobbering good defaults with `undefined`.
 */
export function mapPlaceToIntake(place: GooglePlaceDetails): MappedIntake {
  const mapped: MappedIntake = {
    _inferredCategoryLabels: inferCategoryLabels(
      place.types ?? [],
      place.primaryType ?? undefined,
    ),
    // Populated near the end of this function; seeded here so the object
    // satisfies the (now-required) MappedIntake keys during construction.
    _photos: [],
    _diagnostics: {},
  };

  const name = place.displayName?.text?.trim();
  if (name) mapped.name = name;

  if (place.formattedAddress) mapped.locationAddress = place.formattedAddress;

  const zip = parseZip(place.formattedAddress);
  if (zip) mapped.zipCode = zip;

  const phone =
    place.internationalPhoneNumber?.trim() || place.nationalPhoneNumber?.trim();
  if (phone) mapped.phoneNumber = phone;

  if (place.websiteUri) mapped.websiteUrl = place.websiteUri;

  if (place.id) {
    mapped.googleMapsLink = `https://www.google.com/maps/place/?q=place_id:${place.id}`;
  }

  const description = extractSummary(place);
  if (description) mapped.description = description;

  if (place.priceLevel && PRICE_LEVEL_MAP[place.priceLevel]) {
    mapped.pricePoint = PRICE_LEVEL_MAP[place.priceLevel];
  }

  if (place.businessStatus) mapped._businessStatus = place.businessStatus;
  if (typeof place.rating === "number") mapped._rating = place.rating;
  if (typeof place.userRatingCount === "number") {
    mapped._userRatingCount = place.userRatingCount;
  }

  // Persisted (server-bound) Google signals so consumers can send them.
  if (typeof place.rating === "number") mapped.googleRating = place.rating;
  if (typeof place.userRatingCount === "number") {
    mapped.userRatingCount = place.userRatingCount;
  }
  const reviewSummary = extractReviewSummary(place);
  if (reviewSummary) mapped.reviewSummary = reviewSummary;

  // Structured business hours — consumed by the bulk-backfill submit payload
  // (the single-add intake app calls mapPlaceToHoursJson itself for its form).
  const hoursJson = mapPlaceToHoursJson(place.regularOpeningHours);
  if (hoursJson) mapped.hoursJson = hoursJson;

  // Raw photo references (first 5) for the create body — NOT a persisted field.
  mapped._photos = (place.photos ?? []).slice(0, 5);

  // Per-field autofill diagnostics for the red "why it didn't autofill" labels.
  mapped._diagnostics = buildDiagnostics(place, {
    zip,
    description,
    phone,
    reviewSummary,
    hoursJson,
  });

  return mapped;
}

/**
 * Build the per-field autofill diagnostics map. Each entry records the exact
 * Google field path (`source`), the raw value inspected (`raw`), whether a
 * usable value was produced (`ok`), and a short `reason` when it was not.
 *
 * Fully defensive — every Google field is optional, so a missing value yields
 * an `ok: false` entry with a `raw` of `null` (or the raw unmapped value) plus a
 * human-readable reason. Does NOT include a `bayAreaCity` entry (the form
 * resolves city itself).
 *
 * The already-computed derived values (`zip`, `description`, `phone`,
 * `reviewSummary`) are threaded in so this stays in lock-step with the mapping
 * above rather than re-deriving them.
 */
function buildDiagnostics(
  place: GooglePlaceDetails,
  derived: {
    zip: string | undefined;
    description: string | undefined;
    phone: string | undefined;
    reviewSummary: string | undefined;
    hoursJson: HoursJson | null;
  },
): IntakeDiagnostics {
  const diag: IntakeDiagnostics = {};

  // name ← displayName.text
  {
    const raw = place.displayName?.text ?? null;
    const value = place.displayName?.text?.trim();
    diag.name = value
      ? { source: "displayName.text", raw, ok: true }
      : {
          source: "displayName.text",
          raw,
          ok: false,
          reason: "Places returned no displayName.text",
        };
  }

  // description ← generativeSummary / editorialSummary
  {
    const raw = place.generativeSummary ?? place.editorialSummary ?? null;
    diag.description = derived.description
      ? { source: "generativeSummary/editorialSummary", raw, ok: true }
      : {
          source: "generativeSummary/editorialSummary",
          raw,
          ok: false,
          reason: "Places returned no generative or editorial summary",
        };
  }

  // pricePoint ← priceLevel (only ok when it's a KEY in PRICE_LEVEL_MAP)
  {
    const raw = place.priceLevel ?? null;
    if (place.priceLevel && PRICE_LEVEL_MAP[place.priceLevel]) {
      diag.pricePoint = { source: "priceLevel", raw, ok: true };
    } else if (!place.priceLevel) {
      diag.pricePoint = {
        source: "priceLevel",
        raw,
        ok: false,
        reason: "Places returned no priceLevel",
      };
    } else {
      diag.pricePoint = {
        source: "priceLevel",
        raw,
        ok: false,
        reason: `Places priceLevel = ${place.priceLevel} (no $ tier)`,
      };
    }
  }

  // locationAddress ← formattedAddress
  {
    const raw = place.formattedAddress ?? null;
    diag.locationAddress = place.formattedAddress
      ? { source: "formattedAddress", raw, ok: true }
      : {
          source: "formattedAddress",
          raw,
          ok: false,
          reason: "Places returned no formattedAddress",
        };
  }

  // zipCode ← parsed from formattedAddress
  {
    const raw = place.formattedAddress ?? null;
    diag.zipCode = derived.zip
      ? { source: "formattedAddress", raw, ok: true }
      : {
          source: "formattedAddress",
          raw,
          ok: false,
          reason: place.formattedAddress
            ? "No ZIP found in the formatted address"
            : "Places returned no formattedAddress",
        };
  }

  // phoneNumber ← internationalPhoneNumber ?? nationalPhoneNumber
  {
    const raw =
      place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null;
    diag.phoneNumber = derived.phone
      ? { source: "internationalPhoneNumber ?? nationalPhoneNumber", raw, ok: true }
      : {
          source: "internationalPhoneNumber ?? nationalPhoneNumber",
          raw,
          ok: false,
          reason: "Places returned no phone number",
        };
  }

  // websiteUrl ← websiteUri
  {
    const raw = place.websiteUri ?? null;
    diag.websiteUrl = place.websiteUri
      ? { source: "websiteUri", raw, ok: true }
      : {
          source: "websiteUri",
          raw,
          ok: false,
          reason: "Places returned no websiteUri",
        };
  }

  // googleMapsLink ← derived from id
  {
    const raw = place.id ?? null;
    diag.googleMapsLink = place.id
      ? { source: "id", raw, ok: true }
      : {
          source: "id",
          raw,
          ok: false,
          reason: "Places returned no place id",
        };
  }

  // hoursJson ← regularOpeningHours
  {
    const raw = place.regularOpeningHours ?? null;
    const hours = derived.hoursJson;
    diag.hoursJson = hours
      ? { source: "regularOpeningHours.periods", raw, ok: true }
      : {
          source: "regularOpeningHours.periods",
          raw,
          ok: false,
          reason: place.regularOpeningHours
            ? "Places regularOpeningHours had no usable periods"
            : "Places had no regularOpeningHours",
        };
  }

  // googleRating ← rating
  {
    const raw = place.rating ?? null;
    diag.googleRating =
      typeof place.rating === "number"
        ? { source: "rating", raw, ok: true }
        : {
            source: "rating",
            raw,
            ok: false,
            reason: "Places returned no rating",
          };
  }

  // userRatingCount ← userRatingCount
  {
    const raw = place.userRatingCount ?? null;
    diag.userRatingCount =
      typeof place.userRatingCount === "number"
        ? { source: "userRatingCount", raw, ok: true }
        : {
            source: "userRatingCount",
            raw,
            ok: false,
            reason: "Places returned no userRatingCount",
          };
  }

  // reviewSummary ← reviewSummary.text.text (falls back to generative/editorial)
  {
    const raw = place.reviewSummary?.text?.text ?? null;
    diag.reviewSummary = derived.reviewSummary
      ? { source: "reviewSummary.text.text", raw, ok: true }
      : {
          source: "reviewSummary.text.text",
          raw,
          ok: false,
          reason: "Places returned no review summary",
        };
  }

  return diag;
}

/**
 * Pull the best available review-summary text: Google's condensed
 * `reviewSummary.text.text` when present, else the generative/editorial summary
 * (`extractSummary`), else undefined.
 */
function extractReviewSummary(place: GooglePlaceDetails): string | undefined {
  const rs = place.reviewSummary?.text?.text;
  if (rs && rs.trim()) return rs.trim();
  return extractSummary(place);
}

// ─── inferCategoryLabels ──────────────────────────────────────────────────────

/**
 * Ordered rules mapping Google place `types`/`primaryType` tokens to internal
 * showroom category NAMES. Names MUST match (case-insensitive contains) the
 * live vocabulary seeded in seed-reference-data.sql:
 *
 *   Flooring, Kitchen Cabinetry, Bathroom Vanities, Kitchen Countertops,
 *   Bathroom Tile, Plumbing Fixtures, Lighting, Appliances, Doors & Hardware,
 *   Windows, Closet Systems, Paint & Finishes, Furniture, Outdoor & Landscape,
 *   Smart Home, Wall Coverings, Rugs & Textiles, Art & Accessories,
 *   Kitchen Backsplash, Architectural Elements, Water Filtration
 *
 * Each rule tests the combined haystack (all types + primaryType, lowercased)
 * and, on match, contributes one or more internal category names. A place can
 * match multiple rules; the result is de-duplicated in insertion order.
 *
 * The names returned here are matched to numeric IDs in the component against
 * the live `/meta/categories` payload — so a name that doesn't exist in the
 * live list simply drops out during resolution (no error).
 */
const CATEGORY_RULES: { test: RegExp; labels: string[] }[] = [
  // Furniture / home goods / decor
  { test: /home_goods_store|furniture_store|home_improvement_store/, labels: ["Furniture"] },
  { test: /home_goods_store/, labels: ["Art & Accessories"] },
  // Hardware & doors
  { test: /hardware_store/, labels: ["Doors & Hardware"] },
  { test: /door/, labels: ["Doors & Hardware"] },
  // Plumbing / bath
  { test: /plumbing|plumber/, labels: ["Plumbing Fixtures"] },
  { test: /bath|bathroom/, labels: ["Bathroom Tile", "Bathroom Vanities"] },
  // Lighting
  { test: /lighting_store|lighting|light_fixture/, labels: ["Lighting"] },
  // Tile / stone / flooring
  { test: /tile|stone|flooring|floor|carpet|hardwood/, labels: ["Flooring"] },
  { test: /tile/, labels: ["Bathroom Tile"] },
  { test: /countertop|slab|granite|quartz|marble/, labels: ["Kitchen Countertops"] },
  // Kitchen
  { test: /kitchen|cabinet/, labels: ["Kitchen Cabinetry"] },
  // Appliances
  { test: /appliance|electronics_store/, labels: ["Appliances"] },
  // Windows
  { test: /window/, labels: ["Windows"] },
  // Closets / storage
  { test: /closet|storage|organiz/, labels: ["Closet Systems"] },
  // Paint & finishes
  { test: /paint/, labels: ["Paint & Finishes"] },
  // Rugs / textiles
  { test: /rug|carpet|textile|fabric|drapery/, labels: ["Rugs & Textiles"] },
  // Wall coverings
  { test: /wallpaper|wall_covering/, labels: ["Wall Coverings"] },
  // Smart home
  { test: /smart_home|home_automation|locksmith/, labels: ["Smart Home"] },
  // Outdoor
  { test: /garden|landscap|outdoor|nursery|patio/, labels: ["Outdoor & Landscape"] },
  // Water filtration
  { test: /water|filtration/, labels: ["Water Filtration"] },
];

/**
 * Infer internal showroom category NAMES from Google place types.
 *
 * @param types       Google `types` array (e.g. ["furniture_store", "store"]).
 * @param primaryType Optional Google `primaryType` (folded into the haystack).
 * @returns De-duplicated internal category names (in insertion order). May be
 *          empty when nothing matches — the UI then leaves categories blank.
 */
export function inferCategoryLabels(
  types: string[] | null | undefined,
  primaryType?: string,
): string[] {
  const safeTypes = types ?? [];
  const haystack = [...safeTypes, primaryType ?? ""].join(" ").toLowerCase();
  const out: string[] = [];
  for (const { test, labels } of CATEGORY_RULES) {
    if (test.test(haystack)) {
      for (const label of labels) {
        if (!out.includes(label)) out.push(label);
      }
    }
  }
  return out;
}

// ─── mapPlaceToHoursJson ──────────────────────────────────────────────────────

/**
 * Google Places (New) day index → our `DayKey`. Google uses 0 = Sunday …
 * 6 = Saturday; our `DAY_KEYS` array is Monday-first, so we can't index it
 * directly.
 */
const GOOGLE_DAY_TO_KEY: Record<number, DayKey> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

/** A single point of a Google `regularOpeningHours.periods[]` entry. */
interface GooglePeriodPoint {
  day?: number | null;
  hour?: number | null;
  minute?: number | null;
}

interface GooglePeriod {
  open?: GooglePeriodPoint | null;
  close?: GooglePeriodPoint | null;
}

/** Format a Google hour/minute pair into a 24-hour "HH:MM" string (clamped). */
function formatGoogleTime(point: GooglePeriodPoint): string {
  const h = Math.min(Math.max(Math.trunc(point.hour ?? 0), 0), 23);
  const m = Math.min(Math.max(Math.trunc(point.minute ?? 0), 0), 59);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Map a Google Places (New) `regularOpeningHours` object onto the structured
 * `HoursJson` model (see ./hours-types).
 *
 * Google returns `regularOpeningHours.periods` as an array of
 * `{ open: { day, hour, minute }, close: { day, hour, minute } }` where `day`
 * is 0 = Sunday … 6 = Saturday. We key each period by its OPEN day and write
 * the open/close window. Multiple periods for the same day (split hours) collapse
 * to a single span from the earliest open to the latest close — the structured
 * model holds one window per day, and the `HoursEditor` custom-hours pane is the
 * escape hatch for anything finer.
 *
 * Any day with no period is left `null` (closed). A 24-hour venue (Google emits
 * a single open with no close) maps to `00:00`–`23:59`.
 *
 * Returns `null` when `periods` is missing/empty — the caller then leaves hours
 * unset (there is no free-text fallback; structured hours are the source of truth).
 *
 * @param regularOpeningHours The raw `place.regularOpeningHours` (typed `unknown`
 *   because callers pass it straight off a permissive payload).
 */
export function mapPlaceToHoursJson(regularOpeningHours: unknown): HoursJson | null {
  const roh = regularOpeningHours as { periods?: unknown } | null | undefined;
  const periods = roh?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  // Track earliest open + latest close (in minutes) per day so split periods
  // collapse to a single span.
  const spans = {} as Record<DayKey, { openMin: number; open: string; closeMin: number; close: string } | undefined>;

  const toMin = (hhmm: string): number => {
    const p = hhmm.split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  };

  for (const raw of periods as GooglePeriod[]) {
    const openPoint = raw?.open;
    if (!openPoint || typeof openPoint.day !== "number") continue;
    const key = GOOGLE_DAY_TO_KEY[openPoint.day];
    if (!key) continue;

    const open = formatGoogleTime(openPoint);
    // A missing close (24h venue) → end of day.
    const close = raw?.close ? formatGoogleTime(raw.close) : "23:59";
    const openMin = toMin(open);
    const closeMin = toMin(close);

    const existing = spans[key];
    if (!existing) {
      spans[key] = { openMin, open, closeMin, close };
    } else {
      if (openMin < existing.openMin) {
        existing.openMin = openMin;
        existing.open = open;
      }
      if (closeMin > existing.closeMin) {
        existing.closeMin = closeMin;
        existing.close = close;
      }
    }
  }

  const out = {} as HoursJson;
  let any = false;
  for (const key of DAY_KEYS) {
    const span = spans[key];
    if (span) {
      out[key] = { open: span.open, close: span.close };
      any = true;
    } else {
      out[key] = null;
    }
  }

  return any ? out : null;
}
