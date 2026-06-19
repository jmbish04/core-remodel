/**
 * @fileoverview 0005-reconcile-rooms.ts
 *
 * Feature 0005 — Room Data Reconciliation Script
 * ================================================
 * Idempotent, ordered data-fix that encodes the EXACT mapping from
 * IMPLEMENTATION_PLAN §4.1 (rows L1–L8, U1–U10) and §4.2 (coordinates).
 *
 * Usage (dry run — local D1 only; NEVER --remote during development):
 *   npx wrangler d1 execute DB --local --command="SELECT 1" # warm-up
 *   tsx scripts/0005-reconcile-rooms.ts --dry-run
 *
 * Usage (execute against local D1 for testing):
 *   tsx scripts/0005-reconcile-rooms.ts
 *
 * Production execution (orchestrator-gated, NOT run by this script):
 *   1. wrangler d1 export DB --remote --output=backup-pre-0005.sql
 *   2. Review this script output on local first
 *   3. wrangler d1 execute DB --remote --file=scripts/0005-reconcile-rooms.sql
 *   4. Verify counts (see VERIFY section at bottom of .sql file)
 *
 * Architecture note
 * -----------------
 * This script is a thin orchestrator over the `reconcileRooms` service.  It
 * runs against a local D1 instance via the `wrangler d1 execute` / `tsx` +
 * `@cloudflare/d1` path.  Cloudflare Images API deletes (for the 2 duplicate
 * images) are performed by calling the deployed Worker's DELETE /api/images/:id
 * endpoint — this keeps the CF credential handling inside the Worker where
 * secrets are available.  The Worker URL must be set in CF_WORKER_URL env var.
 *
 * Execution order (idempotent — safe to re-run)
 * ----------------------------------------------
 * LOWER LEVEL
 *   L1  rename lower-bedroom-1 (id=1)  → lower-guest-bedroom / "Guest Bedroom"
 *   L1b merge guest_bedroom (id=2330298) → room 1 (no photos; safe)
 *   L2  merge living_room (id=2330299) → lower-family-room (id=2)  [6 listing + 2 insp]
 *   L3  rename lower-bath-1 (id=3)  → lower-guest-bath / "Guest Bath"
 *   L3b merge guest_bathroom (id=2330296) → room 3                  [1 insp]
 *   L4  rename+floor-move lower-patio (id=8) → outside-patio / "Patio" (floor → outside)
 *   L4b merge lower-rear-patio (id=9) → room 8                      [1 insp]
 *   L5  rename+floor-move lower-backyard (id=10) → outside-backyard / "Backyard" (floor → outside)
 *   L5b merge backyard (id=2330301) → room 10                        [7 listing + 53 insp]
 *   L6  rename lower-entryway (id=7) → street-front-door / "Front Door / Street"
 *       + split: keep image fd965547 + 4ce41f86 on street-front-door;
 *                move ALL OTHER images on room 7 to lower-foyer (2330294, renamed in L7)
 *   L7  rename entry_foyer (id=2330294) → lower-foyer / "Foyer"
 *   L8  delete lower-storage (id=5)  — no photos, safe to drop
 *
 * UPPER LEVEL
 *   U1  rename upper-primary-bedroom (id=11) → primary-bedroom / "Primary Bedroom"
 *   U2  rename primary_bathroom (id=2330293) → primary-bathroom / "Primary Bathroom"
 *   U2b merge upper-bath-2 (id=17) → room 2330293  (coord donor, no photos)
 *   U3  rename+recoord upper-bedroom-2 (id=12) → jason-office / "Jason's Office" (66,52 upper)
 *   U4  rename+recoord upper-bedroom-3 (id=13) → justin-office / "Justin's Office" (64,21 upper)
 *   U5  rename upper-living-dining (id=14) → upper-living-room / "Living Room"
 *   U5b create upper-dining-room / "Dining Room" on upper_level at (84,62)
 *       + assign images ce4f317d + 4ac13ec3 to it
 *   U5c merge family_room (id=2330300) → upper-living-room (id=14)   [1 listing + 3 insp]
 *   U5d hard-delete duplicates 4a06d3af + 1343677a via Worker API DELETE /api/images/:id
 *   U6  rename upper-bath-1 (id=16) → upper-hall-bath / "Hall Bath"
 *   U6b merge hall_bathroom (id=2330297) → room 16                   [no photos]
 *   U7  rename upper-kitchen-breakfast (id=15) → upper-kitchen / "Kitchen"
 *   U7b merge kitchen (id=2330295) → room 15                         [71 insp]
 *   U8  no-op: upper-lightwell (id=18) unchanged
 *   U9  delete upper-deck (id=20)  — no photos, safe to drop
 *   U10 rename upper-workshop (id=19) → upper-stair-landing / "Stair Landing"
 *       + move images 22cef674 + a2a0d96c from room 14 to upper-stair-landing
 *
 * COORDINATES (§4.2)
 *   Set floorplan_floor_key / x / y on every remaining room.
 *
 * VERIFY (post-run assertions logged to console)
 *   - Drift rooms (2330293–2330301) all gone
 *   - Rooms lower-storage (5), upper-bath-2 (17), upper-deck (20) gone
 *   - All 19 final rooms present (18 placed + outside-backyard unplaced)
 *   - Total images.room_id counts unchanged vs pre-run minus 2 intended deletes
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, isNull, not, and } from "drizzle-orm";
import {
  images,
  inspirationalImageRooms,
  rooms,
  floors,
} from "@backend/db";

import {
  renameRoom,
  setFloorplanPosition,
  mergeRooms,
  reassignImages,
  addInspirationToRoom,
  removeInspirationFromRoom,
  deleteRoom,
  hardDeleteImageFromD1,
} from "@backend/services/reconcile-rooms";

// ---------------------------------------------------------------------------
// Constants: IDs verified against live DB (2026-06-18)
// ---------------------------------------------------------------------------

// Canonical room IDs (never change; these are the target/keeper rows)
const ID = {
  LOWER_GUEST_BEDROOM: 1,      // was lower-bedroom-1
  LOWER_FAMILY_ROOM: 2,        // keep code; merges living_room in
  LOWER_GUEST_BATH: 3,         // was lower-bath-1
  LOWER_LAUNDRY: 4,            // unchanged
  LOWER_STORAGE: 5,            // DELETE (no photos)
  LOWER_GARAGE: 6,             // unchanged
  STREET_FRONT_DOOR: 7,        // was lower-entryway (renamed + split)
  OUTSIDE_PATIO: 8,            // was lower-patio (renamed + floor → outside)
  LOWER_REAR_PATIO: 9,         // merge into outside-patio → DELETE
  OUTSIDE_BACKYARD: 10,        // was lower-backyard (renamed + floor → outside)
  PRIMARY_BEDROOM: 11,         // was upper-primary-bedroom
  JASON_OFFICE: 12,            // was upper-bedroom-2 (coord swap)
  JUSTIN_OFFICE: 13,           // was upper-bedroom-3 (coord swap)
  UPPER_LIVING_ROOM: 14,       // was upper-living-dining
  UPPER_KITCHEN: 15,           // was upper-kitchen-breakfast
  UPPER_HALL_BATH: 16,         // was upper-bath-1
  UPPER_BATH_2_COORD_DONOR: 17,// DELETE after donating coord to primary-bathroom
  UPPER_LIGHTWELL: 18,         // unchanged
  UPPER_STAIR_LANDING: 19,     // was upper-workshop
  UPPER_DECK: 20,              // DELETE (does not physically exist)
} as const;

// Drift room IDs (to be merged away + deleted)
const DRIFT = {
  PRIMARY_BATHROOM: 2330293,   // → primary-bathroom (keep this row, rename only)
  ENTRY_FOYER: 2330294,        // → lower-foyer (keep this row, rename only)
  KITCHEN: 2330295,            // merge into upper-kitchen (id=15) → DELETE
  GUEST_BATHROOM: 2330296,     // merge into lower-guest-bath (id=3) → DELETE
  HALL_BATHROOM: 2330297,      // merge into upper-hall-bath (id=16) → DELETE
  GUEST_BEDROOM: 2330298,      // merge into lower-guest-bedroom (id=1) → DELETE
  LIVING_ROOM: 2330299,        // merge into lower-family-room (id=2) → DELETE
  FAMILY_ROOM: 2330300,        // merge into upper-living-room (id=14) → DELETE
  BACKYARD: 2330301,           // merge into outside-backyard (id=10) → DELETE
} as const;

// Outside floor id (live DB verified)
const OUTSIDE_FLOOR_ID = 233121;
const OUTSIDE_FLOOR_KEY = "outside";

// Image IDs: keep on street-front-door (all others from room 7 → lower-foyer)
const STREET_FRONT_DOOR_ALLOWLIST = new Set([
  "fd965547-fe96-4d7a-9a2e-321c0e05f852", // Brick Garage Entrance
  "4ce41f86-905a-4efe-babd-98c0c47063d1", // Minimalist Entryway with Dark Gray Door
]);

// Image IDs to move from upper-living-dining (14) to upper-dining-room (new)
const DINING_ROOM_IMAGES = [
  "ce4f317d-a95e-470c-81ba-a1838a75fb4d",
  "4ac13ec3-c491-4662-b87a-1b9d2fd77c63",
];

// Image IDs to move from upper-living-dining (14) to upper-stair-landing (19)
const STAIR_LANDING_IMAGES = [
  "22cef674-571f-4416-b97e-d4b7dc3a4763",
  "a2a0d96c-5247-4406-9cc4-c70a857662f7",
];

// Duplicate image IDs to hard-delete (D1 + CF Images)
const DUPLICATE_IMAGE_IDS = [
  "4a06d3af-d8ac-4577-87bb-32a228175898",
  "1343677a-db36-4252-85d6-e965dd9c2779",
];

// ---------------------------------------------------------------------------
// Coordinate seed (§4.2) — post-reconciliation final positions
// ---------------------------------------------------------------------------

/** floor_key → x_pct → y_pct for every placed room (null xy = no dot). */
const FINAL_COORDINATES: Array<{
  code: string;
  floorKey: string;
  xPct: number | null;
  yPct: number | null;
}> = [
  { code: "lower-guest-bedroom",  floorKey: "lower_level", xPct: 33,   yPct: 28   },
  { code: "lower-family-room",    floorKey: "lower_level", xPct: 18,   yPct: 34   },
  { code: "lower-guest-bath",     floorKey: "lower_level", xPct: 34,   yPct: 43   },
  { code: "lower-laundry",        floorKey: "lower_level", xPct: 26,   yPct: 49   },
  { code: "lower-garage",         floorKey: "lower_level", xPct: 25,   yPct: 77   },
  { code: "street-front-door",    floorKey: "lower_level", xPct: 7,    yPct: 89   },
  { code: "lower-foyer",          floorKey: "lower_level", xPct: 7,    yPct: 52   },
  { code: "outside-patio",        floorKey: "outside",     xPct: 27,   yPct: 10   },
  { code: "outside-backyard",     floorKey: "outside",     xPct: null, yPct: null }, // no dot
  { code: "primary-bedroom",      floorKey: "upper_level", xPct: 82,   yPct: 21   },
  { code: "jason-office",         floorKey: "upper_level", xPct: 66,   yPct: 52   },
  { code: "justin-office",        floorKey: "upper_level", xPct: 64,   yPct: 21   },
  { code: "upper-living-room",    floorKey: "upper_level", xPct: 84,   yPct: 72   },
  { code: "upper-dining-room",    floorKey: "upper_level", xPct: 84,   yPct: 62   }, // user-specified
  { code: "upper-kitchen",        floorKey: "upper_level", xPct: 65,   yPct: 76   },
  { code: "upper-hall-bath",      floorKey: "upper_level", xPct: 64,   yPct: 32   },
  { code: "upper-lightwell",      floorKey: "upper_level", xPct: 67,   yPct: 39   },
  { code: "upper-stair-landing",  floorKey: "upper_level", xPct: 78,   yPct: 49   },
  { code: "primary-bathroom",     floorKey: "upper_level", xPct: 88,   yPct: 39   },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Delete an image via the deployed Worker's REST API (handles CF Images + D1).
 *
 * Requires CF_WORKER_URL environment variable pointing at the live Worker,
 * e.g. https://core-remodel.<zone>.workers.dev.
 * Also requires CF_ADMIN_TOKEN (bearer token with images:write scope).
 *
 * Falls back to D1-only deletion (hardDeleteImageFromD1) if the Worker URL
 * is not set, with a loud warning — the CF asset will become an orphan and
 * must be cleaned up manually in the Cloudflare Images dashboard.
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

/** Log a named step and capture timing. */
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
}> {
  const allImages = await db.select({ id: images.id }).from(images).all();
  const imagesWithRoom = await db
    .select({ id: images.id })
    .from(images)
    .where(not(isNull(images.roomId)))
    .all();
  const inspRows = await db
    .select({ id: inspirationalImageRooms.id })
    .from(inspirationalImageRooms)
    .all();

  return {
    totalImages: allImages.length,
    imagesWithRoom: imagesWithRoom.length,
    inspirationRows: inspRows.length,
  };
}

// ---------------------------------------------------------------------------
// Main
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

  // ------------------------------------------------------------------
  // PRE-RUN SNAPSHOT
  // ------------------------------------------------------------------
  console.log("\n====== 0005 Room Reconciliation — Pre-run Snapshot ======");
  const pre = await snapshotCounts(db);
  console.log(
    `  images total: ${pre.totalImages} | with room_id: ${pre.imagesWithRoom} | inspiration rows: ${pre.inspirationRows}`,
  );

  if (opts.dryRun) {
    console.log("\n[DRY RUN] Exiting without making changes.");
    return;
  }

  // ==================================================================
  // LOWER LEVEL
  // ==================================================================

  // L1: Rename lower-bedroom-1 → lower-guest-bedroom
  await step("L1: rename lower-bedroom-1 → lower-guest-bedroom", async () => {
    await renameRoom(db, ID.LOWER_GUEST_BEDROOM, {
      newCode: "lower-guest-bedroom",
      newName: "Guest Bedroom",
    });
  });

  // L1b: Merge drift guest_bedroom into lower-guest-bedroom
  await step("L1b: merge guest_bedroom (2330298) → lower-guest-bedroom", async () => {
    const result = await mergeRooms(db, DRIFT.GUEST_BEDROOM, ID.LOWER_GUEST_BEDROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L2: Merge living_room into lower-family-room
  await step("L2: merge living_room (2330299) → lower-family-room (2)", async () => {
    const result = await mergeRooms(db, DRIFT.LIVING_ROOM, ID.LOWER_FAMILY_ROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L3: Rename lower-bath-1 → lower-guest-bath
  await step("L3: rename lower-bath-1 → lower-guest-bath", async () => {
    await renameRoom(db, ID.LOWER_GUEST_BATH, {
      newCode: "lower-guest-bath",
      newName: "Guest Bath",
    });
  });

  // L3b: Merge drift guest_bathroom into lower-guest-bath
  await step("L3b: merge guest_bathroom (2330296) → lower-guest-bath", async () => {
    const result = await mergeRooms(db, DRIFT.GUEST_BATHROOM, ID.LOWER_GUEST_BATH);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L4: Rename lower-patio → outside-patio, move floor to outside
  await step("L4: rename lower-patio → outside-patio (floor → outside)", async () => {
    await renameRoom(db, ID.OUTSIDE_PATIO, {
      newCode: "outside-patio",
      newName: "Patio",
      floorKey: OUTSIDE_FLOOR_KEY,
    });
  });

  // L4b: Merge lower-rear-patio into outside-patio
  await step("L4b: merge lower-rear-patio (9) → outside-patio", async () => {
    const result = await mergeRooms(db, ID.LOWER_REAR_PATIO, ID.OUTSIDE_PATIO);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L5: Rename lower-backyard → outside-backyard, move floor to outside
  await step("L5: rename lower-backyard → outside-backyard (floor → outside)", async () => {
    await renameRoom(db, ID.OUTSIDE_BACKYARD, {
      newCode: "outside-backyard",
      newName: "Backyard",
      floorKey: OUTSIDE_FLOOR_KEY,
    });
  });

  // L5b: Merge drift backyard into outside-backyard
  await step("L5b: merge backyard (2330301) → outside-backyard", async () => {
    const result = await mergeRooms(db, DRIFT.BACKYARD, ID.OUTSIDE_BACKYARD);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // L7 FIRST: Rename entry_foyer → lower-foyer (must exist before the L6 split)
  await step("L7 (pre-L6): rename entry_foyer (2330294) → lower-foyer", async () => {
    await renameRoom(db, DRIFT.ENTRY_FOYER, {
      newCode: "lower-foyer",
      newName: "Foyer",
    });
  });

  // L6: Rename lower-entryway → street-front-door, split photos
  //
  // Allowlist approach:
  //   Keep images fd965547 + 4ce41f86 on street-front-door (room 7).
  //   Move ALL OTHER images currently on room 7 to lower-foyer (2330294).
  //
  // "Other images" = images.room_id=7 excluding the 2 allowlisted IDs.
  // inspirational_image_rooms rows for room 7 also move (except the 2 allowlisted).
  await step("L6: rename lower-entryway → street-front-door + photo split", async () => {
    await renameRoom(db, ID.STREET_FRONT_DOOR, {
      newCode: "street-front-door",
      newName: "Front Door / Street",
    });

    // --- listing photos (images.room_id) ---
    const listingOnRoom7 = await db
      .select({ id: images.id })
      .from(images)
      .where(eq(images.roomId, ID.STREET_FRONT_DOOR))
      .all();

    const listingToMove = listingOnRoom7
      .map((r) => r.id)
      .filter((id) => !STREET_FRONT_DOOR_ALLOWLIST.has(id));

    if (listingToMove.length > 0) {
      await reassignImages(db, listingToMove, DRIFT.ENTRY_FOYER);
      console.log(`  moved ${listingToMove.length} listing images → lower-foyer`);
    }

    // --- inspiration mappings (inspirational_image_rooms) ---
    const inspOnRoom7 = await db
      .select({ id: inspirationalImageRooms.id, imageId: inspirationalImageRooms.imageId })
      .from(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.roomId, ID.STREET_FRONT_DOOR))
      .all();

    const inspToMove = inspOnRoom7.filter((r) => !STREET_FRONT_DOOR_ALLOWLIST.has(r.imageId));

    if (inspToMove.length > 0) {
      // Add to lower-foyer (dedupe-safe), then remove from street-front-door
      await addInspirationToRoom(
        db,
        inspToMove.map((r) => r.imageId),
        DRIFT.ENTRY_FOYER,
      );
      await removeInspirationFromRoom(
        db,
        inspToMove.map((r) => r.imageId),
        ID.STREET_FRONT_DOOR,
      );
      console.log(`  moved ${inspToMove.length} inspiration rows → lower-foyer`);
    }
  });

  // L8: Delete lower-storage (id=5, no photos)
  await step("L8: delete lower-storage (id=5)", async () => {
    await deleteRoom(db, ID.LOWER_STORAGE);
    console.log(`  deleted room id=${ID.LOWER_STORAGE}`);
  });

  // ==================================================================
  // UPPER LEVEL
  // ==================================================================

  // U1: Rename upper-primary-bedroom → primary-bedroom
  await step("U1: rename upper-primary-bedroom → primary-bedroom", async () => {
    await renameRoom(db, ID.PRIMARY_BEDROOM, {
      newCode: "primary-bedroom",
      newName: "Primary Bedroom",
    });
  });

  // U2: Rename drift primary_bathroom → primary-bathroom
  await step("U2: rename primary_bathroom (2330293) → primary-bathroom", async () => {
    await renameRoom(db, DRIFT.PRIMARY_BATHROOM, {
      newCode: "primary-bathroom",
      newName: "Primary Bathroom",
    });
  });

  // U2b: Merge upper-bath-2 (id=17, coord donor) into primary-bathroom (drift row 2330293)
  await step("U2b: merge upper-bath-2 (17) → primary-bathroom (2330293)", async () => {
    const result = await mergeRooms(db, ID.UPPER_BATH_2_COORD_DONOR, DRIFT.PRIMARY_BATHROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U3: Rename upper-bedroom-2 → jason-office (coordinate from upper-bedroom-3 position)
  await step("U3: rename upper-bedroom-2 → jason-office", async () => {
    await renameRoom(db, ID.JASON_OFFICE, {
      newCode: "jason-office",
      newName: "Jason's Office",
    });
    // Coordinate set in the final seed step; spec: (66,52 upper) — from upper-bedroom-3's old pos.
  });

  // U4: Rename upper-bedroom-3 → justin-office (coordinate from upper-bedroom-2 position)
  await step("U4: rename upper-bedroom-3 → justin-office", async () => {
    await renameRoom(db, ID.JUSTIN_OFFICE, {
      newCode: "justin-office",
      newName: "Justin's Office",
    });
    // Coordinate set in the final seed step; spec: (64,21 upper) — from upper-bedroom-2's old pos.
  });

  // U5: Rename upper-living-dining → upper-living-room
  await step("U5: rename upper-living-dining → upper-living-room", async () => {
    await renameRoom(db, ID.UPPER_LIVING_ROOM, {
      newCode: "upper-living-room",
      newName: "Living Room",
    });
  });

  // U5b: Create upper-dining-room + assign the 2 dining images to it
  //
  // The new room is a canonical kebab-code room that didn't exist before.
  // We insert it directly (no mergeRooms needed).  The listing images
  // ce4f317d + 4ac13ec3 are currently on room 14 (now upper-living-room);
  // reassignImages moves them to the new room.
  await step(
    "U5b: create upper-dining-room + move ce4f317d + 4ac13ec3 from room 14",
    async () => {
      // Find the upper_level floor id.
      const upperFloor = await db
        .select()
        .from(floors)
        .where(eq(floors.key, "upper_level"))
        .get();
      if (!upperFloor) throw new Error("upper_level floor not found");

      // Insert idempotently (onConflict on room_code unique).
      await db
        .insert(rooms)
        .values({
          floorId: upperFloor.id,
          roomCode: "upper-dining-room",
          roomName: "Dining Room",
          asIsUse: "Dining Room",
          isLivingSpace: true,
          floorplanFloorKey: "upper_level",
          floorplanXPct: 84,
          floorplanYPct: 62,
        })
        .onConflictDoNothing()
        .run();

      const diningRoom = await db
        .select()
        .from(rooms)
        .where(eq(rooms.roomCode, "upper-dining-room"))
        .get();
      if (!diningRoom) throw new Error("upper-dining-room could not be created");

      // Move listing images from upper-living-room → upper-dining-room.
      await reassignImages(db, DINING_ROOM_IMAGES, diningRoom.id);
      console.log(`  moved ${DINING_ROOM_IMAGES.length} listing images → upper-dining-room`);

      // Also add as inspiration to upper-dining-room if they have inspiration mappings.
      // (They're listing photos on room 14 — no separate inspiration rows needed,
      //  but addInspirationToRoom is a no-op for images not in insp table.)
    },
  );

  // U5c: Merge family_room (2330300) → upper-living-room (14)
  await step("U5c: merge family_room (2330300) → upper-living-room (14)", async () => {
    const result = await mergeRooms(db, DRIFT.FAMILY_ROOM, ID.UPPER_LIVING_ROOM);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U5d: Hard-delete duplicate images 4a06d3af + 1343677a
  //      via the Worker API (handles CF Images + D1).
  await step("U5d: hard-delete duplicate images 4a06d3af + 1343677a", async () => {
    for (const imageId of DUPLICATE_IMAGE_IDS) {
      await deleteImageViaWorker(db, imageId, workerBaseUrl, adminToken);
    }
  });

  // U10 (before U6 so upper-stair-landing exists for the image move below)
  await step("U10: rename upper-workshop → upper-stair-landing", async () => {
    await renameRoom(db, ID.UPPER_STAIR_LANDING, {
      newCode: "upper-stair-landing",
      newName: "Stair Landing",
    });

    // Move images 22cef674 + a2a0d96c from upper-living-room (14) → upper-stair-landing (19).
    await reassignImages(db, STAIR_LANDING_IMAGES, ID.UPPER_STAIR_LANDING);
    console.log(`  moved ${STAIR_LANDING_IMAGES.length} listing images → upper-stair-landing`);
  });

  // U6: Rename upper-bath-1 → upper-hall-bath
  await step("U6: rename upper-bath-1 → upper-hall-bath", async () => {
    await renameRoom(db, ID.UPPER_HALL_BATH, {
      newCode: "upper-hall-bath",
      newName: "Hall Bath",
    });
  });

  // U6b: Merge hall_bathroom (2330297) → upper-hall-bath (16)
  await step("U6b: merge hall_bathroom (2330297) → upper-hall-bath (16)", async () => {
    const result = await mergeRooms(db, DRIFT.HALL_BATHROOM, ID.UPPER_HALL_BATH);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U7: Rename upper-kitchen-breakfast → upper-kitchen
  await step("U7: rename upper-kitchen-breakfast → upper-kitchen", async () => {
    await renameRoom(db, ID.UPPER_KITCHEN, {
      newCode: "upper-kitchen",
      newName: "Kitchen",
    });
  });

  // U7b: Merge drift kitchen (2330295) → upper-kitchen (15)  [71 inspiration photos]
  await step("U7b: merge kitchen (2330295) → upper-kitchen (15)", async () => {
    const result = await mergeRooms(db, DRIFT.KITCHEN, ID.UPPER_KITCHEN);
    console.log(`  repointed:`, result.rowsRepointed);
  });

  // U9: Delete upper-deck (20, no photos)
  await step("U9: delete upper-deck (id=20)", async () => {
    await deleteRoom(db, ID.UPPER_DECK);
    console.log(`  deleted room id=${ID.UPPER_DECK}`);
  });

  // ==================================================================
  // COORDINATES (§4.2)
  // Set floorplan positions on all surviving rooms.
  // ==================================================================
  await step("COORDINATES: seed §4.2 floorplan positions", async () => {
    for (const coord of FINAL_COORDINATES) {
      // resolveRoom will throw if the room doesn't exist yet (e.g. upper-dining-room
      // was just created above).  That's a programming error — all rooms in
      // FINAL_COORDINATES must exist at this point.
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

  // ==================================================================
  // POST-RUN VERIFICATION
  // ==================================================================
  console.log("\n====== Post-run Verification ======");
  const post = await snapshotCounts(db);

  // Expect: total images reduced by 2 (the hard-deleted duplicates)
  const expectedTotal = pre.totalImages - DUPLICATE_IMAGE_IDS.length;
  const totalOk = post.totalImages === expectedTotal;
  console.log(
    `  images total: ${post.totalImages} (expected ${expectedTotal}) ${totalOk ? "OK" : "MISMATCH"}`,
  );

  // Verify drift rooms are gone
  for (const [name, driftId] of Object.entries(DRIFT)) {
    const still = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.id, driftId))
      .get();
    if (still) {
      console.warn(`  WARN: drift room ${name} (id=${driftId}) still exists!`);
    } else {
      console.log(`  drift ${name} (${driftId}): gone OK`);
    }
  }

  // Verify deleted canonical rooms are gone
  for (const [name, delId] of [
    ["lower-storage", ID.LOWER_STORAGE],
    ["upper-bath-2 (coord donor)", ID.UPPER_BATH_2_COORD_DONOR],
    ["upper-deck", ID.UPPER_DECK],
  ] as const) {
    const still = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.id, delId))
      .get();
    console.log(`  ${name} (${delId}): ${still ? "STILL EXISTS (error!)" : "gone OK"}`);
  }

  // Verify final rooms exist
  for (const coord of FINAL_COORDINATES) {
    const r = await db
      .select({ id: rooms.id, code: rooms.roomCode, xPct: rooms.floorplanXPct })
      .from(rooms)
      .where(eq(rooms.roomCode, coord.code))
      .get();
    if (!r) {
      console.warn(`  MISSING room: ${coord.code}`);
    } else {
      console.log(`  ${coord.code} (id=${r.id}) x=${r.xPct ?? "null"}: OK`);
    }
  }

  console.log(
    `\n====== Reconciliation complete. inspiration_rows: ${post.inspirationRows} ======`,
  );
}
