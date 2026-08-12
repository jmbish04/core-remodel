ALTER TABLE `store_notes` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `showroom_store_ratings` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `store_rating` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `showroom_images` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `showroom_photos_mapping` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `product_showroom_photos` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `product_price_observations` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/