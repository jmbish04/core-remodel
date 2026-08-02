CREATE TABLE `room_note_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_problem_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_problem_fix_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_problem_document_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_use_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_intent_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`scope_level` text NOT NULL,
	`requires_full_spec` integer DEFAULT false NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`is_entire_floor_applicable` integer DEFAULT false NOT NULL,
	`is_entire_home_applicable` integer DEFAULT false NOT NULL,
	`scope_granularity` text DEFAULT 'room' NOT NULL,
	`takeoff_unit` text NOT NULL,
	`default_waste_factor` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_type_room_type_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_type_id` integer NOT NULL,
	`room_type_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_type_id`) REFERENCES `material_type_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_type_id`) REFERENCES `room_type_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_note_type_def_key_unique` ON `room_note_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_type_def_key_unique` ON `room_problem_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_fix_def_key_unique` ON `room_problem_fix_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_document_type_def_key_unique` ON `room_problem_document_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_use_def_key_unique` ON `room_use_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_type_def_key_unique` ON `room_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_intent_type_def_key_unique` ON `room_intent_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_type_def_key_unique` ON `material_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_type_room_type_mapping_material_room_uniq` ON `material_type_room_type_mapping` (`material_type_id`,`room_type_id`);