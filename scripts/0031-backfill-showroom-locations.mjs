#!/usr/bin/env node
/**
 * @fileoverview One-off backfill (plan 0031): copy each `showroom_stores` row's
 * location data into ONE `showroom_store_locations` row (the 1:many model — one
 * store owns many location rows; this seeds the first one per store).
 *
 * RUN ORDER: after the create-table migration (0145, merged in #278) is applied
 * to the target DB, and BEFORE the later column-drop migration (this reads the
 * old `showroom_stores` location columns).
 *
 * Copies: place_id, google_maps_link, bay_area_city_id, lat/lng, the granular
 * address parts, zip (COALESCE location_zip_code, zip_code), and the notes into
 * the PlateJS triple (plaintext seeds both `notes` and `notes_markdown`;
 * `notes_html` is left null until re-authored). It does NOT copy
 * `location_address` — that column is a parse-source only and is not stored on
 * the new table (display is derived from the parts). Rows whose parts are null
 * but whose `location_address` has a value are a follow-up parse-gap-fill step.
 *
 * Idempotent — the NOT EXISTS guard (one location per store_id) means re-runs
 * insert nothing new. `main_poc_*` → showroom_store_contacts is handled
 * separately (the existing contacts backfill), not here.
 *
 * Usage:
 *   node scripts/0031-backfill-showroom-locations.mjs --remote --dry-run
 *   node scripts/0031-backfill-showroom-locations.mjs --remote
 *   node scripts/0031-backfill-showroom-locations.mjs --local
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = "core-remodel";

// One location row per store. NOT EXISTS(location for this store) makes re-runs
// no-ops. `notes` + `notes_markdown` both seed from the plain location_notes;
// notes_html stays null. location_address is intentionally NOT copied.
const stmt = `INSERT INTO showroom_store_locations
  (store_id, place_id, google_maps_link, bay_area_city_id, latitude, longitude,
   street_number, street_name, city, state, zip_code, notes, notes_markdown)
SELECT
  s.id, s.place_id, s.google_maps_link, s.bay_area_city_id, s.latitude, s.longitude,
  s.location_street_number, s.location_street_name, s.location_city, s.location_state,
  COALESCE(s.location_zip_code, s.zip_code),
  s.location_notes, s.location_notes
FROM showroom_stores s
WHERE NOT EXISTS (
  SELECT 1 FROM showroom_store_locations l WHERE l.store_id = s.id
);`;

const verify = `SELECT
  (SELECT COUNT(*) FROM showroom_stores) AS stores,
  (SELECT COUNT(*) FROM showroom_store_locations) AS locations,
  (SELECT COUNT(*) FROM showroom_store_locations WHERE street_name IS NULL AND street_number IS NULL) AS locations_missing_street;`;

const args = process.argv.slice(2);
const mode = args.includes("--remote") ? "--remote" : "--local";

if (args.includes("--dry-run")) {
  console.log(stmt);
  console.log("\n-- verify --\n" + verify);
  process.exit(0);
}

const file = join(tmpdir(), `backfill-showroom-locations-${process.pid}.sql`);
writeFileSync(file, stmt + "\n");
console.log(`applying INSERT…SELECT (${mode}) from ${file} ...`);
execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
  encoding: "utf8",
  stdio: "inherit",
  maxBuffer: 64 * 1024 * 1024,
});

console.log("\nverifying counts ...");
execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--command", verify, "--yes"], {
  encoding: "utf8",
  stdio: "inherit",
  maxBuffer: 64 * 1024 * 1024,
});
console.log("done");
