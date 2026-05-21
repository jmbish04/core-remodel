CREATE TABLE `checklist_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`question_id` integer NOT NULL,
	`scenario_id` text,
	`is_checked` integer DEFAULT false NOT NULL,
	`notes` text,
	`selection_value` text,
	`version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text DEFAULT 'homeowner' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `checklist_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `checklist_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`code` text NOT NULL,
	`question_text` text NOT NULL,
	`considerations` text,
	`default_budget_impact_json` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `checklist_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `checklist_room_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`ai_rationale` text,
	`association_status` text DEFAULT 'ai_suggested' NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `checklist_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `checklist_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`helper_text` text,
	`icon_identifier` text DEFAULT 'HelpCircle' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checklist_service_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`processed_records_count` integer DEFAULT 0 NOT NULL,
	`chain_of_thought_dump` text,
	`datetime_executed` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_material_quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`material_name` text NOT NULL,
	`supplier_name` text,
	`homeowner_quote_cents` integer DEFAULT 0 NOT NULL,
	`contractor_discount_offer_cents` integer,
	`contractor_notes` text,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `system_cron_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_key` text NOT NULL,
	`cron_expression` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`description` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `workflow_run_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_key` text NOT NULL,
	`workflow_instance_id` text NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`error_message` text,
	`summary_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_questions_code_unique` ON `checklist_questions` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_room_mappings_unique` ON `checklist_room_mappings` (`question_id`,`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_sections_slug_unique` ON `checklist_sections` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `system_cron_schedules_job_key_unique` ON `system_cron_schedules` (`job_key`);