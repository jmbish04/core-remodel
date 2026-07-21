CREATE TABLE `sales_tax_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rate_ppm` integer NOT NULL,
	`jurisdiction` text,
	`county` text,
	`tac` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source` text DEFAULT 'cdtfa_api' NOT NULL,
	`resolved_address` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_tax_rates_effective_to_idx` ON `sales_tax_rates` (`effective_to`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_store_category_mapping_store_category_uniq` ON `showroom_store_category_mapping` (`store_id`,`category_id`);