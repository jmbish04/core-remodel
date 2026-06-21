/**
 * @fileoverview 0005-reconcile-rooms.ts
 *
 * Feature 0005 — Room Data Reconciliation Script
 * =================================================
 * REVISED (R2) — Merge-into-existing-final model
 *
 * Problem (why this revision is necessary)
 * -----------------------------------------
 * Production now has THREE overlapping room sets because an earlier deploy ran
 * the updated seed (final room codes and IDs 3284726–3284744) BEFORE this
 * reconciliation ran.  The original reconciliation used renameRoom() to convert
 * old IDs (1–20) and ghost IDs (2330293–2330301) to their final codes.  That
 * approach now FAILS with a UNIQUE constraint violation because the final-code
 * room rows already exist.
 *
 * New approach: MERGE-INTO-EXISTING-FINAL
 * ----------------------------------------
 * Instead of renaming an old row into the final code, we:
 *   1. Identify the already-existing final-code row (the TARGET, e.g. id=3284726
 *      for "lower-guest-bedroom").
 *   2. Call mergeRooms(source=old_id, target=final_id) for every OLD and GHOST
 *      room that maps to that final room.  mergeRooms() repoints ALL FK tables
 *      (photos, inspiration mappings, planning tasks, etc.) from source → target,
 *      deduplicates constrained tables, then soft-deletes the source row
 *      (is_active=false).
 *   3. After all merges, set coordinates on any KEPT OLD rooms that have no
 *      final-code counterpart (lower-family-room/id=2, lower-laundry/id=4,
 *      lower-garage/id=6, upper-lightwell/id=18).
 *   4. Soft-deactivate rooms that should not exist in the active set with no merge
 *      needed (lower-storage/id=5, upper-deck/id=20).
 *   5. Run convertInspirationScope() LAST, after the active-room set is final.
 *
 * This script is safe to re-run: every mergeRooms/deactivateRoom call is
 * idempotent (early-returns if source is already gone or inactive, skips
 * rows that are already on the target).
 *
 * Usage (dry run — local D1 only; NEVER --remote during development):
 *   tsx scripts/0005-reconcile-rooms.ts --dry-run
 *
 * Usage (execute against local D1 for testing):
 *   tsx scripts/0005-reconcile-rooms.ts
 *
 * Production execution (orchestrator-gated):
 *   1. wrangler d1 export DB --remote --output=backup-pre-0005-r2.sql
 *   2. Review script output on local first
 *   3. wrangler d1 execute DB --remote --file=scripts/0005-reconcile-rooms.sql
 *   4. Verify counts (see VERIFY section at bottom of .sql file)
 *
 * C1 (REVISIONS) — Soft-delete mandate
 * --------------------------------------
 * All room "deletions" set is_active=false instead of issuing DELETE.
 * Invariant: before setting is_active=false, deactivateRoom() verifies the room
 * has ZERO images.room_id rows AND ZERO inspirational_image_rooms rows.
 *
 * SCOPE CONVERSION (runs last)
 * -----------------------------
 * After all merges + deactivations, convertInspirationScope() promotes historical
 * fan-out inspiration data:
 *   - Image mapped to ALL active rooms across ALL floors → scope='home'
 *   - Image mapped to ALL active rooms on EXACTLY ONE floor → scope='level'
 *   - Otherwise → left as scope='room'
 * Running this AFTER merges ensures "all active rooms" reflects the post-merge
 * canonical set of ~19 rooms.
 *
 * Live ID reference (verified 2026-06-19 against production)
 * -----------------------------------------------------------
 * FINAL targets (already exist with coords, currently 0 listing photos):
 *   lower-guest-bedroom  = 3284726
 *   lower-guest-bath     = 3284728
 *   street-front-door    = 3284731
 *   lower-foyer          = 3284732
 *   outside-patio        = 3284733
 *   outside-backyard     = 3284734
 *   primary-bedroom      = 3284735
 *   jason-office         = 3284736
 *   justin-office        = 3284737
 *   upper-living-room    = 3284738
 *   upper-dining-room    = 3284739
 *   upper-kitchen        = 3284740
 *   upper-hall-bath      = 3284741
 *   upper-stair-landing  = 3284743
 *   primary-bathroom     = 3284744
 *
 * OLD canonical (hold listing photos, no coords):
 *   lower-bedroom-1        = 1   → merge into 3284726
 *   lower-family-room      = 2   → KEPT; merge living_room(2330299) into it; set coords
 *   lower-bath-1           = 3   → merge into 3284728
 *   lower-laundry          = 4   → KEPT; set coords only
 *   lower-storage          = 5   → deactivate (no photos)
 *   lower-garage           = 6   → KEPT; set coords only
 *   lower-entryway         = 7   → split photos; bulk → 3284732, allowlist → 3284731; deactivate
 *   lower-patio            = 8   → merge into 3284733
 *   lower-rear-patio       = 9   → merge into 3284733
 *   lower-backyard         = 10  → merge into 3284734
 *   upper-primary-bedroom  = 11  → merge into 3284735
 *   upper-bedroom-2        = 12  → merge into 3284736
 *   upper-bedroom-3        = 13  → merge into 3284737
 *   upper-living-dining    = 14  → split photos + merge into 3284738 / 3284739 / 3284743; deactivate
 *   upper-kitchen-breakfast= 15  → merge into 3284740
 *   upper-bath-1           = 16  → merge into 3284741
 *   upper-bath-2           = 17  → merge into 3284744 (coord donor)
 *   upper-lightwell        = 18  → KEPT; set coords only
 *   upper-workshop         = 19  → merge into 3284743
 *   upper-deck             = 20  → deactivate (no photos)
 *
 * GHOSTS (hold photos):
 *   primary_bathroom  = 2330293 → merge into 3284744
 *   entry_foyer       = 2330294 → merge into 3284732
 *   kitchen           = 2330295 → merge into 3284740
 *   guest_bathroom    = 2330296 → merge into 3284728
 *   hall_bathroom     = 2330297 → merge into 3284741
 *   guest_bedroom     = 2330298 → merge into 3284726
 *   living_room       = 2330299 → merge into 2           (family room is KEPT old row)
 *   family_room       = 2330300 → merge into 3284738
 *   backyard          = 2330301 → merge into 3284734
 *
 * Execution order (idempotent — safe to re-run)
 * ----------------------------------------------
 * LOWER LEVEL
 *   L1   mergeRooms(1, 3284726)     lower-bedroom-1 → lower-guest-bedroom
 *   L1b  mergeRooms(2330298, 3284726) guest_bedroom → lower-guest-bedroom
 *   L2   mergeRooms(2330299, 2)     living_room → lower-family-room (KEPT)
 *   L2c  setFloorplanPosition(2)    set coords on kept lower-family-room
 *   L3   mergeRooms(3, 3284728)     lower-bath-1 → lower-guest-bath
 *   L3b  mergeRooms(2330296, 3284728) guest_bathroom → lower-guest-bath
 *   L4   mergeRooms(8, 3284733)     lower-patio → outside-patio
 *   L4b  mergeRooms(9, 3284733)     lower-rear-patio → outside-patio
 *   L5   mergeRooms(10, 3284734)    lower-backyard → outside-backyard
 *   L5b  mergeRooms(2330301, 3284734) backyard → outside-backyard
 *   L6   splitEntryway()            photo-split room 7:
 *          images in allowlist (fd965547, 4ce41f86) → stay on / move to 3284731
 *          ALL OTHER images from room 7 → move to 3284732 (lower-foyer)
 *          then deactivate room 7
 *   L6b  mergeRooms(2330294, 3284732) entry_foyer → lower-foyer
 *   L7   setCoords(4)               lower-laundry coords (lower_level, 26, 49)
 *   L7b  setCoords(6)               lower-garage coords (lower_level, 25, 77)
 *   L8   deactivateRoom(5)          lower-storage (no photos)
 *
 * UPPER LEVEL
 *   U1   mergeRooms(11, 3284735)    upper-primary-bedroom → primary-bedroom
 *   U2   mergeRooms(2330293, 3284744) primary_bathroom ghost → primary-bathroom
 *   U2b  mergeRooms(17, 3284744)    upper-bath-2 → primary-bathroom
 *   U3   mergeRooms(12, 3284736)    upper-bedroom-2 → jason-office
 *   U4   mergeRooms(13, 3284737)    upper-bedroom-3 → justin-office
 *   U5   splitLivingDining()        photo-split room 14:
 *          dining images (ce4f317d, 4ac13ec3) → 3284739
 *          stair-landing images (22cef674, a2a0d96c) → 3284743
 *          merge remaining photos via mergeRooms(14, 3284738)
 *   U5c  mergeRooms(2330300, 3284738) family_room → upper-living-room
 *   U5d  hardDeleteImages(4a06d3af, 1343677a) — duplicate image cleanup
 *   U6   mergeRooms(16, 3284741)    upper-bath-1 → upper-hall-bath
 *   U6b  mergeRooms(2330297, 3284741) hall_bathroom → upper-hall-bath
 *   U7   mergeRooms(15, 3284740)    upper-kitchen-breakfast → upper-kitchen
 *   U7b  mergeRooms(2330295, 3284740) kitchen → upper-kitchen
 *   U8   setCoords(18)              upper-lightwell coords (upper_level, 67, 39)
 *   U9   deactivateRoom(20)         upper-deck (no photos)
 *   U10  mergeRooms(19, 3284743)    upper-workshop → upper-stair-landing
 *
 * COORDINATES
 *   Confirm/update coords on the 15 final-code rooms (already present but guard
 *   in case prod rows have stale values from an earlier partial seed run).
 *   Also set coords on the 4 kept-old rooms: 2, 4, 6, 18.
 *
 * SCOPE CONVERSION
 *   convertInspirationScope() — runs last.
 *
 * VERIFY
 *   ~19 active rooms expected: 15 final-code + lower-family-room(2) +
 *   lower-laundry(4) + lower-garage(6) + upper-lightwell(18).
 *   All others is_active=false with zero photos.
 *   All active rooms have coords except outside-backyard (null x/y).
 */

import { drizzle } from "drizzle-orm/d1";
import { and, count, eq, inArray, isNull, not } from "drizzle-orm";
import {
  images,
  inspirationalImageRooms,
  rooms,
} from "@backend/db";

import {
  setFloorplanPosition,
  mergeRooms,
  reassignImages,
  addInspirationToRoom,
  removeInspirationFromRoom,
  deactivateRoom,
  hardDeleteImageFromD1,
} from "@backend/services/reconcile-rooms";

// ---------------------------------------------------------------------------
// Constants: IDs verified against live production DB (2026-06-19)
// ---------------------------------------------------------------------------

/**
 * FINAL target room IDs (already exist in production with correct codes + coords).
 * These are the rooms we merge everything INTO.  We never rename these rows.
 */
const FINAL = {
  LOWER_GUEST_BEDROOM: 3284726,   // lower-guest-bedroom
  LOWER_GUEST_BATH:    3284728,   // lower-guest-bath
  STREET_FRONT_DOOR:   3284731,   // street-front-door
  LOWER_FOYER:         3284732,   // lower-foyer
  OUTSIDE_PATIO:       3284733,   // outside-patio
  OUTSIDE_BACKYARD:    3284734,   // outside-backyard
  PRIMARY_BEDROOM:     3284735,   // primary-bedroom
  JASON_OFFICE:        3284736,   // jason-office
  JUSTIN_OFFICE:       3284737,   // justin-office
  UPPER_LIVING_ROOM:   3284738,   // upper-living-room
  UPPER_DINING_ROOM:   3284739,   // upper-dining-room
  UPPER_KITCHEN:       3284740,   // upper-kitchen
  UPPER_HALL_BATH:     3284741,   // upper-hall-bath
  UPPER_STAIR_LANDING: 3284743,   // upper-stair-landing
  PRIMARY_BATHROOM:    3284744,   // primary-bathroom
} as const;

/**
 * OLD canonical room IDs (1–20) that hold listing photos and must be merged
 * or kept.  "Kept" rooms are active old rows whose code does not conflict with
 * any final-code row (lower-family-room, lower-laundry, lower-garage,
 * upper-lightwell).
 */
const OLD = {
  LOWER_BEDROOM_1:         1,   // photo-holding; merge into FINAL.LOWER_GUEST_BEDROOM
  LOWER_FAMILY_ROOM:       2,   // KEPT active; merge living_room(2330299) into it; set coords
  LOWER_BATH_1:            3,   // photo-holding; merge into FINAL.LOWER_GUEST_BATH
  LOWER_LAUNDRY:           4,   // KEPT active; set coords only
  LOWER_STORAGE:           5,   // deactivate (no photos, no merge needed)
  LOWER_GARAGE:            6,   // KEPT active; set coords only
  LOWER_ENTRYWAY:          7,   // photo-split source; deactivate after split
  LOWER_PATIO:             8,   // merge into FINAL.OUTSIDE_PATIO
  LOWER_REAR_PATIO:        9,   // merge into FINAL.OUTSIDE_PATIO
  LOWER_BACKYARD:          10,  // merge into FINAL.OUTSIDE_BACKYARD
  UPPER_PRIMARY_BEDROOM:   11,  // merge into FINAL.PRIMARY_BEDROOM
  UPPER_BEDROOM_2:         12,  // merge into FINAL.JASON_OFFICE
  UPPER_BEDROOM_3:         13,  // merge into FINAL.JUSTIN_OFFICE
  UPPER_LIVING_DINING:     14,  // photo-split source; merge residual into FINAL.UPPER_LIVING_ROOM
  UPPER_KITCHEN_BREAKFAST: 15,  // merge into FINAL.UPPER_KITCHEN
  UPPER_BATH_1:            16,  // merge into FINAL.UPPER_HALL_BATH
  UPPER_BATH_2:            17,  // merge into FINAL.PRIMARY_BATHROOM (coord donor)
  UPPER_LIGHTWELL:         18,  // KEPT active; set coords only
  UPPER_WORKSHOP:          19,  // merge into FINAL.UPPER_STAIR_LANDING
  UPPER_DECK:              20,  // deactivate (no photos, no merge needed)
} as const;

/**
 * GHOST drift room IDs (2330293–2330301): snake_case rooms that were created by
 * the UploadsMappingPanel fan-out path.  They hold inspiration photos and must
 * be merged into the appropriate final-code room before deactivation.
 */
const GHOST = {
  PRIMARY_BATHROOM: 2330293,  // merge into FINAL.PRIMARY_BATHROOM
  ENTRY_FOYER:      2330294,  // merge into FINAL.LOWER_FOYER
  KITCHEN:          2330295,  // merge into FINAL.UPPER_KITCHEN
  GUEST_BATHROOM:   2330296,  // merge into FINAL.LOWER_GUEST_BATH
  HALL_BATHROOM:    2330297,  // merge into FINAL.UPPER_HALL_BATH
  GUEST_BEDROOM:    2330298,  // merge into FINAL.LOWER_GUEST_BEDROOM
  LIVING_ROOM:      2330299,  // merge into OLD.LOWER_FAMILY_ROOM (kept old row)
  FAMILY_ROOM:      2330300,  // merge into FINAL.UPPER_LIVING_ROOM
  BACKYARD:         2330301,  // merge into FINAL.OUTSIDE_BACKYARD
} as const;

/**
 * Images that must stay on street-front-door (FINAL.STREET_FRONT_DOOR = 3284731).
 * ALL OTHER images currently on old lower-entryway (OLD.LOWER_ENTRYWAY = 7) move
 * to lower-foyer (FINAL.LOWER_FOYER = 3284732).
 */
const STREET_FRONT_DOOR_ALLOWLIST = new Set([
  "fd965547-fe96-4d7a-9a2e-321c0e05f852", // Brick Garage Entrance
  "4ce41f86-905a-4efe-babd-98c0c47063d1", // Minimalist Entryway with Dark Gray Door
]);

/**
 * Images from upper-living-dining (OLD.UPPER_LIVING_DINING = 14) that must be
 * moved to upper-dining-room (FINAL.UPPER_DINING_ROOM = 3284739) BEFORE the
 * residual merge of room 14 into upper-living-room (3284738).
 */
const DINING_ROOM_IMAGES = [
  "ce4f317d-a95e-470c-81ba-a1838a75fb4d",
  "4ac13ec3-c491-4662-b87a-1b9d2fd77c63",
];

/**
 * Images from upper-living-dining (room 14) that must move to upper-stair-landing
 * (FINAL.UPPER_STAIR_LANDING = 3284743) BEFORE the residual merge of room 14.
 */
const STAIR_LANDING_IMAGES = [
  "22cef674-571f-4416-b97e-d4b7dc3a4763",
  "a2a0d96c-5247-4406-9cc4-c70a857662f7",
];

/**
 * Duplicate image IDs to hard-delete from D1 (and CF Images via Worker API).
 * These are exact duplicates with no unique content.
 */
const DUPLICATE_IMAGE_IDS = [
  "4a06d3af-d8ac-4577-87bb-32a228175898",
  "1343677a-db36-4252-85d6-e965dd9c2779",
];

// ---------------------------------------------------------------------------
// Coordinate seed — final floorplan positions for ALL active rooms
// ---------------------------------------------------------------------------

/**
 * Canonical floorplan positions for every room that should be active after
 * reconciliation.  Includes both the 15 final-code rooms and the 4 kept-old
 * rooms (lower-family-room/2, lower-laundry/4, lower-garage/6, upper-lightwell/18).
 *
 * The UPDATE is idempotent: if the row already has these exact values the DB
 * write is a no-op.  Setting xPct/yPct to null removes the dot from the canvas
 * (outside-backyard is intentionally unplaced).
 */
const FINAL_COORDINATES: Array<{
  /** room_code slug used by setFloorplanPosition to look up the row. */
  code: string;
  floorKey: string;
  xPct: number | null;
  yPct: number | null;
}> = [
  // Lower level — 7 final rooms + 3 kept-old rooms
  { code: "lower-guest-bedroom", floorKey: "lower_level", xPct: 33,   yPct: 28   },
  { code: "lower-family-room",   floorKey: "lower_level", xPct: 18,   yPct: 34   }, // kept old id=2
  { code: "lower-guest-bath",    floorKey: "lower_level", xPct: 34,   yPct: 43   },
  { code: "lower-laundry",       floorKey: "lower_level", xPct: 26,   yPct: 49   }, // kept old id=4
  { code: "lower-garage",        floorKey: "lower_level", xPct: 25,   yPct: 77   }, // kept old id=6
  { code: "street-front-door",   floorKey: "lower_level", xPct: 7,    yPct: 89   },
  { code: "lower-foyer",         floorKey: "lower_level", xPct: 7,    yPct: 52   },
  // Outside — 2 final rooms
  { code: "outside-patio",       floorKey: "outside",     xPct: 27,   yPct: 10   },
  { code: "outside-backyard",    floorKey: "outside",     xPct: null, yPct: null }, // intentionally unplaced
  // Upper level — 9 final rooms + 1 kept-old room
  { code: "primary-bedroom",     floorKey: "upper_level", xPct: 82,   yPct: 21   },
  { code: "jason-office",        floorKey: "upper_level", xPct: 66,   yPct: 52   },
  { code: "justin-office",       floorKey: "upper_level", xPct: 64,   yPct: 21   },
  { code: "upper-living-room",   floorKey: "upper_level", xPct: 84,   yPct: 72   },
  { code: "upper-dining-room",   floorKey: "upper_level", xPct: 84,   yPct: 62   },
  { code: "upper-kitchen",       floorKey: "upper_level", xPct: 65,   yPct: 76   },
  { code: "upper-hall-bath",     floorKey: "upper_level", xPct: 64,   yPct: 32   },
  { code: "upper-lightwell",     floorKey: "upper_level", xPct: 67,   yPct: 39   }, // kept old id=18
  { code: "upper-stair-landing", floorKey: "upper_level", xPct: 78,   yPct: 49   },
  { code: "primary-bathroom",    floorKey: "upper_level", xPct: 88,   yPct: 39   },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Delete an image via the deployed Worker's REST API.
 *
 * The Worker's DELETE /api/images/:id handler removes the Cloudflare Images
 * asset AND the D1 row in one call.  Requires CF_WORKER_URL (base URL of the
 * deployed worker) and CF_ADMIN_TOKEN (bearer token with images:write scope)
 * in the environment.
 *
 * Falls back to D1-only deletion if the Worker URL is not set, with a loud
 * warning — the CF asset will become an orphan and must be cleaned up manually
 * in the Cloudflare Images dashboard.
 */
async function deleteImageViaWorker(
  db: ReturnType<typeof drizzle>,
  imageId: string,
  workerBaseUrl: string | undefined,
  adminToken: string | undefined,
): Promise<void> {
  console.log(`  [DELETE IMAGE] ${imageId}`);

  if (workerBaseUrl && adminToken) {
    const url = `${workerBaseUrl.replace(/\/$/, "")}/api/images/${imageId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (response.ok) {
      console.log(`    -> Deleted via Worker API (D1 + CF Images): ${response.status}`);
      return;
    }

    if (response.status === 404) {
      console.log(`    -> Already gone (404) — skipping.`);
      return;
    }

    // Non-success: log the error and fall through to D1-only deletion.
    const body = await response.text().catch(() => "(no body)");
    console.warn(
      `    -> Worker API DELETE returned ${response.status}; falling back to D1-only. Response: ${body}`,
    );
  } else {
    console.warn(
      `    -> CF_WORKER_URL or CF_ADMIN_TOKEN not set. Deleting D1 row only. ` +
        `CF Images asset ${imageId} will be an orphan — delete manually.`,
    );
  }

  // D1-only fallback.
  await hardDeleteImageFromD1(db, imageId);
  console.log(`    -> D1 row deleted (CF asset may still exist).`);
}

/** Log a named step with timing. */
async function step(label: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const start = Date.now();
  await fn();
  console.log(`    completed in ${Date.now() - start}ms`);
}

// ---------------------------------------------------------------------------
// Pre-run count snapshot
// ---------------------------------------------------------------------------

async function snapshotCounts(db: ReturnType<typeof drizzle>): Promise<{
  totalImages: number;
  imagesWithRoom: number;
  inspirationRows: number;
  activeRooms: number;
}> {
  const allImages = await db.select({ id: images.id }).from(images).all();
  const withRoom = await db
    .select({ id: images.id })
    .from(images)
    .where(not(isNull(images.roomId)))
    .all();
  const inspRows = await db
    .select({ id: inspirationalImageRooms.id })
    .from(inspirationalImageRooms)
    .all();
  const activeRoomRows = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.isActive, true))
    .all();

  return {
    totalImages: allImages.length,
    imagesWithRoom: withRoom.length,
    inspirationRows: inspRows.length,
    activeRooms: activeRoomRows.length,
  };
}

// ---------------------------------------------------------------------------
// Main reconciliation
// ---------------------------------------------------------------------------

export async function runReconciliation(
  env: Env,
  opts: { dryRun?: boolean } = {},
): Promise<void> {
  const db = drizzle(env.DB);
  const workerBaseUrl = (env as unknown as Record<string, unknown>)["CF_WORKER_URL"] as
    | string
    | undefined;
  const adminToken = (env as unknown as Record<string, unknown>)["CF_ADMIN_TOKEN"] as
    | string
    | undefined;

  // -----------------------------------------------------------------------
  // PRE-RUN SNAPSHOT
  // -----------------------------------------------------------------------
  console.log("\n====== 0005 Room Reconciliation R2 — Pre-run Snapshot ======");
  const pre = await snapshotCounts(db);
  console.log(
    `  images total: ${pre.totalImages} | with room_id: ${pre.imagesWithRoom} ` +
      `| inspiration rows: ${pre.inspirationRows} | active rooms: ${pre.activeRooms}`,
  );

  if (opts.dryRun) {
    console.log("\n[DRY RUN] Exiting without making changes.");
    return;
  }

  // ==========================================================================
  // LOWER LEVEL
  // ==========================================================================

  // L1: Merge old lower-bedroom-1 (id=1) → final lower-guest-bedroom (id=3284726)
  //
  // The old row holds listing photos.  The final row already exists with the
  // correct code and coords.  mergeRooms() repoints all FK tables then
  // soft-deletes the old row (is_active=false).
  await step("L1: merge lower-bedroom-1 (id=1) → lower-guest-bedroom (id=3284726)", async () => {
    const result = await mergeRooms(db, OLD.LOWER_BEDROOM_1, FINAL.LOWER_GUEST_BEDROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L1b: Merge ghost guest_bedroom (id=2330298) → final lower-guest-bedroom (id=3284726)
  //
  // The ghost row was created by the UploadsMappingPanel fan-out and may hold
  // inspiration mappings.  mergeRooms() handles dedupe in inspirational_image_rooms.
  await step("L1b: merge guest_bedroom ghost (id=2330298) → lower-guest-bedroom (id=3284726)", async () => {
    const result = await mergeRooms(db, GHOST.GUEST_BEDROOM, FINAL.LOWER_GUEST_BEDROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L2: Merge ghost living_room (id=2330299) → KEPT old lower-family-room (id=2)
  //
  // lower-family-room is an old canonical room whose code does not conflict with
  // any final-code row.  It is KEPT active.  We only need to merge the ghost
  // living_room into it and then set its coords.
  await step("L2: merge living_room ghost (id=2330299) → lower-family-room (id=2)", async () => {
    const result = await mergeRooms(db, GHOST.LIVING_ROOM, OLD.LOWER_FAMILY_ROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L2c: Set coords on kept lower-family-room (id=2)
  //
  // The old row had no floorplan coordinates.  The spec places it at
  // (lower_level, 18, 34).  setFloorplanPosition is idempotent.
  await step("L2c: set coords on lower-family-room (id=2) → lower_level (18, 34)", async () => {
    await setFloorplanPosition(db, OLD.LOWER_FAMILY_ROOM, {
      floorKey: "lower_level",
      xPct: 18,
      yPct: 34,
    });
    console.log(`  coords set: (18, 34) on lower_level`);
  });

  // L3: Merge old lower-bath-1 (id=3) → final lower-guest-bath (id=3284728)
  await step("L3: merge lower-bath-1 (id=3) → lower-guest-bath (id=3284728)", async () => {
    const result = await mergeRooms(db, OLD.LOWER_BATH_1, FINAL.LOWER_GUEST_BATH);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L3b: Merge ghost guest_bathroom (id=2330296) → final lower-guest-bath (id=3284728)
  await step("L3b: merge guest_bathroom ghost (id=2330296) → lower-guest-bath (id=3284728)", async () => {
    const result = await mergeRooms(db, GHOST.GUEST_BATHROOM, FINAL.LOWER_GUEST_BATH);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L4: Merge old lower-patio (id=8) → final outside-patio (id=3284733)
  await step("L4: merge lower-patio (id=8) → outside-patio (id=3284733)", async () => {
    const result = await mergeRooms(db, OLD.LOWER_PATIO, FINAL.OUTSIDE_PATIO);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L4b: Merge old lower-rear-patio (id=9) → final outside-patio (id=3284733)
  await step("L4b: merge lower-rear-patio (id=9) → outside-patio (id=3284733)", async () => {
    const result = await mergeRooms(db, OLD.LOWER_REAR_PATIO, FINAL.OUTSIDE_PATIO);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L5: Merge old lower-backyard (id=10) → final outside-backyard (id=3284734)
  await step("L5: merge lower-backyard (id=10) → outside-backyard (id=3284734)", async () => {
    const result = await mergeRooms(db, OLD.LOWER_BACKYARD, FINAL.OUTSIDE_BACKYARD);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L5b: Merge ghost backyard (id=2330301) → final outside-backyard (id=3284734)
  await step("L5b: merge backyard ghost (id=2330301) → outside-backyard (id=3284734)", async () => {
    const result = await mergeRooms(db, GHOST.BACKYARD, FINAL.OUTSIDE_BACKYARD);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L6: Entryway photo-split then deactivate
  //
  // Old lower-entryway (id=7) has images that belong to two different final rooms:
  //   - Images in STREET_FRONT_DOOR_ALLOWLIST → stay on / move to street-front-door (3284731)
  //   - All other images from room 7 → move to lower-foyer (3284732)
  //
  // We cannot use mergeRooms() for this step because it is a split (not a
  // merge): we need some images to go to one target and the rest to another.
  //
  // Approach:
  //   1. Reassign all non-allowlist listing photos to lower-foyer (3284732).
  //   2. Reassign non-allowlist inspiration rows to lower-foyer (3284732), deduping.
  //   3. The allowlisted images are already on room 7; after the reassignment below
  //      they'll land on street-front-door via the eventual deactivation path.
  //      BUT room 7 is the OLD row — not FINAL.STREET_FRONT_DOOR (3284731).
  //      So we must also move the allowlisted images FROM room 7 TO 3284731
  //      explicitly (room 7 will be deactivated; photos must all land on final rows).
  //   4. Deactivate room 7 (all photos now on final rows).
  await step("L6: entryway photo-split + deactivate lower-entryway (id=7)", async () => {
    // --- listing photos (images.room_id = 7) ---
    const listingOnRoom7 = await db
      .select({ id: images.id })
      .from(images)
      .where(eq(images.roomId, OLD.LOWER_ENTRYWAY))
      .all();

    const listingIds = listingOnRoom7.map((r) => r.id);
    const listingToFoyer = listingIds.filter((id) => !STREET_FRONT_DOOR_ALLOWLIST.has(id));
    const listingToFrontDoor = listingIds.filter((id) => STREET_FRONT_DOOR_ALLOWLIST.has(id));

    // Move non-allowlist listing photos to lower-foyer.
    if (listingToFoyer.length > 0) {
      await reassignImages(db, listingToFoyer, FINAL.LOWER_FOYER);
      console.log(`  moved ${listingToFoyer.length} listing images → lower-foyer (3284732)`);
    }

    // Move allowlist listing photos to street-front-door.
    if (listingToFrontDoor.length > 0) {
      await reassignImages(db, listingToFrontDoor, FINAL.STREET_FRONT_DOOR);
      console.log(`  moved ${listingToFrontDoor.length} allowlist images → street-front-door (3284731)`);
    }

    // --- inspiration mappings (inspirational_image_rooms.room_id = 7) ---
    const inspOnRoom7 = await db
      .select({ id: inspirationalImageRooms.id, imageId: inspirationalImageRooms.imageId })
      .from(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.roomId, OLD.LOWER_ENTRYWAY))
      .all();

    const inspToFoyer = inspOnRoom7.filter((r) => !STREET_FRONT_DOOR_ALLOWLIST.has(r.imageId));
    const inspToFrontDoor = inspOnRoom7.filter((r) => STREET_FRONT_DOOR_ALLOWLIST.has(r.imageId));

    // Add non-allowlist inspiration to lower-foyer (INSERT OR IGNORE), then remove from room 7.
    if (inspToFoyer.length > 0) {
      await addInspirationToRoom(
        db,
        inspToFoyer.map((r) => r.imageId),
        FINAL.LOWER_FOYER,
      );
      await removeInspirationFromRoom(
        db,
        inspToFoyer.map((r) => r.imageId),
        OLD.LOWER_ENTRYWAY,
      );
      console.log(`  moved ${inspToFoyer.length} inspiration rows → lower-foyer (3284732)`);
    }

    // Add allowlist inspiration to street-front-door (INSERT OR IGNORE), then remove from room 7.
    if (inspToFrontDoor.length > 0) {
      await addInspirationToRoom(
        db,
        inspToFrontDoor.map((r) => r.imageId),
        FINAL.STREET_FRONT_DOOR,
      );
      await removeInspirationFromRoom(
        db,
        inspToFrontDoor.map((r) => r.imageId),
        OLD.LOWER_ENTRYWAY,
      );
      console.log(`  moved ${inspToFrontDoor.length} allowlist inspiration rows → street-front-door (3284731)`);
    }

    // Deactivate room 7 — all photos are now on final rows; this will throw if any
    // photo was missed (zero-photo invariant enforced by deactivateRoom).
    await deactivateRoom(db, OLD.LOWER_ENTRYWAY);
    console.log(`  deactivated room id=${OLD.LOWER_ENTRYWAY} (is_active=false)`);
  });

  // L6b: Merge ghost entry_foyer (id=2330294) → final lower-foyer (id=3284732)
  //
  // The ghost entry_foyer row holds inspiration photos that belong in lower-foyer.
  // mergeRooms() handles FK repointing and deduplication.
  await step("L6b: merge entry_foyer ghost (id=2330294) → lower-foyer (id=3284732)", async () => {
    const result = await mergeRooms(db, GHOST.ENTRY_FOYER, FINAL.LOWER_FOYER);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L7: Set coords on kept lower-laundry (id=4)
  //
  // lower-laundry has no final-code counterpart so it stays as-is.
  // Spec position: (lower_level, 26, 49).
  await step("L7: set coords on lower-laundry (id=4) → lower_level (26, 49)", async () => {
    await setFloorplanPosition(db, OLD.LOWER_LAUNDRY, {
      floorKey: "lower_level",
      xPct: 26,
      yPct: 49,
    });
    console.log(`  coords set: (26, 49) on lower_level`);
  });

  // L7b: Set coords on kept lower-garage (id=6)
  //
  // Spec position: (lower_level, 25, 77).
  await step("L7b: set coords on lower-garage (id=6) → lower_level (25, 77)", async () => {
    await setFloorplanPosition(db, OLD.LOWER_GARAGE, {
      floorKey: "lower_level",
      xPct: 25,
      yPct: 77,
    });
    console.log(`  coords set: (25, 77) on lower_level`);
  });

  // L8: Deactivate lower-storage (id=5) — no photos, no merge needed.
  //
  // deactivateRoom() will throw if any photos remain; this is a safety net.
  await step("L8: deactivate lower-storage (id=5, no photos)", async () => {
    await deactivateRoom(db, OLD.LOWER_STORAGE);
    console.log(`  deactivated room id=${OLD.LOWER_STORAGE} (is_active=false)`);
  });

  // ==========================================================================
  // UPPER LEVEL
  // ==========================================================================

  // U1: Merge old upper-primary-bedroom (id=11) → final primary-bedroom (id=3284735)
  await step("U1: merge upper-primary-bedroom (id=11) → primary-bedroom (id=3284735)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_PRIMARY_BEDROOM, FINAL.PRIMARY_BEDROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U2: Merge ghost primary_bathroom (id=2330293) → final primary-bathroom (id=3284744)
  //
  // The ghost row was the drift row that held inspiration photos for the primary bathroom.
  // The final row (3284744) already exists with the correct code.
  await step("U2: merge primary_bathroom ghost (id=2330293) → primary-bathroom (id=3284744)", async () => {
    const result = await mergeRooms(db, GHOST.PRIMARY_BATHROOM, FINAL.PRIMARY_BATHROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U2b: Merge old upper-bath-2 (id=17) → final primary-bathroom (id=3284744)
  //
  // The old upper-bath-2 row was used as a "coord donor" in the original plan.
  // It may hold listing photos or inspiration.  All go to primary-bathroom.
  await step("U2b: merge upper-bath-2 (id=17) → primary-bathroom (id=3284744)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_BATH_2, FINAL.PRIMARY_BATHROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U3: Merge old upper-bedroom-2 (id=12) → final jason-office (id=3284736)
  await step("U3: merge upper-bedroom-2 (id=12) → jason-office (id=3284736)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_BEDROOM_2, FINAL.JASON_OFFICE);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U4: Merge old upper-bedroom-3 (id=13) → final justin-office (id=3284737)
  await step("U4: merge upper-bedroom-3 (id=13) → justin-office (id=3284737)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_BEDROOM_3, FINAL.JUSTIN_OFFICE);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U5: upper-living-dining (id=14) photo-split, then merge residual into upper-living-room
  //
  // Room 14 holds photos that belong in three different final rooms:
  //   - DINING_ROOM_IMAGES (ce4f317d, 4ac13ec3) → upper-dining-room (3284739)
  //   - STAIR_LANDING_IMAGES (22cef674, a2a0d96c) → upper-stair-landing (3284743)
  //   - ALL OTHER photos on room 14 → upper-living-room (3284738) via mergeRooms
  //
  // We reassign the split images first.  Then mergeRooms(14, 3284738) handles
  // the remaining photos plus all other FK rows, and deactivates room 14.
  await step(
    "U5: split upper-living-dining (id=14): dining → 3284739, stair → 3284743, residual merge → 3284738",
    async () => {
      // Move dining-room listing images to upper-dining-room.
      await reassignImages(db, DINING_ROOM_IMAGES, FINAL.UPPER_DINING_ROOM);
      console.log(`  moved ${DINING_ROOM_IMAGES.length} dining listing images → upper-dining-room (3284739)`);

      // Move stair-landing listing images to upper-stair-landing.
      await reassignImages(db, STAIR_LANDING_IMAGES, FINAL.UPPER_STAIR_LANDING);
      console.log(`  moved ${STAIR_LANDING_IMAGES.length} stair-landing images → upper-stair-landing (3284743)`);

      // Merge remaining photos + all FK rows from room 14 into upper-living-room.
      // reassignImages above already moved the split images; mergeRooms will
      // only find the residual images still on room 14.
      const result = await mergeRooms(db, OLD.UPPER_LIVING_DINING, FINAL.UPPER_LIVING_ROOM);
      console.log(`  residual merge into upper-living-room:`, result.rowsRepointed);
    },
  );

  // U5c: Merge ghost family_room (id=2330300) → final upper-living-room (id=3284738)
  await step("U5c: merge family_room ghost (id=2330300) → upper-living-room (id=3284738)", async () => {
    const result = await mergeRooms(db, GHOST.FAMILY_ROOM, FINAL.UPPER_LIVING_ROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U5d: Hard-delete duplicate images 4a06d3af + 1343677a
  //
  // These are exact duplicates.  The Worker API handles D1 row + CF Images asset
  // deletion in one call.  Falls back to D1-only with a warning if Worker URL
  // is not configured.
  await step("U5d: hard-delete duplicate images", async () => {
    for (const imageId of DUPLICATE_IMAGE_IDS) {
      await deleteImageViaWorker(db, imageId, workerBaseUrl, adminToken);
    }
  });

  // U6: Merge old upper-bath-1 (id=16) → final upper-hall-bath (id=3284741)
  await step("U6: merge upper-bath-1 (id=16) → upper-hall-bath (id=3284741)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_BATH_1, FINAL.UPPER_HALL_BATH);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U6b: Merge ghost hall_bathroom (id=2330297) → final upper-hall-bath (id=3284741)
  await step("U6b: merge hall_bathroom ghost (id=2330297) → upper-hall-bath (id=3284741)", async () => {
    const result = await mergeRooms(db, GHOST.HALL_BATHROOM, FINAL.UPPER_HALL_BATH);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U7: Merge old upper-kitchen-breakfast (id=15) → final upper-kitchen (id=3284740)
  await step("U7: merge upper-kitchen-breakfast (id=15) → upper-kitchen (id=3284740)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_KITCHEN_BREAKFAST, FINAL.UPPER_KITCHEN);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U7b: Merge ghost kitchen (id=2330295) → final upper-kitchen (id=3284740)
  //
  // The ghost kitchen row holds 71 inspiration photos.  mergeRooms() batches
  // the inspirational_image_rooms repoint in chunks of 90 to respect D1 limits.
  await step("U7b: merge kitchen ghost (id=2330295) → upper-kitchen (id=3284740)", async () => {
    const result = await mergeRooms(db, GHOST.KITCHEN, FINAL.UPPER_KITCHEN);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U8: Set coords on kept upper-lightwell (id=18)
  //
  // upper-lightwell has no final-code counterpart.  Spec position: (upper_level, 67, 39).
  await step("U8: set coords on upper-lightwell (id=18) → upper_level (67, 39)", async () => {
    await setFloorplanPosition(db, OLD.UPPER_LIGHTWELL, {
      floorKey: "upper_level",
      xPct: 67,
      yPct: 39,
    });
    console.log(`  coords set: (67, 39) on upper_level`);
  });

  // U9: Deactivate upper-deck (id=20) — no photos, does not physically exist.
  await step("U9: deactivate upper-deck (id=20, no photos)", async () => {
    await deactivateRoom(db, OLD.UPPER_DECK);
    console.log(`  deactivated room id=${OLD.UPPER_DECK} (is_active=false)`);
  });

  // U10: Merge old upper-workshop (id=19) → final upper-stair-landing (id=3284743)
  //
  // Note: stair-landing images from room 14 were already moved to 3284743 in U5.
  // This merge moves any photos/FKs on room 19 (upper-workshop) into the same target.
  await step("U10: merge upper-workshop (id=19) → upper-stair-landing (id=3284743)", async () => {
    const result = await mergeRooms(db, OLD.UPPER_WORKSHOP, FINAL.UPPER_STAIR_LANDING);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // ==========================================================================
  // COORDINATES — confirm/set floorplan positions on all active rooms
  //
  // The 15 final-code rooms already have coords from the seed, but we set them
  // again here to guard against any partial/stale seed values.  The 4 kept-old
  // rooms (2, 4, 6, 18) had their coords set in individual steps above (L2c,
  // L7, L7b, U8); this loop is an idempotent redundancy guard for re-runs.
  // ==========================================================================
  await step("COORDINATES: set floorplan positions on all active rooms", async () => {
    for (const coord of FINAL_COORDINATES) {
      await setFloorplanPosition(db, coord.code, {
        floorKey: coord.floorKey,
        xPct: coord.xPct,
        yPct: coord.yPct,
      });
      console.log(
        `  ${coord.code}: (${coord.xPct ?? "null"}, ${coord.yPct ?? "null"}) on ${coord.floorKey}`,
      );
    }
  });

  // ==========================================================================
  // SCOPE CONVERSION — runs LAST
  //
  // convertInspirationScope() examines every inspiration image that has per-room
  // inspirational_image_rooms rows and promotes them to level or home scope if
  // their coverage matches the full active-room set (or a single floor's set).
  //
  // MUST run after all merges + deactivations so the "active rooms" baseline
  // reflects the final ~19-room set.  Already-scoped images are skipped (idempotent).
  // ==========================================================================
  await step("SCOPE CONVERSION: promote fan-out inspiration to level/home scope", async () => {
    const { convertInspirationScope } = await import("@backend/services/reconcile-rooms");
    const scopeResult = await convertInspirationScope(db);
    console.log(`  promoted to home:  ${scopeResult.promotedToHome}`);
    console.log(`  promoted to level: ${scopeResult.promotedToLevel}`);
    console.log(`  already scoped:    ${scopeResult.alreadyScoped}`);
    console.log(`  left as room:      ${scopeResult.leftAsRoom}`);
    for (const warning of scopeResult.warnings) {
      console.warn(`  WARN: ${warning}`);
    }
  });

  // ==========================================================================
  // POST-RUN VERIFICATION
  // ==========================================================================
  console.log("\n====== Post-run Verification ======");
  const post = await snapshotCounts(db);

  // Expect: total images reduced by 2 (the 2 hard-deleted duplicate images).
  const expectedTotal = pre.totalImages - DUPLICATE_IMAGE_IDS.length;
  const totalOk = post.totalImages === expectedTotal;
  console.log(
    `  images total: ${post.totalImages} (expected ${expectedTotal}) ${totalOk ? "OK" : "MISMATCH"}`,
  );

  // Verify expected active room count (~19):
  //   15 final-code rooms + lower-family-room(2) + lower-laundry(4) + lower-garage(6) + upper-lightwell(18)
  const expectedActive = 19;
  const activeOk = post.activeRooms === expectedActive;
  console.log(
    `  active rooms: ${post.activeRooms} (expected ~${expectedActive}) ${activeOk ? "OK" : "CHECK"}`,
  );

  // Verify all old and ghost source rooms are now is_active=false.
  //
  // OLD source rooms that were merged (not kept):
  const mergedOldIds = [
    OLD.LOWER_BEDROOM_1,         // 1
    OLD.LOWER_BATH_1,            // 3
    OLD.LOWER_ENTRYWAY,          // 7  (split + deactivate)
    OLD.LOWER_PATIO,             // 8
    OLD.LOWER_REAR_PATIO,        // 9
    OLD.LOWER_BACKYARD,          // 10
    OLD.UPPER_PRIMARY_BEDROOM,   // 11
    OLD.UPPER_BEDROOM_2,         // 12
    OLD.UPPER_BEDROOM_3,         // 13
    OLD.UPPER_LIVING_DINING,     // 14
    OLD.UPPER_KITCHEN_BREAKFAST, // 15
    OLD.UPPER_BATH_1,            // 16
    OLD.UPPER_BATH_2,            // 17
    OLD.UPPER_WORKSHOP,          // 19
  ] as const;
  // OLD rooms deactivated with no merge:
  const deactivatedOldIds = [OLD.LOWER_STORAGE, OLD.UPPER_DECK] as const; // 5, 20
  // ALL ghost rooms:
  const allGhostIds = Object.values(GHOST) as number[];

  const allDeactivatedIds = [...mergedOldIds, ...deactivatedOldIds, ...allGhostIds];

  for (const roomId of allDeactivatedIds) {
    const roomRow = await db
      .select({ id: rooms.id, code: rooms.roomCode, isActive: rooms.isActive })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .get();

    if (!roomRow) {
      console.warn(`  WARN: room id=${roomId} not found — expected is_active=false row.`);
      continue;
    }

    if (roomRow.isActive) {
      console.warn(`  WARN: room id=${roomId} (${roomRow.code}) is STILL ACTIVE — deactivation failed.`);
    } else {
      console.log(`  room id=${roomId} (${roomRow.code}): is_active=false OK`);
    }

    // Verify ZERO photos remain on the deactivated room.
    const imgCount = await db
      .select({ cnt: count(images.id) })
      .from(images)
      .where(eq(images.roomId, roomId))
      .get();
    const inspCount = await db
      .select({ cnt: count(inspirationalImageRooms.id) })
      .from(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.roomId, roomId))
      .get();
    const totalPhotos = (imgCount?.cnt ?? 0) + (inspCount?.cnt ?? 0);
    console.log(
      `    photos remaining: ${totalPhotos} ${totalPhotos === 0 ? "OK" : "ERROR — photos still on inactive room!"}`,
    );
  }

  // Verify all active rooms (final-code + kept-old) exist, are active, and have coords.
  //
  // Expected active set after reconciliation:
  //   lower-guest-bedroom, lower-family-room, lower-guest-bath, lower-laundry,
  //   lower-garage, street-front-door, lower-foyer,
  //   outside-patio, outside-backyard (no dot),
  //   primary-bedroom, jason-office, justin-office,
  //   upper-living-room, upper-dining-room, upper-kitchen, upper-hall-bath,
  //   upper-lightwell, upper-stair-landing, primary-bathroom
  for (const coord of FINAL_COORDINATES) {
    const r = await db
      .select({
        id: rooms.id,
        code: rooms.roomCode,
        xPct: rooms.floorplanXPct,
        yPct: rooms.floorplanYPct,
        isActive: rooms.isActive,
      })
      .from(rooms)
      .where(eq(rooms.roomCode, coord.code))
      .get();

    if (!r) {
      console.warn(`  MISSING room: ${coord.code}`);
    } else if (!r.isActive) {
      console.warn(`  ${coord.code} (id=${r.id}) is INACTIVE — should be active!`);
    } else {
      const hasCoords = coord.xPct === null ? r.xPct === null : r.xPct !== null;
      console.log(
        `  ${coord.code} (id=${r.id}) x=${r.xPct ?? "null"} y=${r.yPct ?? "null"}: ${hasCoords ? "OK" : "COORDS MISSING"}`,
      );
    }
  }

  console.log(
    `\n====== Reconciliation complete. ` +
      `active rooms: ${post.activeRooms} | ` +
      `inspiration rows remaining: ${post.inspirationRows} ======`,
  );
}
