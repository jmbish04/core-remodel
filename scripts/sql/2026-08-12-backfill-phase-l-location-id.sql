-- Phase L (plan 0031) — backfill location_id on showroom content tables to each store's
-- PRIMARY location. Primary is DERIVED (never stored): the location whose place_id matches
-- the parent store's place_id, else the lowest-id location. The ORDER BY below mirrors
-- services/showroom/locations.ts markPrimary() exactly:
--   (place_id matches parent) DESC  -> the matching site first
--   l.id ASC                        -> else the lowest id
-- Only fills rows that have a store and a null location_id (idempotent, re-runnable).
-- Reversible: UPDATE <t> SET location_id = NULL restores the pre-backfill state.

UPDATE store_notes SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = store_notes.store_id
  WHERE l.store_id = store_notes.store_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE store_id IS NOT NULL AND location_id IS NULL;

UPDATE showroom_store_ratings SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = showroom_store_ratings.store_id
  WHERE l.store_id = showroom_store_ratings.store_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE store_id IS NOT NULL AND location_id IS NULL;

UPDATE store_rating SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = store_rating.store_id
  WHERE l.store_id = store_rating.store_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE store_id IS NOT NULL AND location_id IS NULL;

UPDATE showroom_images SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = showroom_images.store_id
  WHERE l.store_id = showroom_images.store_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE store_id IS NOT NULL AND location_id IS NULL;

UPDATE showroom_photos_mapping SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = showroom_photos_mapping.showroom_id
  WHERE l.store_id = showroom_photos_mapping.showroom_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE showroom_id IS NOT NULL AND location_id IS NULL;

UPDATE product_showroom_photos SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = product_showroom_photos.showroom_id
  WHERE l.store_id = product_showroom_photos.showroom_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE showroom_id IS NOT NULL AND location_id IS NULL;

UPDATE product_price_observations SET location_id = (
  SELECT l.id FROM showroom_store_locations l
  JOIN showroom_stores s ON s.id = product_price_observations.showroom_id
  WHERE l.store_id = product_price_observations.showroom_id
  ORDER BY (l.place_id IS NOT NULL AND l.place_id = s.place_id) DESC, l.id ASC
  LIMIT 1
) WHERE showroom_id IS NOT NULL AND location_id IS NULL;
