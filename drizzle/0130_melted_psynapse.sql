CREATE TABLE `material_room_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`line_item_id` integer,
	`subcategory_id` integer,
	`status` text DEFAULT 'staged' NOT NULL,
	`proposed_room_id` integer,
	`confirmed_room_id` integer,
	`candidates_json` text,
	`confidence` integer,
	`reasoning_markdown` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_item_id`) REFERENCES `worker_email_invoice_line_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`proposed_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`confirmed_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `material_room_proposals_material_idx` ON `material_room_proposals` (`material_id`);--> statement-breakpoint
CREATE INDEX `material_room_proposals_status_idx` ON `material_room_proposals` (`status`);--> statement-breakpoint
CREATE INDEX `material_room_proposals_line_item_idx` ON `material_room_proposals` (`line_item_id`);