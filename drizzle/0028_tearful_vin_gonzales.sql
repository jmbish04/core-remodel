ALTER TABLE `images` ADD `is_duplicate` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `images` ADD `duplicate_marked_by` text;--> statement-breakpoint
ALTER TABLE `images` ADD `duplicate_marked_at` integer;--> statement-breakpoint
CREATE INDEX `images_is_duplicate_idx` ON `images` (`is_duplicate`);