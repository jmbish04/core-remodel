CREATE TABLE `research_job_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`step_key` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`artifact` text,
	`detail` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `research_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`topic` text,
	`criteria` text,
	`entity_type` text,
	`entity_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`current_step` text,
	`total_steps` integer DEFAULT 1 NOT NULL,
	`completed_steps` integer DEFAULT 0 NOT NULL,
	`plan` text,
	`outline` text,
	`report` text,
	`sources` text,
	`result` text,
	`error` text,
	`workflow_instance_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_job_steps_job_step_uniq` ON `research_job_steps` (`job_id`,`step_key`);--> statement-breakpoint
CREATE INDEX `research_job_steps_job_idx` ON `research_job_steps` (`job_id`);--> statement-breakpoint
CREATE INDEX `research_jobs_status_idx` ON `research_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `research_jobs_entity_idx` ON `research_jobs` (`entity_type`,`entity_id`);