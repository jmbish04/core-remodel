ALTER TABLE `images` ADD `source_filename` text;--> statement-breakpoint
ALTER TABLE `images` ADD `source_filename_normalized` text;--> statement-breakpoint
ALTER TABLE `images` ADD `source_file_size` integer;--> statement-breakpoint
ALTER TABLE `images` ADD `source_file_md5` text;--> statement-breakpoint
ALTER TABLE `image_reviews` ADD `source_filename_normalized` text;--> statement-breakpoint
ALTER TABLE `image_reviews` ADD `source_file_size` integer;--> statement-breakpoint
ALTER TABLE `image_reviews` ADD `source_file_md5` text;--> statement-breakpoint
CREATE INDEX `images_source_file_md5_idx` ON `images` (`source_file_md5`);--> statement-breakpoint
CREATE INDEX `images_source_filename_size_idx` ON `images` (`source_filename_normalized`,`source_file_size`);--> statement-breakpoint
CREATE INDEX `image_reviews_source_file_md5_idx` ON `image_reviews` (`source_file_md5`);--> statement-breakpoint
CREATE INDEX `image_reviews_source_filename_size_idx` ON `image_reviews` (`source_filename_normalized`,`source_file_size`);