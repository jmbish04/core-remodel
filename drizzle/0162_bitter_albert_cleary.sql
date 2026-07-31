CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`project_type` text DEFAULT 'lifestyle_change' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `room_stop_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`stop` text NOT NULL,
	`entered_by` text,
	`reason` text,
	`entered_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `spec_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`value_kind` text DEFAULT 'text' NOT NULL,
	`choice_options` text,
	`is_required_for_threshold` integer DEFAULT false NOT NULL,
	`applies_to_room_kinds` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_spec_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`spec_definition_id` integer NOT NULL,
	`product_id` integer,
	`material_id` integer,
	`value_text` text,
	`value_cents` integer,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`waived_reason` text,
	`provenance_actor` text,
	`provenance_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spec_definition_id`) REFERENCES `spec_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`room_id` integer,
	`title` text NOT NULL,
	`body_markdown` text,
	`body_html` text,
	`governing_intent` text,
	`parent_decision_id` integer,
	`status` text DEFAULT 'proposed' NOT NULL,
	`decided_by` text,
	`reconsider_if` text,
	`decided_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_reopenings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`cause_kind` text NOT NULL,
	`cause_id` integer,
	`reason_at_time` text NOT NULL,
	`recorded_by` text,
	`occurred_at` integer,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `impact_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`description` text,
	`risk_inputs` text,
	`default_severity` integer DEFAULT 50 NOT NULL,
	`requires_actor_party` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `impacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`definition_id` integer NOT NULL,
	`title` text NOT NULL,
	`detail_markdown` text,
	`detail_html` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text NOT NULL,
	`actor_party_kind` text,
	`actor_company_id` integer,
	`actor_party_id` integer,
	`confidence` integer,
	`cost_exposure_cents` integer,
	`cost_exposure_text` text,
	`days_exposure` integer,
	`provenance_actor` text,
	`provenance_at` integer,
	`resolved_at` integer,
	`resolution_note` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`definition_id`) REFERENCES `impact_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `impact_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`impact_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`effect` text NOT NULL,
	`note` text,
	`source` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `impact_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`blocking_impact_id` integer NOT NULL,
	`blocked_impact_id` integer NOT NULL,
	`note` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`blocking_impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `impact_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`impact_id` integer NOT NULL,
	`kind` text NOT NULL,
	`document_id` integer,
	`image_id` integer,
	`external_ref` text,
	`body_markdown` text,
	`body_html` text,
	`recorded_by` text,
	`occurred_at` integer,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ripple_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`trigger_name` text NOT NULL,
	`trigger_match` text NOT NULL,
	`consequences` text NOT NULL,
	`rationale` text,
	`strength` text DEFAULT 'usually' NOT NULL,
	`jurisdiction` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `rooms` ADD `line_color_hex` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `line_order` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `room_stop_state_room_entered_idx` ON `room_stop_state` (`room_id`,`entered_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `spec_definitions_key_unique` ON `spec_definitions` (`key`);--> statement-breakpoint
CREATE INDEX `room_spec_fields_room_idx` ON `room_spec_fields` (`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_spec_fields_room_definition_unique` ON `room_spec_fields` (`room_id`,`spec_definition_id`);--> statement-breakpoint
CREATE INDEX `decisions_project_idx` ON `decisions` (`project_id`);--> statement-breakpoint
CREATE INDEX `decisions_room_status_idx` ON `decisions` (`room_id`,`status`);--> statement-breakpoint
CREATE INDEX `decisions_parent_idx` ON `decisions` (`parent_decision_id`);--> statement-breakpoint
CREATE INDEX `decision_reopenings_decision_idx` ON `decision_reopenings` (`decision_id`);--> statement-breakpoint
CREATE INDEX `decision_reopenings_cause_idx` ON `decision_reopenings` (`cause_kind`,`cause_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_definitions_key_unique` ON `impact_definitions` (`key`);--> statement-breakpoint
CREATE INDEX `impacts_project_status_idx` ON `impacts` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `impacts_definition_idx` ON `impacts` (`definition_id`);--> statement-breakpoint
CREATE INDEX `impacts_actor_company_idx` ON `impacts` (`actor_company_id`);--> statement-breakpoint
CREATE INDEX `impact_targets_target_idx` ON `impact_targets` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `impact_targets_impact_idx` ON `impact_targets` (`impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_targets_impact_target_effect_unique` ON `impact_targets` (`impact_id`,`target_kind`,`target_id`,`effect`);--> statement-breakpoint
CREATE INDEX `impact_blocks_blocked_idx` ON `impact_blocks` (`blocked_impact_id`);--> statement-breakpoint
CREATE INDEX `impact_blocks_blocking_idx` ON `impact_blocks` (`blocking_impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_blocks_edge_unique` ON `impact_blocks` (`blocking_impact_id`,`blocked_impact_id`);--> statement-breakpoint
CREATE INDEX `impact_evidence_impact_idx` ON `impact_evidence` (`impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ripple_rules_key_unique` ON `ripple_rules` (`key`);--> statement-breakpoint
CREATE INDEX `ripple_rules_active_idx` ON `ripple_rules` (`is_active`);