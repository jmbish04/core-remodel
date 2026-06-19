CREATE TABLE `photo_viewer_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`author_name` text,
	`author_role` text,
	`note_text` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photo_viewer_notes_image_id_idx` ON `photo_viewer_notes` (`image_id`);--> statement-breakpoint
CREATE INDEX `photo_viewer_notes_created_at_idx` ON `photo_viewer_notes` (`datetime_created`);