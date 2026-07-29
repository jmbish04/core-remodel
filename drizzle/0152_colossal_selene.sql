-- 0039 P3 — material_schedule_items cleanup.
--
-- Drop the denormalized brand/model columns and consolidate the purchased-product
-- pointer onto `product_id`. `purchased_showroom_product_id` carried a real
-- FK -> products(id) on the DB (a pre-existing schema/DB divergence: the drizzle
-- column was declared plain), so it is RENAMED (preserving that FK) rather than
-- dropped, and the redundant plain `product_id` that 0151 added is dropped first.
-- RENAME/DROP COLUMN are native on D1's SQLite (>=3.35) — no table rebuild, so no
-- ON DELETE CASCADE fires against the child tables that FK material_schedule_items.
ALTER TABLE `material_schedule_items` DROP COLUMN `brand`;--> statement-breakpoint
ALTER TABLE `material_schedule_items` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `material_schedule_items` DROP COLUMN `product_id`;--> statement-breakpoint
ALTER TABLE `material_schedule_items` RENAME COLUMN `purchased_showroom_product_id` TO `product_id`;
