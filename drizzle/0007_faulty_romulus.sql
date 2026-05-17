CREATE TABLE `homeowner_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`author` text DEFAULT 'Homeowner' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`first_path` text,
	`last_path` text,
	`first_referrer` text,
	`last_referrer` text,
	`user_agent` text,
	`country` text,
	`city` text,
	`timezone` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitor_events` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`session_id` text,
	`event_type` text NOT NULL,
	`path` text NOT NULL,
	`element` text,
	`duration_ms` integer,
	`referrer` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitor_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
