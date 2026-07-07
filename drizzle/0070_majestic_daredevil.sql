CREATE TABLE `blank_canvas_generation_job_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`listing_photo_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`blank_canvas_cf_image_id` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `blank_canvas_generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blank_canvas_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`leave_outline` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blank_canvas_generation_job_items_job_id_idx` ON `blank_canvas_generation_job_items` (`job_id`);