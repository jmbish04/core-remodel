ALTER TABLE `showroom_stores` ADD `is_trade_rep_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `google_rating` real;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `user_rating_count` integer;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `review_summary` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `access_level` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `access_level_reasoning` text;