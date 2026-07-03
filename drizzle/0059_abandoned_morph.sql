ALTER TABLE `showroom_stores` ADD `hours_json` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `is_large_selection` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `is_bespoke` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `is_designer_only` integer DEFAULT false NOT NULL;