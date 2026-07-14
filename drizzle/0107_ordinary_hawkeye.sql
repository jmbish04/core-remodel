CREATE TABLE `changelog_branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`pr_number` integer,
	`pr_url` text,
	`diagrams_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `changelog_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`branch` text NOT NULL,
	`tag` text,
	`area` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`date` text NOT NULL,
	`changes_json` text,
	`migrations_json` text,
	`detail_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changelog_branches_branch_unique` ON `changelog_branches` (`branch`);--> statement-breakpoint
CREATE INDEX `changelog_branches_created_idx` ON `changelog_branches` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `changelog_entries_slug_unique` ON `changelog_entries` (`slug`);--> statement-breakpoint
CREATE INDEX `changelog_entries_branch_idx` ON `changelog_entries` (`branch`);--> statement-breakpoint
CREATE INDEX `changelog_entries_created_idx` ON `changelog_entries` (`created_at`);