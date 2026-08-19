ALTER TABLE `estimate_line_items` ADD `room_id` integer REFERENCES rooms(id);--> statement-breakpoint
ALTER TABLE `estimate_line_items` ADD `budget_item_track_id` text;--> statement-breakpoint
ALTER TABLE `estimate_line_items` ADD `mapping_status` text DEFAULT 'unmapped' NOT NULL;--> statement-breakpoint
ALTER TABLE `estimate_line_items` ADD `ai_suggested_room_id` integer REFERENCES rooms(id);--> statement-breakpoint
ALTER TABLE `estimate_line_items` ADD `ai_suggested_category` text;--> statement-breakpoint
ALTER TABLE `estimate_line_items` ADD `mapping_confidence` real;--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/