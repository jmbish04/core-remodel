CREATE TABLE `gemini_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`model` text NOT NULL,
	`feature` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`prompt_tokens` integer,
	`candidates_tokens` integer,
	`thoughts_tokens` integer,
	`cached_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` real,
	`error_message` text,
	`request_meta` text
);
