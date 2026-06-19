CREATE TABLE `work_item_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_data` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`work_item_type_id` integer,
	`measurement_type` text NOT NULL,
	`max_unit_price` real,
	`sf_unit_price` real,
	`sf_multiplier` real,
	`rationale` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_item_type_id`) REFERENCES `work_item_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `standard_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer,
	`room_name` text NOT NULL,
	`floor_name` text NOT NULL,
	`work_item` text NOT NULL,
	`work_item_type_id` integer,
	`trade_data_id` text,
	`quantity` real NOT NULL,
	`measurement_type` text NOT NULL,
	`unit_price` real,
	`sf_unit_price` real,
	`tax` real DEFAULT 0,
	`overhead_and_profit` real DEFAULT 0,
	`rcv` real,
	`total_cost` real,
	`total_sf_cost` real,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_type_id`) REFERENCES `work_item_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_data_id`) REFERENCES `trade_data`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `static_budget_items` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`floor_id` integer,
	`floor_name` text,
	`area_room` text,
	`comparison_group` text,
	`item_description` text NOT NULL,
	`estimated_qty` real,
	`unit` text,
	`min_unit_cost` real,
	`max_unit_cost` real,
	`min_cost` real,
	`avg_cost` real,
	`max_cost` real,
	`phase_tag` text,
	`notes` text,
	`source_sheet` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_variance_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scenario_key` text NOT NULL,
	`label` text NOT NULL,
	`kitchen_location` text NOT NULL,
	`sub_location` text,
	`layout_type` text,
	`plumbing_strategy` text,
	`deviation_total` real NOT NULL,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_variance_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` integer NOT NULL,
	`line_item_label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`cost_amount` real,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `budget_variance_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assumption_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`section_name` text NOT NULL,
	`item_description` text NOT NULL,
	`min_cost` real,
	`avg_cost` real,
	`max_cost` real,
	`phase_tag` text,
	`variant_risk_notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source_row` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assumption_micro_variances` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_letter` text,
	`variant_number` integer,
	`wall_position` text,
	`floor_type` text,
	`plumbing_type` text,
	`is_addon` integer DEFAULT false NOT NULL,
	`addon_category` text,
	`item_description` text NOT NULL,
	`min_cost` real,
	`avg_cost` real,
	`max_cost` real,
	`phase_tag` text,
	`variant_risk_notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source_row` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_system_variables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variable_key` text NOT NULL,
	`value_text` text NOT NULL,
	`unit` text,
	`category` text,
	`description` text,
	`mapping_ref_key` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_types_key_unique` ON `work_item_types` (`key`);--> statement-breakpoint
CREATE INDEX `idx_td_category` ON `trade_data` (`category`);--> statement-breakpoint
CREATE INDEX `idx_td_work_item_type` ON `trade_data` (`work_item_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_td_work_item_category` ON `trade_data` (`work_item`,`category`);--> statement-breakpoint
CREATE INDEX `idx_sc_room` ON `standard_costs` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_sc_work_item_type` ON `standard_costs` (`work_item_type_id`);--> statement-breakpoint
CREATE INDEX `idx_sc_floor_name` ON `standard_costs` (`floor_name`);--> statement-breakpoint
CREATE INDEX `idx_sbi_category` ON `static_budget_items` (`category`);--> statement-breakpoint
CREATE INDEX `idx_sbi_floor` ON `static_budget_items` (`floor_id`);--> statement-breakpoint
CREATE INDEX `idx_sbi_phase_tag` ON `static_budget_items` (`phase_tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_variance_scenarios_scenario_key_unique` ON `budget_variance_scenarios` (`scenario_key`);--> statement-breakpoint
CREATE INDEX `idx_bvli_scenario` ON `budget_variance_line_items` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `idx_ali_section` ON `assumption_line_items` (`section_name`);--> statement-breakpoint
CREATE INDEX `idx_ali_phase_tag` ON `assumption_line_items` (`phase_tag`);--> statement-breakpoint
CREATE INDEX `idx_amv_scenario` ON `assumption_micro_variances` (`scenario_letter`);--> statement-breakpoint
CREATE INDEX `idx_amv_addon` ON `assumption_micro_variances` (`is_addon`,`addon_category`);--> statement-breakpoint
CREATE INDEX `idx_amv_wall_position` ON `assumption_micro_variances` (`wall_position`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_system_variables_variable_key_unique` ON `project_system_variables` (`variable_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_system_variables_mapping_ref_key_unique` ON `project_system_variables` (`mapping_ref_key`);