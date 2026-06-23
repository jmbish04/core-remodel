CREATE TABLE `measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer,
	`floor_id` integer,
	`element_type` text NOT NULL,
	`label` text,
	`length_feet` integer,
	`length_inches` real,
	`width_feet` integer,
	`width_inches` real,
	`height_feet` integer,
	`height_inches` real,
	`span_json` text,
	`area_sq_ft` real,
	`quantity` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'estimated' NOT NULL,
	`is_approximate` integer DEFAULT true NOT NULL,
	`accuracy_note` text,
	`notes` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch() * 1000) NOT NULL,	
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `rooms` ADD `area_sq_ft` real;--> statement-breakpoint
CREATE INDEX `measurements_room_id_idx` ON `measurements` (`room_id`);--> statement-breakpoint
CREATE INDEX `measurements_floor_id_idx` ON `measurements` (`floor_id`);--> statement-breakpoint
CREATE INDEX `measurements_element_type_idx` ON `measurements` (`element_type`);
