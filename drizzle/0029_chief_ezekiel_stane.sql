CREATE TABLE `journal_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`journal_entry_id` integer NOT NULL,
	`type` text NOT NULL,
	`hosting_service` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text,
	`cf_image_id` text,
	`ai_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `shopping_journal_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopping_journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`phone_number` text,
	`email` text,
	`website` text,
	`contact_person` text,
	`address` text,
	`notes` text,
	`research_session_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`research_session_id`) REFERENCES `research_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `google_maps_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`api_type` text NOT NULL,
	`api_request` text NOT NULL,
	`api_response` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `truth_table_activities` ADD `is_final` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `truth_table_activities` ADD `vendor_name` text;