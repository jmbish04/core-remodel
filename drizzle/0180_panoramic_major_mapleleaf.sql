ALTER TABLE `showroom_store_contacts` ADD `location_id` integer REFERENCES showroom_store_locations(id);--> statement-breakpoint
ALTER TABLE `showroom_store_contacts` ADD `is_primary` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_location_idx` ON `showroom_store_contacts` (`location_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ssc_one_general_per_location` ON `showroom_store_contacts` (`store_id`,`location_id`) WHERE type = 'GENERAL_CONTACT' AND is_draft = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `ssc_one_primary_per_location` ON `showroom_store_contacts` (`store_id`,`location_id`) WHERE is_primary = 1 AND is_draft = 0;--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/