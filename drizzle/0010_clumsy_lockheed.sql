CREATE TABLE `budget_expense_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`replaced_by_expense_id` integer,
	`replaced_at` integer,
	`item` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`vendor_name` text,
	`scenario_id` text,
	`option_group` text,
	`option_key` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`date_incurred` integer,
	`notes` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `budget_funding_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_key` text NOT NULL,
	`account_label` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_project_info` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`info_key` text NOT NULL,
	`info_label` text NOT NULL,
	`info_value` text,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_funding_accounts_account_key_unique` ON `budget_funding_accounts` (`account_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_project_info_info_key_unique` ON `budget_project_info` (`info_key`);