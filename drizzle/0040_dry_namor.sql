CREATE TABLE `mood_board_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text,
	`source_images` text,
	`output_cf_image_id` text,
	`output_image_url` text,
	`ai_title` text,
	`ai_description` text,
	`room_id` integer,
	`floor_id` integer,
	`model` text,
	`source` text,
	`status` text DEFAULT 'done' NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `render_canvases` ADD `mood_board_id` text;