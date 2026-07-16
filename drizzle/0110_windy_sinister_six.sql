CREATE TABLE `agent_adhoc_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_uuid` text NOT NULL,
	`entry_key` text NOT NULL,
	`label` text,
	`payload` text NOT NULL,
	`entry_created_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_adhoc_memory_uuid_idx` ON `agent_adhoc_memory` (`memory_uuid`);