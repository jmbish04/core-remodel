-- Hand-written: drop NOT NULL from material_room_proposals.material_id.
--
-- Drizzle refuses to auto-generate a drop-not-null (SQLite has no ALTER COLUMN
-- for it). 0130 created the column NOT NULL, but a proposal for an ambiguous
-- room has NO material until a human resolves it — the material is minted into
-- the confirmed room, never a placeholder. So material_id must be nullable, and
-- the staged path was 500ing on the NOT NULL constraint.
--
-- Safe as a drop+recreate: the table is empty (0 rows), and NOTHING references
-- material_room_proposals — every FK points OUT of it, so DROP TABLE cannot
-- cascade into another table's data.
DROP TABLE IF EXISTS `material_room_proposals`;--> statement-breakpoint
CREATE TABLE `material_room_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer,
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
