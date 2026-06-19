ALTER TABLE `rooms` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `images` ADD `inspiration_scope` text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE `images` ADD `scope_floor_id` integer REFERENCES floors(id);--> statement-breakpoint
ALTER TABLE `images` ADD `inspiration_category` text;--> statement-breakpoint
CREATE INDEX `images_scope_floor_id_idx` ON `images` (`scope_floor_id`);--> statement-breakpoint
CREATE INDEX `images_inspiration_scope_idx` ON `images` (`inspiration_scope`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/