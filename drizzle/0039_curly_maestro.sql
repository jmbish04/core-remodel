CREATE TABLE `render_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`design_config` text,
	`hero_canvas_id` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `render_canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`room_id` integer,
	`listing_photo_id` integer,
	`type` text NOT NULL,
	`parent_canvas_id` text,
	`branch_label` text DEFAULT 'A' NOT NULL,
	`lighting_profile` text DEFAULT 'default' NOT NULL,
	`prompt` text,
	`provider` text,
	`model` text,
	`input_cf_image_id` text,
	`output_cf_image_id` text,
	`output_image_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `render_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`listing_photo_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`output_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `canvas_inspiration_references` (
	`canvas_id` text NOT NULL,
	`inspiration_image_id` text NOT NULL,
	`extracted_cf_image_id` text,
	`extraction_notes` text,
	`referenced_region_bounding_box` text,
	`reference_index` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`canvas_id`, `inspiration_image_id`),
	FOREIGN KEY (`canvas_id`) REFERENCES `render_canvases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inspiration_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE restrict
);
