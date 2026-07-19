/**
 * @fileoverview Showroom Scout — structured output contracts (Zod v4).
 *
 * These are the shapes the model is REQUIRED to emit. Two rules encoded here:
 *
 *  1. Verified vs. inferred. Fields the agent read off a real source carry a
 *     `sourceUrls` trail; fields it concluded are marked `inferred`. The UI and
 *     the user must be able to tell "their site says Sat 10–4" from "probably
 *     open Saturdays". Never collapse the two.
 *  2. No silent nulls. Where data is genuinely unavailable the agent says so
 *     explicitly (`"unknown"`) rather than omitting the field, so a gap is
 *     visible instead of looking like a negative finding.
 */
import { z } from "zod";

/** Sourcing categories this version understands. */
export const PLACE_CATEGORIES = [
  "plumbing_fixtures",
  "kitchen",
  "bathroom",
  "light_fixtures",
  "paint_wallpaper",
  "tile",
  "flooring",
  "landscaping",
  "windows",
  "interior_doors",
  "exterior_doors",
  "cabinet_hardware",
  "door_hardware",
  "hvac",
  "cabinets",
  "stone_yard",
  "stone_manufacturer",
  "concrete_microcement_epoxy",
  "pavers_gravel",
  "exterior_facade",
] as const;

export const SHOWROOM_TYPES = [
  "locally_owned",
  "bespoke",
  "corporate_showroom",
  "wholesaler",
  "clearance",
  "contractor_showroom",
  "big_box",
] as const;

/** Qualitative character read off reviews — drives "worth the drive". */
export const CHARACTER_TAGS = [
  "inspirational",
  "transactional",
  "design_forward",
  "contractor_oriented",
  "overpriced",
  "high_service",
  "disorganized",
] as const;

export const hoursLineSchema = z.object({
  weekday: z.string().describe("Mon–Fri hours as published, or 'unknown'"),
  saturday: z.string().describe("Saturday hours as published, or 'unknown'"),
  sunday: z.string().describe("Sunday hours as published, or 'unknown'"),
  verified: z.boolean().describe("true only if read from the showroom's own site or Places data"),
});

export const socialsSchema = z.object({
  instagram: z.string().nullable(),
  pinterest: z.string().nullable(),
  facebook: z.string().nullable(),
  tiktok: z.string().nullable(),
  other: z.array(z.string()),
});

/**
 * Review synthesis. `worthTheDrive` is the headline judgment; the theme arrays
 * are the evidence that justifies it.
 */
export const reviewSynthesisSchema = z.object({
  worthTheDrive: z.enum(["yes", "conditional", "no", "unknown"]),
  worthTheDriveReason: z.string().describe("One or two sentences, specific, evidence-based"),
  positiveThemes: z.array(z.string()).describe("Strongest recurring positives across sources"),
  negativeThemes: z.array(z.string()).describe("Strongest recurring negatives — do not omit these"),
  character: z.array(z.enum(CHARACTER_TAGS)),
  sources: z
    .array(z.enum(["yelp", "google_maps", "reddit", "bbb", "houzz", "own_site", "other"]))
    .describe("Which source families the evidence came from"),
  sourceUrls: z.array(z.string()),
});

/**
 * Contractor-showroom disclosure. The spec calls this out specifically: a
 * showroom attached to a design-build firm may only be visitable if you intend
 * to hire them, which changes whether it belongs on a sourcing route at all.
 */
export const contractorTieSchema = z.object({
  isContractorShowroom: z.boolean(),
  tie: z
    .enum(["requires_using_contractor", "separately_visitable", "unclear"])
    .describe("Use 'unclear' rather than guessing — this drives a call-ahead"),
  evidence: z.string().describe("What specifically indicated this, or why it is unclear"),
});

/**
 * Long-tail intelligence. Optional ON PURPOSE.
 *
 * Found live: when every one of these was a required top-level field, the model
 * ran a dedicated search per field per showroom ("… address latitude longitude
 * placeId", "… Yelp reviews", "… Google Maps reviews") and blew the search
 * budget ~2.5x. A required field is an instruction to go find it.
 *
 * These are now fill-if-already-known. The rule in the instructions is explicit:
 * never spend a search to populate them.
 */
export const showroomExtrasSchema = z.object({
  socials: socialsSchema.nullable(),
  imageUrls: z.array(z.string()).describe("Images from the showroom's OWN site"),
  tourUrl: z.string().nullable().describe("Matterport / 360 tour if published"),
  brandsCarried: z.array(z.string()).describe("Verified as carried"),
  brandsLikelySourceable: z.array(z.string()).describe("Inferred — can likely order"),
  onDisplay: z.array(z.string()).describe("What appears physically displayed"),
  tradePositioning: z.string().nullable().describe("Trade-only, trade-friendly, or fully retail"),
  pricingTransparency: z.enum(["public_pricing", "quote_only", "mixed", "unknown"]),
});

/**
 * Core candidate record.
 *
 * Kept deliberately small. Beyond driving the search explosion above, an
 * oversized strict schema also caused Gemini to emit a corrupted function name
 * (`PublishScoutResultCandidatesHours`), failing the publish outright. Schema
 * size is a correctness concern here, not just a cost one — add fields to
 * `extras`, not here.
 */
export const showroomCandidateSchema = z.object({
  name: z.string(),
  categories: z.array(z.enum(PLACE_CATEGORIES)).min(1),
  showroomType: z.enum(SHOWROOM_TYPES),
  websiteUrl: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),

  hours: hoursLineSchema,
  appointmentGuidance: z.string().describe("Walk in, or book? Be concrete."),
  walkInFriendly: z.enum(["yes", "no", "unknown"]),

  contractorTie: contractorTieSchema,
  review: reviewSynthesisSchema,

  /** 0–100, judged against THIS user's stated goal — not generic popularity. */
  aiScore: z.number().min(0).max(100),
  aiRationale: z.string().describe("Why this score, tied to the user's actual goal and the evidence"),

  /** Directory dedupe outcome. */
  knownInDirectory: z.boolean(),
  showroomStoreId: z.number().int().nullable(),

  /** Anything the agent could not verify — surfaced, never hidden. */
  unverified: z.array(z.string()),

  /** Fill only from what you already learned. Never search to populate this. */
  extras: showroomExtrasSchema.nullable(),
});

export type ShowroomCandidate = z.infer<typeof showroomCandidateSchema>;

export const callAheadSchema = z.object({
  stopName: z.string(),
  why: z.string().describe("Why calling changes the outcome"),
  askExactly: z.string().describe("The literal question to ask"),
  decisionAffected: z.string().describe("What you'll do differently based on the answer"),
});

export const foodStopSchema = z.object({
  name: z.string(),
  afterStop: z.string().describe("Insert after this stop"),
  why: z.string(),
  addedMinutes: z.number(),
  onRoute: z.boolean().describe("true = on-path, false = minor detour"),
});

export const detourSchema = z.object({
  name: z.string(),
  betweenStops: z.string().describe("e.g. 'between stop 2 and 3'"),
  extraMinutes: z.number(),
  extraMiles: z.number().nullable(),
  whyDetourNotMainStop: z.string(),
  uniqueValue: z.string(),
});

export const routeStopSchema = z.object({
  order: z.number().int(),
  name: z.string(),
  showroomStoreId: z.number().int().nullable(),
  address: z.string().nullable(),
  etaMinuteOfDay: z.number().describe("California wall clock, minutes from midnight"),
  eta: z.string().describe("Human ETA, e.g. '10:15 AM'"),
  recommendedMinutes: z.number().describe("How long to spend here"),
  departMinuteOfDay: z.number(),
  depart: z.string(),
  driveMinutesToNext: z.number().nullable(),
  whyThisPosition: z.string().describe("Why here in the sequence — hours, traffic, or sourcing logic"),
  timingWarnings: z.array(z.string()).describe("e.g. 'must go first — closes at 3'"),
  /** High-agency arrival script. */
  openingStatement: z.string().describe("Confident, respectful, ready to say on arrival or by phone"),
});

export const routePlanSchema = z.object({
  windowLabel: z.string().describe("How the agent interpreted the time request, in California time"),
  date: z.string(),
  stops: z.array(routeStopSchema),
  detours: z.array(detourSchema),
  foodStops: z.array(foodStopSchema),
  callAheads: z.array(callAheadSchema),
  tradeoffs: z.string().describe("What was sacrificed to make this sequence work"),
});

export type RoutePlan = z.infer<typeof routePlanSchema>;

/** Final structured payload of a scout run. */
export const scoutResultSchema = z.object({
  goalUnderstanding: z.string().describe("Restate the goal + geography + time window as understood"),
  candidates: z.array(showroomCandidateSchema),
  excluded: z
    .array(z.object({ name: z.string(), reason: z.string() }))
    .describe("Big-box, already-known, or vetted-out places — with the reason, so it is auditable"),
  route: routePlanSchema.nullable(),
  degradedTools: z
    .array(z.string())
    .describe("Tools that failed or were unavailable — the run continued without them"),
});

export type ScoutResult = z.infer<typeof scoutResultSchema>;
