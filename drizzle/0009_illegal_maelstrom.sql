CREATE TABLE `budget_tracker_item_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_tracker_item_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`budget_tracker_item_id`) REFERENCES `budget_tracker_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_tracker_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`replaced_by_item_id` integer,
	`replaced_at` integer,
	`item_type` text DEFAULT 'project' NOT NULL,
	`execution_class` text DEFAULT 'must_now' NOT NULL,
	`option_group` text,
	`option_key` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`is_bottleneck` integer DEFAULT false NOT NULL,
	`bottleneck_reason` text,
	`estimated_low_cents` integer,
	`estimated_high_cents` integer,
	`scenario_id` text,
	`owner` text,
	`ai_rationale` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `google_sheet_sync_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text DEFAULT 'google_sheets' NOT NULL,
	`direction` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`cursor_value` text,
	`sync_hash` text,
	`request_json` text,
	`result_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_sheet_sync_events_idempotency_key_unique` ON `google_sheet_sync_events` (`idempotency_key`);