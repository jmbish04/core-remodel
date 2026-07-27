DROP INDEX IF EXISTS `showroom_hours_showroom_day_unique`;--> statement-breakpoint
ALTER TABLE `showroom_store_hours` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_hours_store_location_day_unique` ON `showroom_store_hours` (`showroom_id`,`location_id`,`day`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/