CREATE TABLE `image_upload_staging` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`photo_category` text NOT NULL,
	`mapping_status` text DEFAULT 'pending' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_mapped` integer,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_upload_staging_image_unique` ON `image_upload_staging` (`image_id`);