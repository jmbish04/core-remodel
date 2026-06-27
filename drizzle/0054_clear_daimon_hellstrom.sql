ALTER TABLE `research_sessions` ADD `engine` text DEFAULT 'gemini' NOT NULL;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `cf_engine_config` text;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `cf_engine_state` text;