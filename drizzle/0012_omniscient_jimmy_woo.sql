/*
 SQLite does not support "Drop not null from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `image_edit_revisions` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `image_edit_revisions` ADD `starting_image_url` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `image_edit_revisions` ADD `output_image_url` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `image_edit_revisions` ADD `created_at` integer DEFAULT (strftime('%s', 'now'));
