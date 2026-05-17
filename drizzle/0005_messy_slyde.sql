CREATE TABLE `floors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`level_order` integer DEFAULT 0 NOT NULL,
	`living_sq_ft` integer,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`floor_id` integer NOT NULL,
	`room_code` text NOT NULL,
	`room_name` text NOT NULL,
	`as_is_use` text,
	`length_feet` integer,
	`length_inches` integer,
	`width_feet` integer,
	`width_inches` integer,
	`is_living_space` integer DEFAULT true NOT NULL,
	`problem_areas` text,
	`plumbing_notes` text,
	`electrical_notes` text,
	`structural_notes` text,
	`hvac_notes` text,
	`general_notes` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `remodel_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`budget_low_cents` integer,
	`budget_high_cents` integer,
	`decision_notes` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_room_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`room_id` integer NOT NULL,
	`proposed_use` text NOT NULL,
	`stage` text DEFAULT 'considering' NOT NULL,
	`estimated_cost_cents` integer,
	`notes` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer NOT NULL,
	`scenario_id` text,
	`category` text DEFAULT 'general' NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`estimated_cost_cents` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `images` ADD `room_id` integer REFERENCES rooms(id);--> statement-breakpoint
ALTER TABLE `listing_photos` ADD `image_id` text REFERENCES images(id);--> statement-breakpoint
ALTER TABLE `listing_photos` ADD `room_id` integer REFERENCES rooms(id);--> statement-breakpoint
CREATE UNIQUE INDEX `floors_key_unique` ON `floors` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_room_code_unique` ON `rooms` (`room_code`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/
