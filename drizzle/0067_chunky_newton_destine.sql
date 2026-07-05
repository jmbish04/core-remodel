CREATE TABLE `listing_photo_blank_canvases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_photo_id` integer NOT NULL,
	`cf_image_id` text NOT NULL,
	`prompt` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`listing_photo_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `images` ADD `is_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `images` ADD `deleted_marked_by` text;--> statement-breakpoint
ALTER TABLE `images` ADD `deleted_marked_at` integer;--> statement-breakpoint
ALTER TABLE `listing_photos` ADD `skip_blank_canvas` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `images_is_deleted_idx` ON `images` (`is_deleted`);