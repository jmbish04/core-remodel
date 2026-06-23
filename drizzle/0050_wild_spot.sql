CREATE TABLE `research_plan_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`plan_markdown` text NOT NULL,
	`plan_annotations` text,
	`homeowner_feedback` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `research_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `plan_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `plan_annotations` text;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `plan_interaction_id` text;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `plan_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `plan_approved_at` integer;