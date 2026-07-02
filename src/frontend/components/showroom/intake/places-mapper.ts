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
  weekdayHours: z.string().optional(),
  weekendHours: z.string().optional(),
  isOpenWeekends: z.boolean().optional(),
  isAppointmentOnly: z.boolean().optional(),
  isFlagshipLocation: z.boolean().optional(),
  scale: z.string().optional(),
  inventoryFocus: z.string().optional(),
  targetDemographic: z.string().optional(),
  locationNotes: z.string().optional(),
  // Rich-text "overview note" (PlateJS). Stored as BOTH HTML (for render) and
  // Markdown (source of truth / round-trip). Both optional; only sent when set.
  overviewNoteHtml: z.string().optional(),
  overviewNoteMarkdown: z.string().optional(),
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
  types?: string[] | null;
  primaryType?: string | null;
  businessStatus?: string | null;
}

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
  // Collect ALL 5-digit numbers (optionally +4) and return the LAST one. A
  // non-global first match can grab a 5-digit street number (e.g. "10123 Lark
  // Ave, Los Gatos, CA 95032" → "10123"); in US formatted addresses the ZIP is
  // the trailing 5-digit group, so the last match is the correct one.
  const matches = [...formattedAddress.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
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

  return mapped;
}

// ─── formatOpeningHours ───────────────────────────────────────────────────────

const WEEKDAY_PREFIXES = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const WEEKEND_PREFIXES = ["saturday", "sunday"];

/**
 * Turn Google `regularOpeningHours.weekdayDescriptions` (an array of 7 strings
 * like "Monday: 9 AM–5 PM", "Saturday: Closed") into the two free-text hour
 * fields our store schema stores plus an `isOpenWeekends` flag.
 *
 * - weekdayHours: Mon–Fri rows joined with "\n" (one row per line).
 * - weekendHours: Sat/Sun rows joined with "\n".
 * - isOpenWeekends: true when EITHER Sat or Sun is present and not "Closed".
 *
 * Robust to any ordering and to missing days — we match by the day-name prefix
 * rather than array index. Returns empty strings when nothing is available.
 */
export function formatOpeningHours(
  regularOpeningHours?: OpeningHours | null,
): { weekdayHours: string; weekendHours: string; isOpenWeekends: boolean } {
  const descriptions = regularOpeningHours?.weekdayDescriptions ?? [];
  const weekdayRows: string[] = [];
  const weekendRows: string[] = [];
  let isOpenWeekends = false;

  for (const row of descriptions) {
    const lower = row.toLowerCase();
    if (WEEKDAY_PREFIXES.some((d) => lower.startsWith(d))) {
      weekdayRows.push(row);
    } else if (WEEKEND_PREFIXES.some((d) => lower.startsWith(d))) {
      weekendRows.push(row);
      // "Closed" in any casing means that weekend day is not open.
      if (!/closed/i.test(row)) isOpenWeekends = true;
    }
  }

  return {
    weekdayHours: weekdayRows.join("\n"),
    weekendHours: weekendRows.join("\n"),
    isOpenWeekends,
  };
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
  types: string[],
  primaryType?: string,
): string[] {
  const haystack = [...types, primaryType ?? ""].join(" ").toLowerCase();
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
