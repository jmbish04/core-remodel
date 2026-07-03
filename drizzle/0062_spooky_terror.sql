CREATE TABLE `showroom_photos_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`cf_images_photo_url` text NOT NULL,
	`photo_name` text,
	`photo_width_px` integer,
	`photo_height_px` integer,
	`author_attributes` text,
	`flag_content_uri` text,
	`google_maps_uri` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `showroom_photos_mapping_showroom_idx` ON `showroom_photos_mapping` (`showroom_id`);