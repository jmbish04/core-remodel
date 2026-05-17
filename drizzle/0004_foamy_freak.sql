CREATE TABLE `image_edit_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_image_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `image_edit_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_image_id` text,
	`output_image_id` text NOT NULL,
	`prompt` text NOT NULL,
	`model` text,
	`revision_number` integer NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `image_edit_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`output_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `images` ADD `photo_category` text DEFAULT 'inspirational' NOT NULL;