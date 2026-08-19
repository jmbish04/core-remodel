CREATE TABLE `gmail_message_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gmail_message_id` integer NOT NULL,
	`content_id` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`mime_type` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`gmail_message_id`) REFERENCES `gmail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `gmail_messages` ADD `classification` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_messages` ADD `is_spam` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_messages` ADD `spam_rationale` text;--> statement-breakpoint
ALTER TABLE `gmail_messages` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `gmail_message_images_message_id_idx` ON `gmail_message_images` (`gmail_message_id`);