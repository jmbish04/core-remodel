-- 0045 P1 — seed showroom_store_locations from the legacy flat columns on showroom_stores.
--
-- WHY THIS IS NOT A DRIZZLE MIGRATION: it moves DATA, not schema. The table itself shipped
-- in migration 0145 (PR #278, "0031 Phase A") and then nothing was ever written to it — 0 rows
-- against 221 stores. Every read/write in the app still uses the flat columns, so this backfill
-- is what makes the 1:many model real without changing a single existing behaviour.
--
-- Apply:
--   npx wrangler d1 execute core-remodel --remote --file scripts/sql/backfill_showroom_store_locations.sql
--
-- IDEMPOTENT: the NOT EXISTS guard makes a second run a no-op. Safe to re-run after new stores
-- are created by any writer that has not yet been taught about locations.
--
-- NOTE: there is deliberately no `location_address` column on the target table — a formatted
-- address is a parse SOURCE only and the display string is derived (see formatShowroomAddress).
INSERT INTO showroom_store_locations (
  store_id,
  place_id,
  google_maps_link,
  bay_area_city_id,
  latitude,
  longitude,
  street_number,
  street_name,
  city,
  state,
  zip_code,
  notes
)
SELECT
  s.id,
  s.place_id,
  s.google_maps_link,
  s.bay_area_city_id,
  s.latitude,
  s.longitude,
  s.location_street_number,
  s.location_street_name,
  s.location_city,
  s.location_state,
  -- location_zip_code is canonical; zip_code is the legacy twin kept in sync.
  COALESCE(s.location_zip_code, s.zip_code),
  s.location_notes
FROM showroom_stores s
WHERE NOT EXISTS (
  SELECT 1 FROM showroom_store_locations l WHERE l.store_id = s.id
);
