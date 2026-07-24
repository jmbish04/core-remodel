ALTER TABLE `product_photo_buckets` ADD `brand_id` integer REFERENCES brands(id);--> statement-breakpoint
ALTER TABLE `product_photo_buckets` ADD `brand_name_raw` text;--> statement-breakpoint
ALTER TABLE `product_photo_buckets` ADD `product_name` text;--> statement-breakpoint
ALTER TABLE `product_photo_buckets` ADD `model_number` text;--> statement-breakpoint
ALTER TABLE `product_photo_buckets` ADD `sku` text;--> statement-breakpoint
ALTER TABLE `product_photo_buckets` ADD `product_url` text;--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/