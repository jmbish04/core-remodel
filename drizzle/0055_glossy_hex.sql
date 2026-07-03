CREATE TABLE `clickup_revision_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clickup_task_id` text,
	`clickup_list_id` text,
	`operation` text NOT NULL,
	`request_payload` text NOT NULL,
	`response_payload` text,
	`response_status` integer,
	`actor` text DEFAULT 'system' NOT NULL,
	`r2_attachment_key` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clickup_task_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clickup_task_id` text NOT NULL,
	`flag_type` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`message` text NOT NULL,
	`audit_run_id` text,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clickup_system_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_type` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`audit_run_id` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`acknowledged_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `google_maps_usage_log` ADD `endpoint` text;--> statement-breakpoint
ALTER TABLE `google_maps_usage_log` ADD `session_token` text;--> statement-breakpoint
ALTER TABLE `google_maps_usage_log` ADD `status_code` integer;