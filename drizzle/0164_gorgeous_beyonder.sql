CREATE TABLE `wall_face_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wall_id` integer NOT NULL,
	`side` text NOT NULL,
	`from_inches` integer NOT NULL,
	`to_inches` integer NOT NULL,
	`adjacent_kind` text DEFAULT 'unknown' NOT NULL,
	`adjacent_room_id` integer,
	`exterior_compass` text,
	`exterior_relation` text,
	`insulation_status` text DEFAULT 'unknown' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`wall_id`) REFERENCES `walls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`adjacent_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `wall_openings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wall_id` integer NOT NULL,
	`opening_kind` text NOT NULL,
	`offset_from_left_inches` integer,
	`width_inches` integer,
	`height_inches` integer,
	`sill_height_inches` integer,
	`product_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`wall_id`) REFERENCES `walls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wall_planned_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wall_id` integer NOT NULL,
	`scenario_id` text NOT NULL,
	`change_kind` text NOT NULL,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`wall_id`) REFERENCES `walls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `walls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`label` text,
	`length_inches` integer,
	`height_inches` integer,
	`wall_kind` text DEFAULT 'full' NOT NULL,
	`load_bearing` text DEFAULT 'unknown' NOT NULL,
	`load_bearing_confidence` text DEFAULT 'unknown' NOT NULL,
	`load_bearing_source` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ceiling_feature_distances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature_id` integer NOT NULL,
	`feature_edge` text NOT NULL,
	`wall_id` integer,
	`distance_inches` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`feature_id`) REFERENCES `ceiling_features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wall_id`) REFERENCES `walls`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ceiling_features` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`feature_kind` text NOT NULL,
	`width_inches` integer,
	`length_inches` integer,
	`product_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_existing_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`item_kind` text NOT NULL,
	`width_inches` integer,
	`height_inches` integer,
	`depth_inches` integer,
	`disposition` text DEFAULT 'keep' NOT NULL,
	`product_id` integer,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`kind` text DEFAULT 'EXISTING_FLOORPLAN' NOT NULL,
	`scenario_id` text,
	`length_inches` integer,
	`width_inches` integer,
	`ceiling_height_inches` integer,
	`perimeter_inches` integer,
	`bbox_x_pct` real,
	`bbox_y_pct` real,
	`bbox_w_pct` real,
	`bbox_h_pct` real,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`measured_by` text,
	`measured_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wall_face_segments_wall_idx` ON `wall_face_segments` (`wall_id`);--> statement-breakpoint
CREATE INDEX `wall_face_segments_adjacent_room_idx` ON `wall_face_segments` (`adjacent_room_id`);--> statement-breakpoint
CREATE INDEX `wall_openings_wall_idx` ON `wall_openings` (`wall_id`);--> statement-breakpoint
CREATE INDEX `wall_planned_changes_wall_idx` ON `wall_planned_changes` (`wall_id`);--> statement-breakpoint
CREATE INDEX `wall_planned_changes_scenario_idx` ON `wall_planned_changes` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `walls_project_idx` ON `walls` (`project_id`);--> statement-breakpoint
CREATE INDEX `ceiling_feature_distances_feature_idx` ON `ceiling_feature_distances` (`feature_id`);--> statement-breakpoint
CREATE INDEX `ceiling_features_room_idx` ON `ceiling_features` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_existing_items_room_idx` ON `room_existing_items` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_measurements_room_kind_idx` ON `room_measurements` (`room_id`,`kind`);--> statement-breakpoint
CREATE INDEX `room_measurements_scenario_idx` ON `room_measurements` (`scenario_id`);