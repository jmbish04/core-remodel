CREATE TABLE `guest_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`company_website_url` text,
	`cookie_id` text NOT NULL,
	`resolved_showroom_id` integer,
	`place_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`resolved_showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guest_contacts_email_unique` ON `guest_contacts` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `guest_contacts_cookie_id_unique` ON `guest_contacts` (`cookie_id`);