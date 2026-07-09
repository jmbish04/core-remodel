CREATE TABLE `wishlist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer,
	`showroom_store_product_id` integer,
	`material_schedule_item_id` integer,
	`title` text NOT NULL,
	`image_url` text,
	`price` real,
	`notes` text,
	`status` text DEFAULT 'wishlist' NOT NULL,
	`priority` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`showroom_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`material_schedule_item_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `wishlist_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cover_image_url` text,
	`is_shared` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wishlist_collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`wishlist_item_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `wishlist_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wishlist_item_id`) REFERENCES `wishlist_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wishlist_items_room_idx` ON `wishlist_items` (`room_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_store_product_idx` ON `wishlist_items` (`showroom_store_product_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_material_item_idx` ON `wishlist_items` (`material_schedule_item_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_status_idx` ON `wishlist_items` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_collection_items_collection_item_unique` ON `wishlist_collection_items` (`collection_id`,`wishlist_item_id`);--> statement-breakpoint
CREATE INDEX `wishlist_collection_items_wishlist_item_idx` ON `wishlist_collection_items` (`wishlist_item_id`);