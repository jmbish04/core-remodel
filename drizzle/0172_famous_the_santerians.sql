CREATE TABLE `budget_phases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`tone` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_plan_schedule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_item_track_id` text NOT NULL,
	`period` text NOT NULL,
	`planned_cents` integer DEFAULT 0 NOT NULL,
	`planned_text` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `budget_expense_entries` ADD `budget_item_track_id` text;--> statement-breakpoint
ALTER TABLE `budget_expense_entries` ADD `room_id` integer REFERENCES rooms(id);--> statement-breakpoint
ALTER TABLE `budget_expense_entries` ADD `invoice_id` integer REFERENCES worker_email_invoices(id);--> statement-breakpoint
ALTER TABLE `budget_tracker_items` ADD `phase_id` integer REFERENCES budget_phases(id);--> statement-breakpoint
ALTER TABLE `budget_tracker_items` ADD `variance_note_markdown` text;--> statement-breakpoint
ALTER TABLE `budget_tracker_items` ADD `variance_note_html` text;--> statement-breakpoint
CREATE UNIQUE INDEX `budget_phases_key_unique` ON `budget_phases` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_budget_plan_line_period` ON `budget_plan_schedule` (`budget_item_track_id`,`period`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/