ALTER TABLE `material_schedule_items` ADD `quantity` integer;--> statement-breakpoint
ALTER TABLE `material_schedule_items` ADD `source_line_item_id` integer;--> statement-breakpoint
ALTER TABLE `material_room_proposals` ADD `unit_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `material_room_proposals` ADD `application` text;