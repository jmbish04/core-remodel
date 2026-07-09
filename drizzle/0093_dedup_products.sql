-- Build a survivor map: loser_id -> keeper_id for duplicate (brand_id, model_key).
-- NOTE: D1 rejects CREATE TEMP TABLE with SQLITE_AUTH when executed as a standalone
-- statement (confirmed against local D1 in this build), so this uses a plain table,
-- which the final statement below still DROPs to avoid leaving scratch state behind.
CREATE TABLE _dup_map AS
SELECT p.id AS loser_id, k.keeper_id
FROM showroom_store_products p
JOIN (
  SELECT brand_id, model_key, MIN(id) AS keeper_id
  FROM showroom_store_products
  WHERE model_key IS NOT NULL
  GROUP BY brand_id, model_key
  HAVING COUNT(*) > 1
) k ON k.brand_id IS p.brand_id AND k.model_key = p.model_key
WHERE p.id <> k.keeper_id;
--> statement-breakpoint
-- showroom_product_mappings has a UNIQUE(showroom_id, product_id) index, enforced
-- per-row (not deferred) by SQLite/D1. Re-pointing a loser's mapping row to the
-- keeper would collide if the keeper already has a mapping for that showroom, so
-- pre-delete any loser mapping whose (showroom_id, keeper_id) pair already exists
-- BEFORE the UPDATE runs (this is the same collapse the brief describes, just
-- reordered ahead of the UPDATE so the UNIQUE constraint never fires).
DELETE FROM showroom_product_mappings
WHERE product_id IN (SELECT loser_id FROM _dup_map)
  AND EXISTS (
    SELECT 1 FROM showroom_product_mappings keep
    JOIN _dup_map d ON d.loser_id = showroom_product_mappings.product_id
    WHERE keep.showroom_id = showroom_product_mappings.showroom_id
      AND keep.product_id = d.keeper_id
  );
--> statement-breakpoint
UPDATE showroom_product_mappings SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_material_mappings SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_images SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_specs SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_docs SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_research SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_rating SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_notes SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_pa_mapping SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE store_product_tag_mapping SET store_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = store_product_id) WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_price_observations SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE product_showroom_photos SET product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = product_id) WHERE product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
UPDATE material_schedule_items SET purchased_showroom_product_id = (SELECT keeper_id FROM _dup_map WHERE loser_id = purchased_showroom_product_id) WHERE purchased_showroom_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
-- store_product_intel is 1:1 on product: delete a loser's intel BEFORE deleting the
-- loser, keeping the survivor's row (avoids a duplicate-key clash on re-point).
DELETE FROM store_product_intel WHERE store_product_id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
-- Collapse now-duplicate (showroom, product) mapping pairs created by re-pointing.
DELETE FROM showroom_product_mappings
WHERE id NOT IN (SELECT MIN(id) FROM showroom_product_mappings GROUP BY showroom_id, product_id);
--> statement-breakpoint
-- Finally delete the loser product rows.
DELETE FROM showroom_store_products WHERE id IN (SELECT loser_id FROM _dup_map);
--> statement-breakpoint
DROP TABLE _dup_map;
