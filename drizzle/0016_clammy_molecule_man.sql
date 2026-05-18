CREATE TABLE `room_ai_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`representative_image_id` text,
	`summary_markdown` text,
	`summary_json` text,
	`last_user_prompt` text,
	`last_voice_transcript` text,
	`model` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_generated` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`representative_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_ai_summaries_room_unique` ON `room_ai_summaries` (`room_id`);