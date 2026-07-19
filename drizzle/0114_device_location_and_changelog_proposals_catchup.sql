CREATE TABLE `device_location` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text DEFAULT 'browser' NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`accuracy_meters` real,
	`address` text,
	`captured_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `changelog_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`plan_slug` text,
	`branch` text,
	`pr_number` integer,
	`prd_markdown` text,
	`design_brief_markdown` text,
	`prompt_markdown` text,
	`context_r2_key` text,
	`context_bytes` integer,
	`context_sha256` text,
	`context_coverage_note` text,
	`source_kind` text DEFAULT 'ai_chat' NOT NULL,
	`source_model` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `device_location_source_idx` ON `device_location` (`source`);--> statement-breakpoint
CREATE INDEX `device_location_captured_idx` ON `device_location` (`captured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `changelog_proposals_slug_unique` ON `changelog_proposals` (`slug`);--> statement-breakpoint
CREATE INDEX `changelog_proposals_plan_idx` ON `changelog_proposals` (`plan_slug`);--> statement-breakpoint
CREATE INDEX `changelog_proposals_status_idx` ON `changelog_proposals` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `changelog_proposals_branch_idx` ON `changelog_proposals` (`branch`);