CREATE TABLE `sourcing_plan_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sweep_session_id` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`plan_markdown` text NOT NULL,
	`plan_annotations` text,
	`homeowner_feedback` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sweep_session_id`) REFERENCES `sourcing_sweep_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sourcing_sweep_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`prompt` text,
	`research_mode` text DEFAULT 'deep' NOT NULL,
	`max_sources` integer,
	`enable_mcp_bridge` integer DEFAULT false NOT NULL,
	`plan_markdown` text,
	`plan_annotations` text,
	`plan_interaction_id` text,
	`plan_status` text DEFAULT 'drafting' NOT NULL,
	`plan_revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`result_json` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`approved_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `sourcing_sweep_sessions_target_idx` ON `sourcing_sweep_sessions` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `sourcing_sweep_sessions_status_idx` ON `sourcing_sweep_sessions` (`status`);