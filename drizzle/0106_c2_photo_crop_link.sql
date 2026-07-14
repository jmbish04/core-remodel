ALTER TABLE `product_showroom_photos` ADD `parent_photo_id` integer REFERENCES product_showroom_photos(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `product_showroom_photos` ADD `crop_region` text;--> statement-breakpoint
CREATE INDEX `product_showroom_photos_parent_idx` ON `product_showroom_photos` (`parent_photo_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/