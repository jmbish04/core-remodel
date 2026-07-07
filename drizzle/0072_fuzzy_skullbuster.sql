CREATE TABLE `gmail_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`subject` text,
	`timestamp_sent` integer,
	`company_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `gmail_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`timestamp` integer,
	`from_recipient` text NOT NULL,
	`to_recipients_json` text NOT NULL,
	`subject` text,
	`body` text,
	`ai_summary` text,
	`rag_uuid` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_threads_thread_id_unique` ON `gmail_threads` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_threads_company_id_idx` ON `gmail_threads` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_messages_message_id_unique` ON `gmail_messages` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_messages_rag_uuid_unique` ON `gmail_messages` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `gmail_messages_thread_id_idx` ON `gmail_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_messages_from_recipient_idx` ON `gmail_messages` (`from_recipient`);