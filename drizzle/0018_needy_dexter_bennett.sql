CREATE TABLE `permits_identifier_views` (
	`permit_identifier` text PRIMARY KEY NOT NULL,
	`last_viewed_hash` text,
	`last_viewed_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permits_contact_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_name` text NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`summary` text NOT NULL,
	`highlights` text,
	`metrics` text,
	`model` text,
	`last_run_id` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `permits_records` ADD `permit_identifier` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `application_number` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `status_category` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `closed_date` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `latitude` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `longitude` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `is_property_permit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `is_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `change_hash` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `last_changed_at` integer;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `is_monitored` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `active_property_permit_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `closed_property_permit_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `record_key` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `permit_identifier` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `application_number` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `permit_type` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `status_category` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `issued_date` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `closed_date` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `latitude` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `longitude` text;--> statement-breakpoint
CREATE UNIQUE INDEX `permits_contact_insights_contact_name_unique` ON `permits_contact_insights` (`contact_name`);