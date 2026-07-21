CREATE TABLE `agent_run_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error_message` text,
	`started_at` integer,
	`ended_at` integer,
	`duration_ms` integer,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_run_tool_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`step_id` integer,
	`tool` text NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`args_json` text,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `agent_run_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent` text NOT NULL,
	`operation` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`parent_run_id` integer,
	`error_code` text,
	`error_message` text,
	`input_json` text,
	`output_json` text,
	`triggered_by` text,
	`started_at` integer,
	`ended_at` integer,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_run_steps_run_seq_idx` ON `agent_run_steps` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_run_tool_calls_run_idx` ON `agent_run_tool_calls` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_tool_calls_tool_ok_idx` ON `agent_run_tool_calls` (`tool`,`ok`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_created_idx` ON `agent_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_agent_created_idx` ON `agent_runs` (`agent`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_target_idx` ON `agent_runs` (`target_type`,`target_id`);