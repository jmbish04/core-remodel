CREATE TABLE `truth_table_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`replaced_by_activity_id` text,
	`replaced_at` integer,
	`trade` text NOT NULL,
	`phase` text NOT NULL,
	`scope_key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`scope_keywords` text,
	`unit` text NOT NULL,
	`baseline_labor_cents_per_unit` integer DEFAULT 0 NOT NULL,
	`baseline_material_cents_per_unit` integer DEFAULT 0 NOT NULL,
	`baseline_equipment_cents_per_unit` integer DEFAULT 0 NOT NULL,
	`market_adjustment_pct` real DEFAULT 0 NOT NULL,
	`insurance_baseline_cents_per_unit` integer,
	`notes` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`confidence_score` real DEFAULT 0.7,
	`embedding_id` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tta_scope_key` ON `truth_table_activities` (`scope_key`);--> statement-breakpoint
CREATE INDEX `idx_tta_trade` ON `truth_table_activities` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_tta_phase` ON `truth_table_activities` (`phase`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tta_track_revision` ON `truth_table_activities` (`track_id`,`revision_number`);