CREATE TABLE `listing_photo_blank_canvases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_photo_id` integer NOT NULL,
	`cf_image_id` text NOT NULL,
	`prompt` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`listing_photo_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
