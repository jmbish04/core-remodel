CREATE TABLE `planning_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`participant_type` text DEFAULT 'contractor' NOT NULL,
	`company_name` text,
	`email` text,
	`phone` text,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planning_epics` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`phase_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planning_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`epic_id` text NOT NULL,
	`room_id` integer,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`task_order` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`due_date` text,
	`owner_participant_id` integer,
	`responsible_participant_id` integer,
	`accountable_participant_id` integer,
	`support_participant_ids` text,
	`consulted_participant_ids` text,
	`informed_participant_ids` text,
	`depends_on_task_ids` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`epic_id`) REFERENCES `planning_epics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsible_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accountable_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `planning_task_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`update_date` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`transcript` text,
	`audio_key` text,
	`audio_mime_type` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_by_participant_id` integer,
	`is_draft` integer DEFAULT false NOT NULL,
	`approved_by_participant_id` integer,
	`approved_at` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `planning_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `planning_task_update_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_update_id` text NOT NULL,
	`image_id` text NOT NULL,
	`ai_analysis` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_update_id`) REFERENCES `planning_task_updates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `planning_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`log_type` text NOT NULL,
	`log_date` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`transcript` text,
	`audio_key` text,
	`audio_mime_type` text,
	`author_participant_id` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`author_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `permits_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_type` text NOT NULL,
	`query_label` text NOT NULL,
	`source_dataset` text NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`ai_summary` text,
	`error_text` text,
	`raw_payload` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permits_records` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset` text NOT NULL,
	`record_key` text NOT NULL,
	`permit_number` text,
	`permit_type` text,
	`permit_status` text,
	`property_address` text,
	`block` text,
	`lot` text,
	`contact_name` text,
	`contact_role` text,
	`issued_date` text,
	`expires_date` text,
	`latest_run_id` text,
	`raw_data` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`latest_run_id`) REFERENCES `permits_sync_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `permits_record_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`dataset` text NOT NULL,
	`record_key` text NOT NULL,
	`permit_number` text,
	`permit_status` text,
	`raw_data` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `permits_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `permits_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_name` text NOT NULL,
	`metadata` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permits_contact_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_name` text NOT NULL,
	`dataset` text NOT NULL,
	`permit_number` text,
	`permit_status` text,
	`property_address` text,
	`run_id` text,
	`raw_data` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `permits_sync_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_epics_slug_unique` ON `planning_epics` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `planning_tasks_slug_unique` ON `planning_tasks` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `permits_records_record_key_unique` ON `permits_records` (`record_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `permits_contacts_contact_name_unique` ON `permits_contacts` (`contact_name`);