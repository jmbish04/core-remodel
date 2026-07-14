CREATE TABLE `showroom_store_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`day` text NOT NULL,
	`open_hour` integer NOT NULL,
	`open_minute` integer DEFAULT 0 NOT NULL,
	`close_hour` integer NOT NULL,
	`close_minute` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_store_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`url` text NOT NULL,
	`type` text NOT NULL,
	`url_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_store_contact_business_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`store_id` integer,
	`contact_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`draft_notes` text,
	`cf_image_url` text,
	`cf_image_url_back` text,
	`image_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `showroom_store_contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_store_contact_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer,
	`store_contact_id` integer,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`timestamp_contact_start` integer,
	`timestamp_contact_end` integer,
	`estimated_call_duration` integer,
	`transcript_json` text,
	`context_of_conversation` text,
	`outcome_of_conversation` text,
	`is_followup_needed` integer DEFAULT false NOT NULL,
	`followup_notes` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_contact_id`) REFERENCES `showroom_store_contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_store_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`type` text NOT NULL,
	`notes` text,
	`first_name` text,
	`last_name` text,
	`office_phone_number` text,
	`office_phone_extension` text,
	`mobile_phone_number` text,
	`fax_phone_number` text,
	`email_address` text,
	`is_texting_ok` integer DEFAULT false NOT NULL,
	`best_contact_times_json` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`draft_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `showroom_hours`;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `location_street_number` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `location_street_name` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `location_city` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `location_state` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `location_zip_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_hours_showroom_day_unique` ON `showroom_store_hours` (`showroom_id`,`day`);--> statement-breakpoint
CREATE INDEX `showroom_store_links_store_idx` ON `showroom_store_links` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_cards_store_idx` ON `showroom_store_contact_business_cards` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_cards_status_idx` ON `showroom_store_contact_business_cards` (`status`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_log_store_idx` ON `showroom_store_contact_log` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_log_contact_idx` ON `showroom_store_contact_log` (`store_contact_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_store_idx` ON `showroom_store_contacts` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_type_idx` ON `showroom_store_contacts` (`type`);--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_draft_idx` ON `showroom_store_contacts` (`is_draft`);