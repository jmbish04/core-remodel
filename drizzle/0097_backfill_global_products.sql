-- Backfill modelNumber from sku where a sku exists and modelNumber is empty.
UPDATE showroom_store_products
SET model_number = sku
WHERE model_number IS NULL AND sku IS NOT NULL AND trim(sku) <> '';
--> statement-breakpoint
-- Derive modelKey = uppercase(model_number) with non-alphanumerics stripped.
-- SQLite has no regexp_replace; strip the common separators seen in model #s.
UPDATE showroom_store_products
SET model_key = upper(
  replace(replace(replace(replace(replace(model_number,' ',''),'-',''),'/',''),'.',''),'#','')
)
WHERE model_number IS NOT NULL AND trim(model_number) <> '';
--> statement-breakpoint
-- Ensure each product's owning store exists as a showroom_product_mapping.
INSERT INTO showroom_product_mappings (showroom_id, product_id, created_at)
SELECT p.store_id, p.id, unixepoch()
FROM showroom_store_products p
WHERE p.store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM showroom_product_mappings m
    WHERE m.showroom_id = p.store_id AND m.product_id = p.id
  );
--> statement-breakpoint
-- Create one showroom price observation per product that carries a price.
INSERT INTO product_price_observations
  (product_id, source_type, showroom_id, price, discount_info, lead_time,
   condition, observed_at, confidence, review_status, created_at, updated_at)
SELECT p.id, 'showroom', p.store_id, p.price,
       coalesce(p.possible_discounts, p.trade_discount), p.lead_time,
       'new', coalesce(p.updated_at, unixepoch()), 100, 'approved',
       unixepoch(), unixepoch()
FROM showroom_store_products p
WHERE p.price IS NOT NULL AND trim(p.price) <> '';
--> statement-breakpoint
-- Derive numeric price_cents from the copied text price (strip $ , spaces; ×100).
-- Only for rows that look numeric (contain a digit, no letters) so "call for
-- pricing" stays text with a NULL numeric.
UPDATE product_price_observations
SET price_cents = CAST(round(
  CAST(replace(replace(replace(price,'$',''),',',''),' ','') AS REAL) * 100
) AS INTEGER)
WHERE price IS NOT NULL
  AND price GLOB '*[0-9]*'
  AND price NOT GLOB '*[A-Za-z]*';
