CREATE TABLE `pascal_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`core_remodel_project_id` text NOT NULL,
	`name` text NOT NULL,
	`scope_type` text NOT NULL,
	`floor_id` integer,
	`room_id` integer,
	`owner_id` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `pascal_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `pascal_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pascal_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text,
	`project_id` text NOT NULL,
	`parent_scene_id` text,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`graph_json` text DEFAULT '{}' NOT NULL,
	`graph_hash` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`node_count` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`published_version` integer,
	`draft_version` integer,
	`latest_version` integer,
	`browser_visible_version` integer,
	`save_mode` text DEFAULT 'draft' NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`rendering_json` text,
	`thumbnail_url` text,
	`owner_id` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `pascal_studies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `pascal_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_scene_id`) REFERENCES `pascal_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `pascal_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`cf_image_id` text NOT NULL,
	`image_url` text NOT NULL,
	`caption` text,
	`camera_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `pascal_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pascal_scene_events` (
	`event_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scene_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`graph_json` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `pascal_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
