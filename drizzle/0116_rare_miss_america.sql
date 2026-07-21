CREATE TABLE `brand_name_variations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`brand_name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_name_variations_one_primary` ON `brand_name_variations` (`brand_id`) WHERE "brand_name_variations"."is_primary" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `brand_name_variations_brand_name_uniq` ON `brand_name_variations` (`brand_id`,`brand_name`);--> statement-breakpoint
CREATE INDEX `brand_name_variations_name_idx` ON `brand_name_variations` (`brand_name`);--> statement-breakpoint
CREATE INDEX `brand_name_variations_brand_idx` ON `brand_name_variations` (`brand_id`);