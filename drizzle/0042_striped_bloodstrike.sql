ALTER TABLE `permits_records` ADD `owner_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `owner_close_note` text;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `owner_closed_at` integer;--> statement-breakpoint
ALTER TABLE `permits_records` ADD `owner_closed_by` text;