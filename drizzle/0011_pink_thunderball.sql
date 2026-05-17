CREATE TABLE `image_review_highlights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`highlight_type` text DEFAULT 'like' NOT NULL,
	`shape_type` text DEFAULT 'rect' NOT NULL,
	`x_pct` real NOT NULL,
	`y_pct` real NOT NULL,
	`width_pct` real NOT NULL,
	`height_pct` real NOT NULL,
	`note` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_tag_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`ai_rationale` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `image_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_tag_mappings_image_tag_unique` ON `image_tag_mappings` (`image_id`,`tag_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_tags_slug_unique` ON `image_tags` (`slug`);