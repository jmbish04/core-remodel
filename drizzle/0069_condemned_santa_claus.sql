CREATE TABLE `saved_image_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`query_text` text,
	`selected_tags` text,
	`selected_room_ids` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
