ALTER TABLE `material_schedule_items` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `material_schedule_items` ADD `is_returned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `material_schedule_items` ADD `product_id` integer;