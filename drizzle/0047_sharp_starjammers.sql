ALTER TABLE `research_sessions` ADD `interaction_id` text;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `last_event_id` text;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `interaction_agent` text;--> statement-breakpoint
ALTER TABLE `research_sessions` ADD `mcp_bridge_enabled` integer DEFAULT false;