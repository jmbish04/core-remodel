CREATE TABLE `assembly_layer_kind_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`takeoff_unit` text DEFAULT 'sqft' NOT NULL,
	`default_waste_factor` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assembly_layers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assembly_id` integer NOT NULL,
	`layer_kind_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`product_id` integer,
	`thickness_inches` real,
	`spec_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assembly_id`) REFERENCES `surface_assemblies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`layer_kind_id`) REFERENCES `assembly_layer_kind_def`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `fixture_requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_type_id` integer NOT NULL,
	`requirement_kind` text NOT NULL,
	`spec` text,
	`blocks_assembly_close` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fixture_type_id`) REFERENCES `fixture_type_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fixture_type_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`applies_to_surface_kinds` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `surface_assemblies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`surface_kind` text NOT NULL,
	`surface_id` integer NOT NULL,
	`scenario_id` text,
	`label` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `surface_fixtures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`surface_kind` text NOT NULL,
	`surface_id` integer NOT NULL,
	`fixture_type_id` integer NOT NULL,
	`offset_x_inches` integer,
	`offset_y_inches` integer,
	`product_id` integer,
	`scenario_id` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fixture_type_id`) REFERENCES `fixture_type_def`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `material_schedule_items` ADD `material_type_id` integer REFERENCES material_type_def(id);--> statement-breakpoint
CREATE UNIQUE INDEX `assembly_layer_kind_def_key_unique` ON `assembly_layer_kind_def` (`key`);--> statement-breakpoint
CREATE INDEX `assembly_layers_assembly_idx` ON `assembly_layers` (`assembly_id`,`position`);--> statement-breakpoint
CREATE INDEX `fixture_requirements_fixture_idx` ON `fixture_requirements` (`fixture_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fixture_type_def_key_unique` ON `fixture_type_def` (`key`);--> statement-breakpoint
CREATE INDEX `surface_assemblies_surface_idx` ON `surface_assemblies` (`surface_kind`,`surface_id`);--> statement-breakpoint
CREATE INDEX `surface_fixtures_surface_idx` ON `surface_fixtures` (`surface_kind`,`surface_id`);--> statement-breakpoint
CREATE INDEX `surface_fixtures_type_idx` ON `surface_fixtures` (`fixture_type_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/