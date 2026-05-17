CREATE TABLE `supporting_document_room_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supporting_document_id` text NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`supporting_document_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `supporting_document_scenario_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supporting_document_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`supporting_document_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `supporting_document_vision_node_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supporting_document_id` text NOT NULL,
	`vision_node_id` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`supporting_document_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vision_node_id`) REFERENCES `vision_plan_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `supporting_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`mime_type` text,
	`r2_object_key` text,
	`r2_url` text,
	`external_url` text,
	`description` text,
	`tags_json` text,
	`metadata` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_fact_record` integer DEFAULT false NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`revision_of_id` text,
	`replaced_by_id` text,
	`ai_rationale` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`revision_of_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`replaced_by_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `vision_node_image_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vision_node_id` text NOT NULL,
	`image_id` text NOT NULL,
	`relation_type` text DEFAULT 'reference' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vision_node_id`) REFERENCES `vision_plan_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vision_node_room_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vision_node_id` text NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vision_node_id`) REFERENCES `vision_plan_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vision_plan_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`scenario_id` text,
	`title` text NOT NULL,
	`summary` text,
	`node_type` text DEFAULT 'option' NOT NULL,
	`status` text DEFAULT 'considering' NOT NULL,
	`estimated_cost_cents` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`thumbnail_image_id` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `vision_plan_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`thumbnail_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supporting_document_room_unique` ON `supporting_document_room_mappings` (`supporting_document_id`,`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `supporting_document_scenario_unique` ON `supporting_document_scenario_mappings` (`supporting_document_id`,`scenario_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `supporting_document_vision_node_unique` ON `supporting_document_vision_node_mappings` (`supporting_document_id`,`vision_node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vision_node_image_unique` ON `vision_node_image_mappings` (`vision_node_id`,`image_id`,`relation_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `vision_node_room_unique` ON `vision_node_room_mappings` (`vision_node_id`,`room_id`);