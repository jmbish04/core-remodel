PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `business_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`business_type_id` integer,
	`phone` text,
	`email` text,
	`website` text,
	`license_number` text,
	`notes` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`business_type_id`) REFERENCES `business_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `company_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`title` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_selected_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`room_id` integer,
	`image_id` text NOT NULL,
	`caption_override` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `new_bid_portfolios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`welcome_message` text,
	`overview_statement` text,
	`show_budget_ranges` integer DEFAULT false NOT NULL,
	`expiration_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `companies` (`id`, `name`) VALUES (1, 'Legacy Company');
--> statement-breakpoint
INSERT INTO `new_bid_portfolios` (`id`, `company_id`, `token`, `title`, `welcome_message`, `overview_statement`, `show_budget_ranges`, `expiration_date`, `status`, `datetime_created`, `datetime_updated`)
SELECT `id`, 1, `token`, `title`, `welcome_message`, `overview_statement`, `show_budget_ranges`, `expiration_date`, `status`, `datetime_created`, `datetime_updated` FROM `bid_portfolios`;
--> statement-breakpoint
DROP TABLE `bid_portfolios`;
--> statement-breakpoint
ALTER TABLE `new_bid_portfolios` RENAME TO `bid_portfolios`;
--> statement-breakpoint
CREATE UNIQUE INDEX `bid_portfolios_token_unique` ON `bid_portfolios` (`token`);ALTER TABLE `contacts` DROP COLUMN `company_name`;
ALTER TABLE `contacts` DROP COLUMN `business_type`;
ALTER TABLE `contacts` DROP COLUMN `license_number`;
ALTER TABLE `contacts` DROP COLUMN `website`;
CREATE UNIQUE INDEX `business_types_name_unique` ON `business_types` (`name`);
