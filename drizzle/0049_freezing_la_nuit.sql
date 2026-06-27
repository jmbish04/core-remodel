ALTER TABLE `store_product_research` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_product_research` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `store_product_research` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `store_research` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `store_research` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `store_research` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `product_images` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `product_images` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `product_images` ADD `reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `showroom_images` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_images` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `showroom_images` ADD `reviewed_at` integer;