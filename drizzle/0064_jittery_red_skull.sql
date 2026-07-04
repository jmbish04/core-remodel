ALTER TABLE `showroom_stores` ADD `place_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_stores_place_id_uniq` ON `showroom_stores` (`place_id`);