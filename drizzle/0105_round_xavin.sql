CREATE TABLE `device_preferences` (
	`device_id` text PRIMARY KEY NOT NULL,
	`landing_path` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
