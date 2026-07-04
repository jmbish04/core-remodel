CREATE TABLE `showroom_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`day` text NOT NULL,
	`open_hour` integer NOT NULL,
	`open_minute` integer DEFAULT 0 NOT NULL,
	`close_hour` integer NOT NULL,
	`close_minute` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_hours_showroom_day_unique` ON `showroom_hours` (`showroom_id`,`day`);