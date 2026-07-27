CREATE TABLE IF NOT EXISTS `furnishing_items` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer NOT NULL,
	`source_node_id` text,
	`label` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`product_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
