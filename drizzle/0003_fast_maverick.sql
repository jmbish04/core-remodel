CREATE TABLE `image_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`filename` text NOT NULL,
	`room` text DEFAULT 'unassigned',
	`tags` text,
	`note` text DEFAULT '',
	`source_file` text,
	`image_number` text,
	`ig_account` text,
	`visible_caption` text,
	`width` integer,
	`height` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
