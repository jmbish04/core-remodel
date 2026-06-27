/**
 * @fileoverview home-catalog.ts
 *
 * Seeds and retrieves the canonical home floor + room catalog from D1.
 *
 * IMPORTANT (0005 update): DEFAULT_ROOMS now encodes the FINAL post-reconciliation
 * room codes, names, and floorplan coordinates from IMPLEMENTATION_PLAN §4.2.
 * `ensureHomeCatalogSeed` uses `onConflictDoNothing` on `room_code`, so it will
 * NOT recreate old drift rooms or overwrite the reconciled rows.  A future re-seed
 * starting from an empty DB will produce the correct canonical set directly.
 *
 * Rooms that should NOT be seeded (they are created by reconciliation or are
 * deactivated): lower-storage, upper-bath-2, upper-deck, and all drift codes.
 * The upper-dining-room is created by the data-fix script and is included in
 * this seed so a fresh DB also gets it.
 *
 * Coordinate system:
 *   floorplanXPct 0 = left edge of floorplan image
 *   floorplanXPct 100 = right edge
 *   floorplanYPct 0 = top (back of house / bedrooms)
 *   floorplanYPct 100 = bottom (street / kitchen)
 *   null x/y = no dot; room appears in "Outside / Unplaced" sidebar group only
 *
 * --- C1 (0005 REVISIONS) — is_active filter ---
 * getHomeCatalog filters to is_active = true for both the floors-with-rooms
 * response and the flat rooms array.  Inactive (soft-deleted / merged-away) rooms
 * are invisible to all callers.  The seed also sets is_active=true on every
 * freshly inserted room (the column default).
 *
 * --- T2.1 enrichment (Phase 2, floor-plan page) ---
 * getHomeCatalog now returns per-room aggregate stats so the floor-plan dot
 * hover-card needs no additional fetches:
 *   - listingCount    — count of images WHERE photo_category='listing' AND room_id=this
 *   - inspirationCount — count of inspirational_image_rooms WHERE room_id=this
 *   - heroImageUrl    — representative image delivery URL resolved via the
 *                       REVISED fallback chain (C3 — 0005 REVISIONS):
 *                         1. room_ai_summaries.representativeImageId → IF it is a listing image
 *                         2. first listing image for the room
 *                         3. null — NO inspiration fallback (C3 mandate)
 *                       Hero is ALWAYS a listing photo or null.  An inspiration photo
 *                       must never be a hero candidate, even if the room has 0 listing photos.
 *   - dimensions      — formatted string from formatRoomDimensions ("15'0\" x 24'10\"")
 *   - sqft            — (lengthFeet + lengthInches/12) * (widthFeet + widthInches/12),
 *                       rounded to integer, or null if dims are absent
 *
 * All counts are computed with two grouped SQL queries (one for listing, one for
 * inspiration) and targeted queries for summaries + hero images — never N+1.
 */

import { floors, images, inspirationalImageRooms, roomAiSummaries, rooms } from "@backend/db";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

interface SeedFloor {
  key: string;
  name: string;
  levelOrder: number;
  livingSqFt: number | null;
}

interface SeedRoom {
  floorKey: string;
  roomCode: string;
  roomName: string;
  asIsUse: string;
  lengthFeet: number | null;
  lengthInches: number | null;
  widthFeet: number | null;
  widthInches: number | null;
  /**
   * Explicit square-footage override (0006 P1) for irregular / non-rectangular
   * rooms whose length × width estimate is wrong.  Optional — omit for rooms whose
   * rectangular estimate is fine.  Backfilled onto existing rows (see
   * _doSeedHomeCatalog) since the seed insert uses onConflictDoNothing.
   */
  areaSqFt?: number | null;
  isLivingSpace: boolean;
  /** Floorplan canvas identifier (matches floors.key). null = sidebar-only room. */
  floorplanFloorKey: string | null;
  /** Horizontal position on the floorplan image, 0–100. null = no dot. */
  floorplanXPct: number | null;
  /** Vertical position on the floorplan image, 0–100. null = no dot. */
  floorplanYPct: number | null;
}

/**
 * Canonical floor definitions.
 * The "outside" and "all_levels" floors were present in the live DB with
 * ids 233121 and 233122 respectively — they are seeded by a prior migration/seed
 * and are included here for completeness.  onConflictDoNothing keeps it safe.
 */
const DEFAULT_FLOORS: SeedFloor[] = [
  {
    key: "lower_level",
    name: "Lower Level",
    levelOrder: 1,
    livingSqFt: 763,
  },
  {
    key: "upper_level",
    name: "Upper Level",
    levelOrder: 2,
    livingSqFt: 1429,
  },
  {
    key: "outside",
    name: "Outside",
    levelOrder: 3,
    livingSqFt: null,
  },
  {
    key: "all_levels",
    name: "All Levels",
    levelOrder: 4,
    livingSqFt: null,
  },
];

/**
 * Final canonical room set (post 0005 reconciliation).
 * Ordered: lower level → upper level → outside.
 * Coordinates match §4.2 of IMPLEMENTATION_PLAN.
 *
 * Rules:
 *   - Room codes are all kebab-case slugs.
 *   - Drift rooms (snake_case like `kitchen`, `family_room`) do NOT appear here.
 *   - Deleted rooms (lower-storage, upper-bath-2, upper-deck) do NOT appear here.
 *   - onConflictDoNothing means running this seed twice is safe.
 */
const DEFAULT_ROOMS: SeedRoom[] = [
  // -------------------------------------------------------------------------
  // LOWER LEVEL
  // -------------------------------------------------------------------------
  {
    floorKey: "lower_level",
    roomCode: "lower-guest-bedroom",
    roomName: "Guest Bedroom",
    asIsUse: "Bedroom",
    lengthFeet: 11,
    lengthInches: 11,
    widthFeet: 13,
    widthInches: 7,
    isLivingSpace: true,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 33,
    floorplanYPct: 28,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-family-room",
    roomName: "Family Room",
    asIsUse: "Family Room",
    lengthFeet: 11,
    lengthInches: 9,
    widthFeet: 22,
    widthInches: 6,
    isLivingSpace: true,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 18,
    floorplanYPct: 34,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-guest-bath",
    roomName: "Guest Bath",
    asIsUse: "Bath",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: true,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 34,
    floorplanYPct: 43,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-laundry",
    roomName: "Laundry",
    asIsUse: "Laundry",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: false,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 26,
    floorplanYPct: 49,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-garage",
    roomName: "Garage",
    asIsUse: "Garage",
    lengthFeet: 18,
    lengthInches: 2,
    widthFeet: 21,
    widthInches: 9,
    isLivingSpace: false,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 25,
    floorplanYPct: 77,
  },
  {
    floorKey: "lower_level",
    roomCode: "street-front-door",
    roomName: "Front Door / Street",
    asIsUse: "Entryway",
    lengthFeet: 5,
    lengthInches: 8,
    widthFeet: 11,
    widthInches: 5,
    isLivingSpace: false,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 7,
    floorplanYPct: 89,
  },
  {
    floorKey: "lower_level",
    roomCode: "lower-foyer",
    roomName: "Foyer",
    asIsUse: "Entry / Foyer",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    // L-shaped footprint — its true area is not length × width.  0006 P1 seed.
    areaSqFt: 77.28,
    isLivingSpace: true,
    floorplanFloorKey: "lower_level",
    floorplanXPct: 7,
    floorplanYPct: 52,
  },
  // -------------------------------------------------------------------------
  // OUTSIDE / EXTERIOR
  // -------------------------------------------------------------------------
  {
    floorKey: "outside",
    roomCode: "outside-patio",
    roomName: "Patio",
    asIsUse: "Patio",
    lengthFeet: 23,
    lengthInches: 6,
    widthFeet: 9,
    widthInches: 8,
    isLivingSpace: false,
    floorplanFloorKey: "outside",
    floorplanXPct: 27,
    floorplanYPct: 10,
  },
  {
    floorKey: "outside",
    roomCode: "outside-backyard",
    roomName: "Backyard",
    asIsUse: "Backyard",
    lengthFeet: 25,
    lengthInches: 0,
    widthFeet: 60,
    widthInches: 0,
    isLivingSpace: false,
    // No dot — shown in sidebar "Outside" group only.
    floorplanFloorKey: "outside",
    floorplanXPct: null,
    floorplanYPct: null,
  },
  // -------------------------------------------------------------------------
  // UPPER LEVEL
  // -------------------------------------------------------------------------
  {
    floorKey: "upper_level",
    roomCode: "primary-bedroom",
    roomName: "Primary Bedroom",
    asIsUse: "Primary Bedroom",
    lengthFeet: 11,
    lengthInches: 11,
    widthFeet: 13,
    widthInches: 7,
    isLivingSpace: true,
    floorplanFloorKey: "upper_level",
    floorplanXPct: 82,
    floorplanYPct: 21,
  },
  {
    floorKey: "upper_level",
    roomCode: "jason-office",
    roomName: "Jason's Office",
    asIsUse: "Bedroom",
    lengthFeet: 12,
    lengthInches: 0,
    widthFeet: 13,
    widthInches: 4,
    isLivingSpace: true,
    // Coordinate from upper-bedroom-3's old position (U3 spec: coord swap)
    floorplanFloorKey: "upper_level",
    floorplanXPct: 66,
    floorplanYPct: 52,
  },
  {
    floorKey: "upper_level",
    roomCode: "justin-office",
    roomName: "Justin's Office",
    asIsUse: "Bedroom",
    lengthFeet: 11,
    lengthInches: 10,
    widthFeet: 10,
    widthInches: 7,
    isLivingSpace: true,
    // Coordinate from upper-bedroom-2's old position (U4 spec: coord swap)
    floorplanFloorKey: "upper_level",
    floorplanXPct: 64,
    floorplanYPct: 21,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-living-room",
    roomName: "Living Room",
    asIsUse: "Living Room",
    lengthFeet: 15,
    lengthInches: 0,
    widthFeet: 24,
    widthInches: 10,
    isLivingSpace: true,
    floorplanFloorKey: "upper_level",
    floorplanXPct: 84,
    floorplanYPct: 72,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-dining-room",
    roomName: "Dining Room",
    asIsUse: "Dining Room",
    // Dimensions not separately measured; this room was split from upper-living-dining.
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: true,
    // User-specified: same X axis as upper-living-room, mid quad-2 (between stair-landing & living-room).
    floorplanFloorKey: "upper_level",
    floorplanXPct: 84,
    floorplanYPct: 62,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-kitchen",
    roomName: "Kitchen",
    asIsUse: "Kitchen / Breakfast Nook",
    lengthFeet: 8,
    lengthInches: 9,
    widthFeet: 18,
    widthInches: 3,
    isLivingSpace: true,
    // Moved left from (70,76) to (65,76) per spec U7.
    floorplanFloorKey: "upper_level",
    floorplanXPct: 65,
    floorplanYPct: 76,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-hall-bath",
    roomName: "Hall Bath",
    asIsUse: "Bath",
    lengthFeet: 5,
    lengthInches: 4,
    widthFeet: 11,
    widthInches: 3,
    isLivingSpace: true,
    // Moved up from (64,37) to (64,32) per spec U6.
    floorplanFloorKey: "upper_level",
    floorplanXPct: 64,
    floorplanYPct: 32,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-lightwell",
    roomName: "Lightwell",
    asIsUse: "Lightwell",
    lengthFeet: 10,
    lengthInches: 2,
    widthFeet: 3,
    widthInches: 11,
    isLivingSpace: false,
    floorplanFloorKey: "upper_level",
    floorplanXPct: 67,
    floorplanYPct: 39,
  },
  {
    floorKey: "upper_level",
    roomCode: "upper-stair-landing",
    roomName: "Stair Landing",
    asIsUse: "Workshop / Stair Landing",
    lengthFeet: 10,
    lengthInches: 11,
    widthFeet: 7,
    widthInches: 6,
    isLivingSpace: false,
    floorplanFloorKey: "upper_level",
    floorplanXPct: 78,
    floorplanYPct: 49,
  },
  {
    floorKey: "upper_level",
    roomCode: "primary-bathroom",
    roomName: "Primary Bathroom",
    asIsUse: "Primary Bathroom",
    lengthFeet: null,
    lengthInches: null,
    widthFeet: null,
    widthInches: null,
    isLivingSpace: true,
    // Coordinate from upper-bath-2 (coord donor, U2b).
    floorplanFloorKey: "upper_level",
    floorplanXPct: 88,
    floorplanYPct: 39,
  },
];

let _catalogSeeded: Promise<void> | null = null;

/**
 * Ensure the home catalog floor + room seed has been applied.
 * Idempotent — safe to call on every request startup.
 * Uses onConflictDoNothing so it won't overwrite reconciled data.
 */
export async function ensureHomeCatalogSeed(env: Env): Promise<void> {
  if (_catalogSeeded) return _catalogSeeded;

  _catalogSeeded = _doSeedHomeCatalog(env).catch((err) => {
    // Allow retry on failure.
    _catalogSeeded = null;
    throw err;
  });

  return _catalogSeeded;
}

async function _doSeedHomeCatalog(env: Env): Promise<void> {
  const db = drizzle(env.DB);

  for (const floor of DEFAULT_FLOORS) {
    await db
      .insert(floors)
      .values({
        key: floor.key,
        name: floor.name,
        levelOrder: floor.levelOrder,
        livingSqFt: floor.livingSqFt,
      })
      .onConflictDoNothing()
      .run();
  }

  const existingFloors = await db.select().from(floors).all();
  const floorIdByKey = new Map(existingFloors.map((floor) => [floor.key, floor.id]));

  for (const room of DEFAULT_ROOMS) {
    const floorId = floorIdByKey.get(room.floorKey);
    if (!floorId) {
      continue;
    }
    await db
      .insert(rooms)
      .values({
        floorId,
        roomCode: room.roomCode,
        roomName: room.roomName,
        asIsUse: room.asIsUse,
        lengthFeet: room.lengthFeet,
        lengthInches: room.lengthInches,
        widthFeet: room.widthFeet,
        widthInches: room.widthInches,
        areaSqFt: room.areaSqFt ?? null,
        isLivingSpace: room.isLivingSpace,
        floorplanFloorKey: room.floorplanFloorKey,
        floorplanXPct: room.floorplanXPct,
        floorplanYPct: room.floorplanYPct,
      })
      .onConflictDoNothing()
      .run();
  }

  // ── 0006 P1: backfill explicit area overrides onto already-seeded rows ──────
  //
  // The insert loop above uses onConflictDoNothing, so a room that already exists
  // (e.g. the live `lower-foyer`) never receives the seed's new `areaSqFt`.  Apply
  // any DEFAULT_ROOMS areaSqFt to existing rows that don't have one yet.  The
  // `IS NULL` guard keeps this idempotent and never clobbers a value the owner has
  // since entered by hand.
  for (const room of DEFAULT_ROOMS) {
    if (typeof room.areaSqFt !== "number") continue;
    await db
      .update(rooms)
      .set({ areaSqFt: room.areaSqFt })
      .where(and(eq(rooms.roomCode, room.roomCode), isNull(rooms.areaSqFt)))
      .run();
  }
}

// ---------------------------------------------------------------------------
// Dimension helpers (T2.1 — used by getHomeCatalog enrichment below)
// ---------------------------------------------------------------------------

/**
 * Format a room's dimensions into a human-readable string such as "15'0\" x 24'10\"".
 * Returns null when neither length nor width is set.
 *
 * This mirrors the `formatRoomDimensions` helper in rooms.ts so the catalog
 * response can include the formatted label without requiring a separate detail fetch.
 */
function formatRoomDimensions(
  room: Pick<
    typeof rooms.$inferSelect,
    "lengthFeet" | "lengthInches" | "widthFeet" | "widthInches"
  >,
): string | null {
  const lengthSet =
    typeof room.lengthFeet === "number" || typeof room.lengthInches === "number";
  const widthSet =
    typeof room.widthFeet === "number" || typeof room.widthInches === "number";
  if (!lengthSet && !widthSet) return null;

  const formatSide = (feet: number | null, inches: number | null): string => {
    const feetValue = typeof feet === "number" ? feet : 0;
    const inchesValue = typeof inches === "number" ? inches : 0;
    return `${feetValue}'${inchesValue}"`;
  };

  if (lengthSet && widthSet) {
    return `${formatSide(room.lengthFeet, room.lengthInches)} x ${formatSide(room.widthFeet, room.widthInches)}`;
  }
  if (lengthSet) {
    return formatSide(room.lengthFeet, room.lengthInches);
  }
  return formatSide(room.widthFeet, room.widthInches);
}

/**
 * Resolve a room's square footage.
 *
 * 0006 P1: an explicit `areaSqFt` override always wins — irregular / L-shaped rooms
 * (e.g. the lower foyer = 77.28) store their true area there and it is returned
 * verbatim (not rounded), so the real value surfaces everywhere the catalog `sqft`
 * field is consumed.  When no override is set, fall back to the rectangular estimate:
 * (lengthFeet + lengthInches/12) * (widthFeet + widthInches/12), rounded.
 * Returns null when neither an override nor a full length+width pair is present.
 */
function computeRoomSqft(
  room: Pick<
    typeof rooms.$inferSelect,
    "lengthFeet" | "lengthInches" | "widthFeet" | "widthInches" | "areaSqFt"
  >,
): number | null {
  // Authoritative override (irregular footprints) takes precedence over any math.
  if (typeof room.areaSqFt === "number") {
    return room.areaSqFt;
  }

  const lengthSet =
    typeof room.lengthFeet === "number" || typeof room.lengthInches === "number";
  const widthSet =
    typeof room.widthFeet === "number" || typeof room.widthInches === "number";
  // Both dimensions must be present to compute a meaningful area.
  if (!lengthSet || !widthSet) return null;

  const lengthFt = (typeof room.lengthFeet === "number" ? room.lengthFeet : 0) +
    (typeof room.lengthInches === "number" ? room.lengthInches / 12 : 0);
  const widthFt = (typeof room.widthFeet === "number" ? room.widthFeet : 0) +
    (typeof room.widthInches === "number" ? room.widthInches / 12 : 0);

  if (lengthFt <= 0 || widthFt <= 0) return null;
  return Math.round(lengthFt * widthFt);
}

/**
 * Resolve a Cloudflare Images delivery URL from an image row.
 *
 * The `cfImageIdOptimized` and `cfImageIdOriginal` fields already contain the
 * full delivery token in the form "<accountHash>/<imageId>".  When one of those
 * tokens is present the URL is:
 *   https://imagedelivery.net/<token>/public
 *
 * If the field is itself a full URL (starts with "http") it is returned verbatim.
 * Returns null when neither field is populated or the token has no "/" separator
 * (which would mean it is just a bare image id with no account hash — not a valid
 * delivery token we can construct a URL from).
 */
function resolveDeliveryUrl(
  image: Pick<typeof images.$inferSelect, "cfImageIdOptimized" | "cfImageIdOriginal"> | null | undefined,
): string | null {
  if (!image) return null;
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return null;
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  // A valid delivery token must contain "/" separating accountHash from imageId.
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public catalog query (T2.1 enriched)
// ---------------------------------------------------------------------------

/**
 * Return the full home catalog: all floors with their rooms, enriched with
 * per-room aggregate stats required by the floor-plan dot hover card.
 *
 * C1 (0005 REVISIONS): only is_active=true rooms are returned.  Inactive
 * (soft-deleted / merged-away) rooms are invisible to all callers.
 *
 * Enriched fields per room (T2.1):
 *   listingCount      — count of images WHERE photo_category='listing' AND room_id=<id>
 *   inspirationCount  — count of inspirational_image_rooms WHERE room_id=<id>
 *   heroImageUrl      — delivery URL resolved via the REVISED fallback chain (C3):
 *                         1. room_ai_summaries.representativeImageId → ONLY if it is
 *                            a listing image (photo_category='listing')
 *                         2. first listing image for the room
 *                         3. null — NO inspiration fallback (C3 mandate)
 *                       A room with 0 listing photos returns heroImageUrl=null.
 *                       The caller should render a placeholder in that case.
 *   dimensions        — human-readable formatted string or null
 *   sqft              — integer area rounded from feet+inches, or null
 *
 * All aggregate counts are fetched in two grouped queries (not N+1).
 * Hero resolution uses: one summary query + one listing image query.  The
 * inspiration-fallback query block has been removed entirely (C3).
 */
export async function getHomeCatalog(env: Env) {
  const db = drizzle(env.DB);

  // ── 1. Fetch floors and rooms (active only — C1) ─────────────────────────
  const [floorRows, roomRows] = await Promise.all([
    db.select().from(floors).orderBy(asc(floors.levelOrder)).all(),
    db
      .select()
      .from(rooms)
      // C1: filter to is_active = true; inactive (merged/soft-deleted) rooms are hidden.
      .where(eq(rooms.isActive, true))
      .orderBy(asc(rooms.floorId), asc(rooms.id))
      .all(),
  ]);

  const roomIds = roomRows.map((r) => r.id);

  // ── 2. Aggregate counts (two grouped queries, not N+1) ───────────────────
  //
  // listing count: images WHERE photo_category='listing' GROUP BY room_id
  // inspiration count: inspirational_image_rooms GROUP BY room_id
  //
  // We skip the queries when roomIds is empty (fresh/empty DB) to avoid
  // a D1 "empty IN" error.

  const [listingCountRows, inspirationCountRows] = await Promise.all([
    roomIds.length > 0
      ? db
          .select({ roomId: images.roomId, cnt: count(images.id) })
          .from(images)
          .where(
            and(
              eq(images.photoCategory, "listing"),
              inArray(images.roomId, roomIds),
            ),
          )
          .groupBy(images.roomId)
          .all()
      : Promise.resolve([] as Array<{ roomId: number | null; cnt: number }>),
    roomIds.length > 0
      ? db
          .select({ roomId: inspirationalImageRooms.roomId, cnt: count(inspirationalImageRooms.id) })
          .from(inspirationalImageRooms)
          .where(inArray(inspirationalImageRooms.roomId, roomIds))
          .groupBy(inspirationalImageRooms.roomId)
          .all()
      : Promise.resolve([] as Array<{ roomId: number; cnt: number }>),
  ]);

  // Build fast lookup maps: roomId → count.
  const listingCountByRoomId = new Map<number, number>();
  for (const row of listingCountRows) {
    if (typeof row.roomId === "number") {
      listingCountByRoomId.set(row.roomId, row.cnt);
    }
  }
  const inspirationCountByRoomId = new Map<number, number>();
  for (const row of inspirationCountRows) {
    inspirationCountByRoomId.set(row.roomId, row.cnt);
  }

  // ── 3. Hero image resolution (C3 — revised, listing-only) ──────────────────
  //
  // C3 mandate (0005 REVISIONS): hero is ALWAYS a listing photo or null.
  // The inspiration fallback step has been removed entirely.
  //
  // Priority chain:
  //   a) room_ai_summaries.representativeImageId — ONLY when that image has
  //      photo_category = 'listing'.  If the representativeImageId points to an
  //      inspiration photo, it is skipped and we fall to (b).
  //   b) first listing photo for the room (photo_category='listing').
  //   c) null — room has 0 listing photos; caller renders a placeholder.
  //
  // Approach to avoid N+1:
  //   i.  Fetch all room_ai_summaries in one query → collect representativeImageIds.
  //   ii. Fetch those specific image rows in one query; only accept rows whose
  //       photo_category = 'listing'.
  //   iii.Fetch all listing images for the room set in one query (used as fallback
  //       and as the listing count source).  Pick first-per-room in JS.
  //   No inspiration query at all (C3).

  const [summaryRows, listingImageRows] = await Promise.all([
    roomIds.length > 0
      ? db
          .select({
            roomId: roomAiSummaries.roomId,
            representativeImageId: roomAiSummaries.representativeImageId,
          })
          .from(roomAiSummaries)
          .where(inArray(roomAiSummaries.roomId, roomIds))
          .all()
      : Promise.resolve([] as Array<{ roomId: number; representativeImageId: string | null }>),
    // Fetch ALL listing images for the active room set in one query.
    // Filtered to photo_category='listing' so inspirational/ai_render images are
    // completely excluded from the hero resolution chain.
    roomIds.length > 0
      ? db
          .select({
            id: images.id,
            roomId: images.roomId,
            photoCategory: images.photoCategory,
            cfImageIdOptimized: images.cfImageIdOptimized,
            cfImageIdOriginal: images.cfImageIdOriginal,
          })
          .from(images)
          .where(
            and(
              eq(images.photoCategory, "listing"),
              inArray(images.roomId, roomIds),
            ),
          )
          .all()
      : Promise.resolve(
          [] as Array<{
            id: string;
            roomId: number | null;
            photoCategory: string;
            cfImageIdOptimized: string | null;
            cfImageIdOriginal: string;
          }>,
        ),
  ]);

  // Build map: roomId → representativeImageId (from room_ai_summaries).
  const representativeImageIdByRoomId = new Map<number, string>();
  for (const row of summaryRows) {
    if (row.representativeImageId) {
      representativeImageIdByRoomId.set(row.roomId, row.representativeImageId);
    }
  }

  // Collect representative image IDs we need to resolve — fetch in one query.
  const repImageIds = Array.from(new Set(representativeImageIdByRoomId.values()));

  // Fetch image rows for representative images.
  // C3: only accept the row if photo_category = 'listing'.
  // We fetch all candidate rows and filter in JS to avoid a complex WHERE.
  const repImageRows =
    repImageIds.length > 0
      ? await db
          .select({
            id: images.id,
            photoCategory: images.photoCategory,
            cfImageIdOptimized: images.cfImageIdOptimized,
            cfImageIdOriginal: images.cfImageIdOriginal,
          })
          .from(images)
          .where(inArray(images.id, repImageIds))
          .all()
      : [];

  // Only keep listing representative images (C3 — discard inspiration ones).
  const repImageById = new Map(
    repImageRows
      .filter((r) => r.photoCategory === "listing")
      .map((r) => [r.id, r]),
  );

  // Build: roomId → first listing image row (for the fallback).
  // listingImageRows is already filtered to photo_category='listing'.
  // Iterating in query order gives us the first encountered row per room.
  const firstListingImageByRoomId = new Map<
    number,
    { id: string; cfImageIdOptimized: string | null; cfImageIdOriginal: string }
  >();
  for (const img of listingImageRows) {
    if (typeof img.roomId === "number" && !firstListingImageByRoomId.has(img.roomId)) {
      firstListingImageByRoomId.set(img.roomId, img);
    }
  }

  // C3 note: the inspiration fallback block that previously appeared here has been
  // removed.  A room with 0 listing photos returns heroImageUrl=null.  The caller
  // (FloorplanGalleryApp, HeroHeader, RoomViewApp) must render a placeholder.

  // ── 4. Build displayName (duplicate-name disambiguation) ─────────────────
  const roomCountsByFloorAndName = new Map<string, number>();
  for (const room of roomRows) {
    const key = `${room.floorId}::${room.roomName.toLowerCase()}`;
    roomCountsByFloorAndName.set(key, (roomCountsByFloorAndName.get(key) || 0) + 1);
  }

  const roomIndexByFloorAndName = new Map<string, number>();

  // ── 5. Assemble per-floor room arrays ────────────────────────────────────
  const roomsByFloorId = new Map<number, Array<EnrichedCatalogRoom>>();

  for (const room of roomRows) {
    // Display-name disambiguator (unchanged from prior implementation).
    const nameKey = `${room.floorId}::${room.roomName.toLowerCase()}`;
    const currentIndex = (roomIndexByFloorAndName.get(nameKey) || 0) + 1;
    roomIndexByFloorAndName.set(nameKey, currentIndex);
    const totalWithSameName = roomCountsByFloorAndName.get(nameKey) || 1;
    const displayName =
      totalWithSameName > 1 ? `${room.roomName} ${currentIndex}` : room.roomName;

    // --- Counts ---
    const listingCount = listingCountByRoomId.get(room.id) ?? 0;
    const inspirationCount = inspirationCountByRoomId.get(room.id) ?? 0;

    // --- Hero URL (C3-revised listing-only chain) ---
    //
    // Attempt a: representativeImageId from room_ai_summaries — ONLY if listing.
    //   repImageById already excludes non-listing representative images (filtered above).
    // Attempt b: first listing image for the room.
    // Attempt c: null — no listing photo; caller renders a placeholder.
    //
    // Inspiration photos are NEVER considered for the hero (C3 mandate).
    let heroImageUrl: string | null = null;

    // Attempt a: user-chosen representative listing image.
    const repId = representativeImageIdByRoomId.get(room.id);
    if (repId) {
      const repImg = repImageById.get(repId); // null if non-listing (filtered out)
      heroImageUrl = resolveDeliveryUrl(repImg ?? null);
    }

    // Attempt b: first listing image (fallback when no valid representative).
    if (!heroImageUrl) {
      const listingImg = firstListingImageByRoomId.get(room.id);
      heroImageUrl = resolveDeliveryUrl(listingImg ?? null);
    }

    // Attempt c (implicit): heroImageUrl remains null — room has no listing photos.

    // --- Dimensions + sqft ---
    const dimensions = formatRoomDimensions(room);
    const sqft = computeRoomSqft(room);

    const enrichedRoom: EnrichedCatalogRoom = {
      ...room,
      displayName,
      listingCount,
      inspirationCount,
      heroImageUrl,
      dimensions,
      sqft,
    };

    if (!roomsByFloorId.has(room.floorId)) {
      roomsByFloorId.set(room.floorId, []);
    }
    roomsByFloorId.get(room.floorId)!.push(enrichedRoom);
  }

  return {
    // C1: floors array only includes floors that have at least one active room.
    // Floors with no active rooms (e.g. "all_levels" pseudo-floor) are still
    // present here for completeness — they may have zero rooms but are useful
    // for scope display.  The filter is on the rooms list within each floor.
    floors: floorRows.map((floor) => ({
      id: floor.id,
      key: floor.key,
      name: floor.name,
      levelOrder: floor.levelOrder,
      // Only active rooms are in roomsByFloorId (the query above filtered is_active=true).
      rooms: roomsByFloorId.get(floor.id) ?? [],
    })),
    // Backward-compatible flat rooms array (active-only, keeps existing callers working).
    // C1: roomRows was already fetched with WHERE is_active=true.
    rooms: roomRows,
  };
}

/**
 * Shape of a single enriched room entry in the catalog response.
 * Exported so that the frontend and test code can reference the type without
 * re-deriving it from the query return type.
 *
 * Backward-compatible: all fields present in the pre-T2.1 catalog are still
 * present verbatim.  New fields are additive.
 */
export type EnrichedCatalogRoom = typeof rooms.$inferSelect & {
  /** Human-readable display name with disambiguation suffix when names collide on the same floor. */
  displayName: string;
  /** Count of images WHERE photo_category='listing' AND room_id=this. */
  listingCount: number;
  /** Count of inspirational_image_rooms WHERE room_id=this. */
  inspirationCount: number;
  /**
   * Cloudflare Images delivery URL for the representative/hero listing image.
   *
   * C3 (0005 REVISIONS): resolved via the LISTING-ONLY chain:
   *   1. room_ai_summaries.representativeImageId (only if photo_category='listing')
   *   2. first listing image for the room
   *   3. null — room has no listing photos; render a placeholder
   *
   * Inspiration photos are NEVER a hero candidate.
   */
  heroImageUrl: string | null;
  /**
   * Formatted dimension string such as "15'0\" x 24'10\"" or a one-side-only
   * string when only length or width is set.  null when no dimensions are stored.
   */
  dimensions: string | null;
  /**
   * Approximate square footage rounded to the nearest integer.
   * Computed as (lengthFeet + lengthInches/12) * (widthFeet + widthInches/12).
   * null when either the length or width dimension set is absent.
   */
  sqft: number | null;
};

/**
 * Return a single active room by its numeric id.
 * Returns undefined when the room does not exist or is inactive (C1).
 */
export async function getRoomById(env: Env, roomId: number) {
  const db = drizzle(env.DB);
  return db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.isActive, true)))
    .get();
}
