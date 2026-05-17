CREATE TABLE `inspirational_image_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `images` ADD `display_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `inspirational_image_rooms_image_room_unique` ON `inspirational_image_rooms` (`image_id`,`room_id`);