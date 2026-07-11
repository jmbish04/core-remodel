CREATE TABLE `gmail_message_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`email` text NOT NULL,
	`domain` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `gmail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gmail_message_participants_email_idx` ON `gmail_message_participants` (`email`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_domain_idx` ON `gmail_message_participants` (`domain`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_thread_id_idx` ON `gmail_message_participants` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_message_id_idx` ON `gmail_message_participants` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_message_participants_message_email_role_unique` ON `gmail_message_participants` (`message_id`,`email`,`role`);