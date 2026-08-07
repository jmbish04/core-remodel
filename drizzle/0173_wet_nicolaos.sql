CREATE TABLE `render_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`design_config` text,
	`prompt` text,
	`hero_session_id` text,
	`total_angles` integer DEFAULT 0 NOT NULL,
	`completed_angles` integer DEFAULT 0 NOT NULL,
	`failed_angles` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `render_campaign_angles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`room_id` integer,
	`listing_photo_id` integer,
	`is_hero` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`session_id` text,
	`canvas_id` text,
	`error` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `render_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`listing_photo_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `render_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`canvas_id`) REFERENCES `render_canvases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `render_campaign_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`room_id` integer,
	`is_hero` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `render_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `render_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
