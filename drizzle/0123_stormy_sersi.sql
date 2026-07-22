ALTER TABLE `gemini_usage_log` ADD `agent_run_id` integer;--> statement-breakpoint
CREATE INDEX `gemini_usage_log_agent_run_idx` ON `gemini_usage_log` (`agent_run_id`);