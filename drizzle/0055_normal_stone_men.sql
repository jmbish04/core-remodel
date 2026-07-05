ALTER TABLE `images` ADD `is_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `images` ADD `deleted_marked_by` text;--> statement-breakpoint
ALTER TABLE `images` ADD `deleted_marked_at` integer;--> statement-breakpoint
ALTER TABLE `listing_photos` ADD `skip_blank_canvas` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `images_is_deleted_idx` ON `images` (`is_deleted`);