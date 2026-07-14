CREATE TABLE `showroom_store_contact_business_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`store_id` integer,
	`contact_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`draft_notes` text,
	`cf_image_url` text,
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
CREATE INDEX `showroom_store_contact_cards_store_idx` ON `showroom_store_contact_business_cards` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_cards_status_idx` ON `showroom_store_contact_business_cards` (`status`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_log_store_idx` ON `showroom_store_contact_log` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contact_log_contact_idx` ON `showroom_store_contact_log` (`store_contact_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_store_idx` ON `showroom_store_contacts` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_type_idx` ON `showroom_store_contacts` (`type`);--> statement-breakpoint
CREATE INDEX `showroom_store_contacts_draft_idx` ON `showroom_store_contacts` (`is_draft`);