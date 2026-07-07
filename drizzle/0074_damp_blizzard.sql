CREATE TABLE `workstation_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `board_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`cf_image_url` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`render_canvas_id` text,
	`parent_node_id` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 320 NOT NULL,
	`height` real DEFAULT 240 NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`z_index` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `workstation_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`render_canvas_id`) REFERENCES `render_canvases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `photo_collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` text NOT NULL,
	`cf_image_url` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `photo_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photo_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text,
	`dock_slot` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `workstation_boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sample_clippings` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer,
	`source_cf_image_url` text NOT NULL,
	`clipping_cf_image_url` text NOT NULL,
	`label` text,
	`bbox_json` text,
	`render_canvas_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`render_canvas_id`) REFERENCES `render_canvases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workstation_boards_room_id_unique` ON `workstation_boards` (`room_id`);--> statement-breakpoint
CREATE INDEX `board_nodes_board_id_idx` ON `board_nodes` (`board_id`);--> statement-breakpoint
CREATE INDEX `board_nodes_board_id_z_index_idx` ON `board_nodes` (`board_id`,`z_index`);--> statement-breakpoint
CREATE INDEX `photo_collection_items_collection_id_idx` ON `photo_collection_items` (`collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_collection_items_collection_image_unique` ON `photo_collection_items` (`collection_id`,`cf_image_url`);--> statement-breakpoint
CREATE INDEX `photo_collections_board_id_idx` ON `photo_collections` (`board_id`);--> statement-breakpoint
CREATE INDEX `sample_clippings_room_id_idx` ON `sample_clippings` (`room_id`);