CREATE TABLE `work_item_watchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`item_native_id` text NOT NULL,
	`participant_id` integer NOT NULL,
	`role` text NOT NULL,
	`can_edit` integer DEFAULT true NOT NULL,
	`added_by_participant_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `plans` ADD `domain` text DEFAULT 'software' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `target_date` text;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `progress_pct` integer;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `effort_points` integer;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `assignee_participant_id` integer REFERENCES planning_participants(id);--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `pr_number` integer;--> statement-breakpoint
ALTER TABLE `plan_tasks` ADD `changelog_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_watchers_uniq` ON `work_item_watchers` (`source`,`item_native_id`,`participant_id`,`role`);--> statement-breakpoint
CREATE INDEX `work_item_watchers_participant_idx` ON `work_item_watchers` (`participant_id`);--> statement-breakpoint
CREATE INDEX `work_item_watchers_item_idx` ON `work_item_watchers` (`source`,`item_native_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/