CREATE TABLE `plans` (
	`slug` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`doc_path` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_slug` text NOT NULL,
	`task_key` text NOT NULL,
	`workstream` text DEFAULT 'general' NOT NULL,
	`phase` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`target_route` text,
	`change_type` text DEFAULT 'new' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`depends_on` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`plan_slug`) REFERENCES `plans`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_tasks_plan_task_uniq` ON `plan_tasks` (`plan_slug`,`task_key`);--> statement-breakpoint
CREATE INDEX `plan_tasks_plan_idx` ON `plan_tasks` (`plan_slug`);