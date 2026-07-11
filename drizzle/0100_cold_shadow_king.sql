CREATE TABLE `__bak_store_product_docs` AS SELECT * FROM `store_product_docs`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_research` AS SELECT * FROM `store_product_research`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_pa_mapping` AS SELECT * FROM `store_product_pa_mapping`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_notes` AS SELECT * FROM `store_product_notes`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_similar_model_map` AS SELECT * FROM `store_product_similar_model_map`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_tag_mapping` AS SELECT * FROM `store_product_tag_mapping`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_rating` AS SELECT * FROM `store_product_rating`;--> statement-breakpoint
CREATE TABLE `__bak_product_images` AS SELECT * FROM `product_images`;--> statement-breakpoint
CREATE TABLE `__bak_product_specs` AS SELECT * FROM `product_specs`;--> statement-breakpoint
CREATE TABLE `__bak_showroom_product_mappings` AS SELECT * FROM `showroom_product_mappings`;--> statement-breakpoint
CREATE TABLE `__bak_store_product_intel` AS SELECT * FROM `store_product_intel`;--> statement-breakpoint
CREATE TABLE `__bak_product_material_mappings` AS SELECT * FROM `product_material_mappings`;--> statement-breakpoint
CREATE TABLE `__bak_product_showroom_photos` AS SELECT * FROM `product_showroom_photos`;--> statement-breakpoint
CREATE TABLE `__bak_product_price_observations` AS SELECT * FROM `product_price_observations`;--> statement-breakpoint
CREATE TABLE `__bak_showroom_scan_log` AS SELECT * FROM `showroom_scan_log`;--> statement-breakpoint
CREATE TABLE `__bak_material_schedule_items` AS SELECT * FROM `material_schedule_items`;--> statement-breakpoint
CREATE TABLE `__bak_wishlist_items` AS SELECT * FROM `wishlist_items`;--> statement-breakpoint
/*
 SQLite does not support "Dropping foreign key" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually

 CASCADE-SAFETY NOTE: D1 fires ON DELETE CASCADE triggers on the `DROP TABLE`
 below and ignores `PRAGMA foreign_keys=OFF`, so a naive rebuild wipes every
 child row that references `showroom_store_products`. This migration is
 wrapped: back up every child table before the rebuild (above), then restore
 CASCADE children via re-INSERT and SET-NULL children via id-matched UPDATE
 after the rebuild (below), then drop the backup tables.
*/--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_showroom_store_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer,
	`brand_id` integer,
	`timestamp` integer DEFAULT (unixepoch()),
	`item_name` text NOT NULL,
	`description` text,
	`colors` text,
	`preferred_color` text,
	`sku` text,
	`price` text,
	`json_details` text,
	`notes` text,
	`lead_time` text,
	`possible_discounts` text,
	`trade_discount` text,
	`product_type` text,
	`model_number` text,
	`model_key` text,
	`msrp` text,
	`msrp_cents` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_showroom_store_products`("id", "material_id", "brand_id", "timestamp", "item_name", "description", "colors", "preferred_color", "sku", "price", "json_details", "notes", "lead_time", "possible_discounts", "trade_discount", "product_type", "model_number", "model_key", "msrp", "msrp_cents", "created_at", "updated_at") SELECT "id", "material_id", "brand_id", "timestamp", "item_name", "description", "colors", "preferred_color", "sku", "price", "json_details", "notes", "lead_time", "possible_discounts", "trade_discount", "product_type", "model_number", "model_key", "msrp", "msrp_cents", "created_at", "updated_at" FROM `showroom_store_products`;--> statement-breakpoint
DROP TABLE `showroom_store_products`;--> statement-breakpoint
ALTER TABLE `__new_showroom_store_products` RENAME TO `showroom_store_products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_store_products_brand_model_uniq` ON `showroom_store_products` (`brand_id`,`model_key`);--> statement-breakpoint
INSERT INTO `store_product_docs` SELECT * FROM `__bak_store_product_docs`;--> statement-breakpoint
INSERT INTO `store_product_research` SELECT * FROM `__bak_store_product_research`;--> statement-breakpoint
INSERT INTO `store_product_pa_mapping` SELECT * FROM `__bak_store_product_pa_mapping`;--> statement-breakpoint
INSERT INTO `store_product_notes` SELECT * FROM `__bak_store_product_notes`;--> statement-breakpoint
INSERT INTO `store_product_similar_model_map` SELECT * FROM `__bak_store_product_similar_model_map`;--> statement-breakpoint
INSERT INTO `store_product_tag_mapping` SELECT * FROM `__bak_store_product_tag_mapping`;--> statement-breakpoint
INSERT INTO `store_product_rating` SELECT * FROM `__bak_store_product_rating`;--> statement-breakpoint
INSERT INTO `product_images` SELECT * FROM `__bak_product_images`;--> statement-breakpoint
INSERT INTO `product_specs` SELECT * FROM `__bak_product_specs`;--> statement-breakpoint
INSERT INTO `showroom_product_mappings` SELECT * FROM `__bak_showroom_product_mappings`;--> statement-breakpoint
INSERT INTO `store_product_intel` SELECT * FROM `__bak_store_product_intel`;--> statement-breakpoint
INSERT INTO `product_material_mappings` SELECT * FROM `__bak_product_material_mappings`;--> statement-breakpoint
INSERT INTO `product_showroom_photos` SELECT * FROM `__bak_product_showroom_photos`;--> statement-breakpoint
INSERT INTO `product_price_observations` SELECT * FROM `__bak_product_price_observations`;--> statement-breakpoint
UPDATE `material_schedule_items` SET `purchased_showroom_product_id` = (SELECT b.purchased_showroom_product_id FROM `__bak_material_schedule_items` b WHERE b.id = material_schedule_items.id) WHERE id IN (SELECT id FROM `__bak_material_schedule_items` WHERE purchased_showroom_product_id IS NOT NULL);--> statement-breakpoint
UPDATE `wishlist_items` SET `showroom_store_product_id` = (SELECT b.showroom_store_product_id FROM `__bak_wishlist_items` b WHERE b.id = wishlist_items.id) WHERE id IN (SELECT id FROM `__bak_wishlist_items` WHERE showroom_store_product_id IS NOT NULL);--> statement-breakpoint
UPDATE `showroom_scan_log` SET `matched_store_product_id` = (SELECT b.matched_store_product_id FROM `__bak_showroom_scan_log` b WHERE b.id = showroom_scan_log.id) WHERE id IN (SELECT id FROM `__bak_showroom_scan_log` WHERE matched_store_product_id IS NOT NULL);--> statement-breakpoint
UPDATE `showroom_scan_log` SET `auto_created_product_id` = (SELECT b.auto_created_product_id FROM `__bak_showroom_scan_log` b WHERE b.id = showroom_scan_log.id) WHERE id IN (SELECT id FROM `__bak_showroom_scan_log` WHERE auto_created_product_id IS NOT NULL);--> statement-breakpoint
DROP TABLE `__bak_store_product_docs`;--> statement-breakpoint
DROP TABLE `__bak_store_product_research`;--> statement-breakpoint
DROP TABLE `__bak_store_product_pa_mapping`;--> statement-breakpoint
DROP TABLE `__bak_store_product_notes`;--> statement-breakpoint
DROP TABLE `__bak_store_product_similar_model_map`;--> statement-breakpoint
DROP TABLE `__bak_store_product_tag_mapping`;--> statement-breakpoint
DROP TABLE `__bak_store_product_rating`;--> statement-breakpoint
DROP TABLE `__bak_product_images`;--> statement-breakpoint
DROP TABLE `__bak_product_specs`;--> statement-breakpoint
DROP TABLE `__bak_showroom_product_mappings`;--> statement-breakpoint
DROP TABLE `__bak_store_product_intel`;--> statement-breakpoint
DROP TABLE `__bak_product_material_mappings`;--> statement-breakpoint
DROP TABLE `__bak_product_showroom_photos`;--> statement-breakpoint
DROP TABLE `__bak_product_price_observations`;--> statement-breakpoint
DROP TABLE `__bak_showroom_scan_log`;--> statement-breakpoint
DROP TABLE `__bak_material_schedule_items`;--> statement-breakpoint
DROP TABLE `__bak_wishlist_items`
