CREATE TABLE `ai_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_listing_id` integer NOT NULL,
	`prompt` text NOT NULL,
	`generated_cf_image_id` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`original_listing_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`cf_image_id_original` text NOT NULL,
	`cf_image_id_optimized` text,
	`room_type` text,
	`is_instagram` integer DEFAULT false NOT NULL,
	`instagram_account` text,
	`instagram_caption` text,
	`metadata` text,
	`is_listing_photo` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listing_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cf_image_id` text NOT NULL,
	`room_name` text NOT NULL,
	`description` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mood_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`background_color` text DEFAULT '#ffffff',
	`layout_state` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL
);
