CREATE TABLE `research_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`r2_markdown_key` text,
	`r2_webapp_key` text,
	`vector_namespace` text,
	`error_message` text,
	`chunk_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
