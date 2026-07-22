CREATE TABLE `health_binding_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`session_uuid` text NOT NULL,
	`health_test_def_id` integer NOT NULL,
	`health_test_result` text NOT NULL,
	`health_test_result_details` text,
	`duration_ms` integer,
	`triggered_by` text DEFAULT 'api' NOT NULL,
	FOREIGN KEY (`health_test_def_id`) REFERENCES `health_test_def`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `health_test_binding_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`health_test_def_id` integer NOT NULL,
	`health_binding_type_id` integer NOT NULL,
	FOREIGN KEY (`health_test_def_id`) REFERENCES `health_test_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`health_binding_type_id`) REFERENCES `health_binding_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `health_test_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`health_ts_filepath` text NOT NULL,
	`what_success_means` text NOT NULL,
	`what_failure_means` text NOT NULL,
	`troubleshooting_steps` text NOT NULL,
	`dev_ops_playbook` text NOT NULL,
	`is_billing_risk` integer DEFAULT false NOT NULL,
	`severity` text DEFAULT 'MEDIUM' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `health_binding_types_name_idx` ON `health_binding_types` (`name`);--> statement-breakpoint
CREATE INDEX `health_results_session_idx` ON `health_results` (`session_uuid`);--> statement-breakpoint
CREATE INDEX `health_results_timestamp_idx` ON `health_results` (`timestamp`);--> statement-breakpoint
CREATE INDEX `health_results_def_idx` ON `health_results` (`health_test_def_id`,`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `health_test_binding_types_pair_idx` ON `health_test_binding_types` (`health_test_def_id`,`health_binding_type_id`);--> statement-breakpoint
CREATE INDEX `health_test_binding_types_def_idx` ON `health_test_binding_types` (`health_test_def_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `health_test_def_name_idx` ON `health_test_def` (`name`);--> statement-breakpoint
CREATE INDEX `health_test_def_active_idx` ON `health_test_def` (`is_active`);