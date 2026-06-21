CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`title` text,
	`email` text,
	`phone` text,
	`business_type` text NOT NULL,
	`license_number` text,
	`website` text,
	`notes` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bid_portfolios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`welcome_message` text,
	`overview_statement` text,
	`show_budget_ranges` integer DEFAULT false NOT NULL,
	`expiration_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_room_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`include_photos` integer DEFAULT true NOT NULL,
	`include_dimensions` integer DEFAULT true NOT NULL,
	`include_condition_notes` integer DEFAULT true NOT NULL,
	`include_scope_items` integer DEFAULT true NOT NULL,
	`include_inspiration` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`section` text,
	`room_id` integer,
	`author_name` text NOT NULL,
	`author_email` text,
	`content` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bid_portfolios_token_unique` ON `bid_portfolios` (`token`);