CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dashboard_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_name` text NOT NULL,
	`metric_value` real NOT NULL,
	`metric_type` text NOT NULL,
	`category` text NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_analytics_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_title` text NOT NULL,
	`category` text NOT NULL,
	`region` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`bid_amount` real NOT NULL,
	`keywords` text NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `health_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_name` text NOT NULL,
	`status` text NOT NULL,
	`response_time` integer,
	`error_message` text,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`slug` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`doc_path` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_slug` text NOT NULL,
	`task_key` text NOT NULL,
	`workstream` text DEFAULT 'general' NOT NULL,
	`phase` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`target_route` text,
	`change_type` text DEFAULT 'new' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`depends_on` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`plan_slug`) REFERENCES `plans`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	`visibility` text DEFAULT 'private' NOT NULL,
	`extracted_text` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`doc_type` text,
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
CREATE TABLE `document_entity_associations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_saved_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`filters_json` text,
	`doc_ids_json` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimate_companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`business_type` text DEFAULT 'unknown' NOT NULL,
	`website` text,
	`email` text,
	`phone` text,
	`address` text,
	`cslb_license_number` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimate_company_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_company_id` integer,
	`name` text NOT NULL,
	`title` text,
	`email` text,
	`phone` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`mapping_status` text DEFAULT 'mapped' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_company_id`) REFERENCES `estimate_companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `estimate_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_revision_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`r2_object_key` text,
	`r2_url` text,
	`source_url` text,
	`raw_text` text,
	`raw_markdown` text,
	`ai_structured_extraction_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `estimate_line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_revision_id` integer NOT NULL,
	`item_code` text,
	`description` text NOT NULL,
	`qty` real,
	`uom` text,
	`unit_cost_cents` integer,
	`line_total_cents` integer,
	`tax_cents` integer,
	`notes` text,
	`service_id` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `estimate_prop_key_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property` text NOT NULL,
	`data_type` text NOT NULL,
	`schema_version` text DEFAULT 'v1' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimate_prop_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_revision_id` integer NOT NULL,
	`estimate_document_id` integer,
	`property` text NOT NULL,
	`estimate_prop_key_type_id` integer NOT NULL,
	`workerai_extracted_value` text,
	`intake_form_value` text,
	`is_user_overridden` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_document_id`) REFERENCES `estimate_documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_prop_key_type_id`) REFERENCES `estimate_prop_key_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `estimate_revision_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_revision_id` integer NOT NULL,
	`snapshot_type` text DEFAULT 'autosave' NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `estimate_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_id` integer NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	`estimate_status_id` integer,
	`status_notes` text,
	`date_estimate` integer,
	`total_amount_cents` integer,
	`total_tax_cents` integer,
	`deposit_amount_cents` integer,
	`warranty_details` text,
	`cancellation_details` text,
	`ai_rationale` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`created_by` text,
	`source_summary` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_status_id`) REFERENCES `estimate_statuses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `estimate_room_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_revision_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `estimate_source_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_revision_id` integer NOT NULL,
	`estimate_document_id` integer,
	`source_type` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_document_id`) REFERENCES `estimate_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `estimate_statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_terminal` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimate_sync_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text DEFAULT 'google_sheets' NOT NULL,
	`last_pull_at` integer,
	`last_push_at` integer,
	`cursor_value` text,
	`sync_hash` text,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scenario_id` text,
	`estimate_company_id` integer,
	`current_revision_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_company_id`) REFERENCES `estimate_companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `contract_clause_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_revision_id` integer NOT NULL,
	`clause_type` text NOT NULL,
	`risk_level` text DEFAULT 'info' NOT NULL,
	`finding_text` text NOT NULL,
	`recommendation` text,
	`source_snippet` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_revision_id` integer NOT NULL,
	`document_type` text DEFAULT 'contract' NOT NULL,
	`r2_object_key` text,
	`r2_url` text,
	`raw_text` text,
	`ai_extraction_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_monitoring_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`contract_revision_id` integer,
	`related_estimate_id` integer,
	`event_type` text NOT NULL,
	`source` text DEFAULT 'system' NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`related_estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `contract_negotiation_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_revision_id` integer NOT NULL,
	`topic` text NOT NULL,
	`ai_recommendation` text,
	`user_decision` text,
	`disposition_notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_payment_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_revision_id` integer NOT NULL,
	`milestone_name` text NOT NULL,
	`due_criteria` text,
	`amount_cents` integer,
	`due_start_at` integer,
	`due_end_at` integer,
	`completion_evidence_required` text,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	`contract_status_id` integer,
	`ai_rationale` text,
	`status_notes` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`created_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contract_status_id`) REFERENCES `contract_statuses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `contract_statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_terminal` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contract_timeline_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_revision_id` integer NOT NULL,
	`milestone_name` text NOT NULL,
	`planned_at` integer,
	`actual_at` integer,
	`delay_reason` text,
	`notice_window` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_warranty_terms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_revision_id` integer NOT NULL,
	`duration_text` text,
	`scope_text` text,
	`exclusions_text` text,
	`start_trigger` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_revision_id`) REFERENCES `contract_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scenario_id` text,
	`estimate_company_id` integer,
	`linked_estimate_id` integer,
	`current_revision_id` integer,
	`contract_required` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_company_id`) REFERENCES `estimate_companies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `floors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`level_order` integer DEFAULT 0 NOT NULL,
	`living_sq_ft` integer,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`floor_id` integer NOT NULL,
	`room_code` text NOT NULL,
	`room_name` text NOT NULL,
	`as_is_use` text,
	`length_feet` integer,
	`length_inches` integer,
	`width_feet` integer,
	`width_inches` integer,
	`area_sq_ft` real,
	`is_living_space` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`problem_areas` text,
	`plumbing_notes` text,
	`electrical_notes` text,
	`structural_notes` text,
	`hvac_notes` text,
	`general_notes` text,
	`metadata` text,
	`floorplan_floor_key` text,
	`floorplan_x_pct` real,
	`floorplan_y_pct` real,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `remodel_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`budget_low_cents` integer,
	`budget_high_cents` integer,
	`decision_notes` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_room_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`room_id` integer NOT NULL,
	`proposed_use` text NOT NULL,
	`stage` text DEFAULT 'considering' NOT NULL,
	`estimated_cost_cents` integer,
	`notes` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer NOT NULL,
	`scenario_id` text,
	`category` text DEFAULT 'general' NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`estimated_cost_cents` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `budget_expense_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`replaced_by_expense_id` integer,
	`replaced_at` integer,
	`item` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`vendor_name` text,
	`scenario_id` text,
	`option_group` text,
	`option_key` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`date_incurred` integer,
	`notes` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `budget_funding_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_key` text NOT NULL,
	`account_label` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_project_info` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`info_key` text NOT NULL,
	`info_label` text NOT NULL,
	`info_value` text,
	`notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_tracker_item_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_tracker_item_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`budget_tracker_item_id`) REFERENCES `budget_tracker_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_tracker_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`replaced_by_item_id` integer,
	`replaced_at` integer,
	`item_type` text DEFAULT 'project' NOT NULL,
	`execution_class` text DEFAULT 'must_now' NOT NULL,
	`option_group` text,
	`option_key` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`is_bottleneck` integer DEFAULT false NOT NULL,
	`bottleneck_reason` text,
	`estimated_low_cents` integer,
	`estimated_high_cents` integer,
	`scenario_id` text,
	`owner` text,
	`ai_rationale` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `google_sheet_sync_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text DEFAULT 'google_sheets' NOT NULL,
	`direction` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`cursor_value` text,
	`sync_hash` text,
	`request_json` text,
	`result_json` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budget_item_material_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_item_track_id` text NOT NULL,
	`material_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `truth_table_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`replaced_by_activity_id` text,
	`replaced_at` integer,
	`trade` text NOT NULL,
	`phase` text NOT NULL,
	`scope_key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`scope_keywords` text,
	`unit` text NOT NULL,
	`baseline_labor_cents_per_unit` integer DEFAULT 0 NOT NULL,
	`baseline_material_cents_per_unit` integer DEFAULT 0 NOT NULL,
	`baseline_equipment_cents_per_unit` integer DEFAULT 0 NOT NULL,
	`market_adjustment_pct` real DEFAULT 0 NOT NULL,
	`insurance_baseline_cents_per_unit` integer,
	`notes` text,
	`is_final` integer DEFAULT false NOT NULL,
	`vendor_name` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`confidence_score` real DEFAULT 0.7,
	`embedding_id` text,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`journal_entry_id` integer NOT NULL,
	`type` text NOT NULL,
	`hosting_service` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text,
	`cf_image_id` text,
	`ai_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `shopping_journal_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopping_journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_name` text NOT NULL,
	`store_id` integer,
	`phone_number` text,
	`email` text,
	`website` text,
	`contact_person` text,
	`address` text,
	`notes` text,
	`research_session_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`research_session_id`) REFERENCES `research_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `room_ai_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`representative_image_id` text,
	`summary_markdown` text,
	`summary_json` text,
	`last_user_prompt` text,
	`last_voice_transcript` text,
	`model` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_generated` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`representative_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `homeowner_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`author` text DEFAULT 'Homeowner' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`first_path` text,
	`last_path` text,
	`first_referrer` text,
	`last_referrer` text,
	`user_agent` text,
	`country` text,
	`city` text,
	`timezone` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitor_events` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`session_id` text,
	`event_type` text NOT NULL,
	`path` text NOT NULL,
	`element` text,
	`duration_ms` integer,
	`referrer` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitor_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `planning_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`participant_type` text DEFAULT 'contractor' NOT NULL,
	`company_name` text,
	`email` text,
	`phone` text,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planning_epics` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`phase_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planning_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`epic_id` text NOT NULL,
	`room_id` integer,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`task_order` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`due_date` text,
	`owner_participant_id` integer,
	`responsible_participant_id` integer,
	`accountable_participant_id` integer,
	`support_participant_ids` text,
	`consulted_participant_ids` text,
	`informed_participant_ids` text,
	`depends_on_task_ids` text,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`epic_id`) REFERENCES `planning_epics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsible_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accountable_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `planning_task_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`update_date` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`transcript` text,
	`audio_key` text,
	`audio_mime_type` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_by_participant_id` integer,
	`is_draft` integer DEFAULT false NOT NULL,
	`approved_by_participant_id` integer,
	`approved_at` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `planning_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `planning_task_update_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_update_id` text NOT NULL,
	`image_id` text NOT NULL,
	`ai_analysis` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_update_id`) REFERENCES `planning_task_updates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `planning_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`log_type` text NOT NULL,
	`log_date` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`transcript` text,
	`audio_key` text,
	`audio_mime_type` text,
	`author_participant_id` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`author_participant_id`) REFERENCES `planning_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `permits_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_type` text NOT NULL,
	`query_label` text NOT NULL,
	`source_dataset` text NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`ai_summary` text,
	`error_text` text,
	`raw_payload` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permits_records` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset` text NOT NULL,
	`record_key` text NOT NULL,
	`permit_identifier` text,
	`application_number` text,
	`permit_number` text,
	`permit_type` text,
	`permit_status` text,
	`status_category` text,
	`property_address` text,
	`block` text,
	`lot` text,
	`contact_name` text,
	`contact_role` text,
	`filed_date` text,
	`issued_date` text,
	`expires_date` text,
	`closed_date` text,
	`latitude` text,
	`longitude` text,
	`is_property_permit` integer DEFAULT false NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	`owner_closed` integer DEFAULT false NOT NULL,
	`owner_close_note` text,
	`owner_closed_at` integer,
	`owner_closed_by` text,
	`change_hash` text,
	`last_changed_at` integer,
	`latest_run_id` text,
	`raw_data` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`latest_run_id`) REFERENCES `permits_sync_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `permits_record_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`dataset` text NOT NULL,
	`record_key` text NOT NULL,
	`permit_number` text,
	`permit_status` text,
	`raw_data` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `permits_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `permits_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_name` text NOT NULL,
	`is_monitored` integer DEFAULT true NOT NULL,
	`active_property_permit_count` integer DEFAULT 0 NOT NULL,
	`closed_property_permit_count` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`license_number` text,
	`sf_business_license_number` text,
	`firm_name` text,
	`firm_address` text,
	`role` text,
	`anchor_permit_identifiers` text,
	`anchor_reference_filed_date` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permits_contact_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_name` text NOT NULL,
	`dataset` text NOT NULL,
	`record_key` text,
	`permit_identifier` text,
	`application_number` text,
	`permit_number` text,
	`permit_type` text,
	`permit_status` text,
	`status_category` text,
	`property_address` text,
	`issued_date` text,
	`closed_date` text,
	`latitude` text,
	`longitude` text,
	`trade` text,
	`filed_date` text,
	`block` text,
	`lot` text,
	`is_open` integer DEFAULT false NOT NULL,
	`is_recently_closed` integer DEFAULT false NOT NULL,
	`relation_to_anchor` text,
	`recent_activity_type` text,
	`recent_activity_date` text,
	`recent_activity_detail` text,
	`match_strategy` text,
	`match_confidence` text,
	`anchor_permit_identifier` text,
	`run_id` text,
	`raw_data` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `permits_sync_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `permits_identifier_views` (
	`permit_identifier` text PRIMARY KEY NOT NULL,
	`last_viewed_hash` text,
	`last_viewed_at` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permits_contact_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_name` text NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`before_busyness` text,
	`after_busyness` text,
	`summary` text NOT NULL,
	`highlights` text,
	`metrics` text,
	`model` text,
	`last_run_id` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`description` text,
	`cf_image_id_original` text NOT NULL,
	`cf_image_id_optimized` text,
	`photo_category` text DEFAULT 'inspirational' NOT NULL,
	`room_id` integer,
	`room_type` text,
	`is_instagram` integer DEFAULT false NOT NULL,
	`instagram_account` text,
	`instagram_caption` text,
	`metadata` text,
	`is_listing_photo` integer DEFAULT false NOT NULL,
	`source_filename` text,
	`source_filename_normalized` text,
	`source_file_size` integer,
	`source_file_md5` text,
	`is_duplicate` integer DEFAULT false NOT NULL,
	`duplicate_marked_by` text,
	`duplicate_marked_at` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_marked_by` text,
	`deleted_marked_at` integer,
	`reviewed` integer DEFAULT false NOT NULL,
	`reviewed_at` integer,
	`inspiration_scope` text DEFAULT 'room' NOT NULL,
	`scope_floor_id` integer,
	`inspiration_category` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`scope_floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `inspirational_image_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`room_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `listing_photo_blank_canvases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_photo_id` integer NOT NULL,
	`cf_image_id` text NOT NULL,
	`prompt` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`listing_photo_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `listing_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text,
	`cf_image_id` text NOT NULL,
	`blank_canvas_cf_image_id` text,
	`room_id` integer,
	`room_name` text NOT NULL,
	`description` text,
	`skip_blank_canvas` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `ai_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_listing_id` integer NOT NULL,
	`prompt` text NOT NULL,
	`generated_cf_image_id` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`original_listing_id`) REFERENCES `listing_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`filename` text NOT NULL,
	`room` text DEFAULT 'unassigned',
	`tags` text,
	`note` text DEFAULT '',
	`source_file` text,
	`image_number` text,
	`ig_account` text,
	`visible_caption` text,
	`reviewed` integer DEFAULT false,
	`width` integer,
	`height` integer,
	`source_filename_normalized` text,
	`source_file_size` integer,
	`source_file_md5` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_oauth_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`refresh_token` text NOT NULL,
	`scope` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mood_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`background_color` text DEFAULT '#ffffff',
	`layout_state` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_image_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`query_text` text,
	`selected_tags` text,
	`selected_room_ids` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `image_edit_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_image_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_last_modified` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `image_edit_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`prompt` text NOT NULL,
	`starting_image_url` text NOT NULL,
	`output_image_url` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`source_image_id` text,
	`output_image_id` text,
	`model` text,
	`revision_number` integer,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`session_id`) REFERENCES `image_edit_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`output_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_upload_staging` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`photo_category` text NOT NULL,
	`mapping_status` text DEFAULT 'pending' NOT NULL,
	`processing_status` text DEFAULT 'queued' NOT NULL,
	`workflow_instance_id` text,
	`processing_error` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_processing_started` integer,
	`datetime_processed` integer,
	`datetime_mapped` integer,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `image_tag_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`ai_rationale` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `image_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_review_highlights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`highlight_type` text DEFAULT 'like' NOT NULL,
	`shape_type` text DEFAULT 'rect' NOT NULL,
	`x_pct` real NOT NULL,
	`y_pct` real NOT NULL,
	`width_pct` real NOT NULL,
	`height_pct` real NOT NULL,
	`note` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	`mood_board_id` text,
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
--> statement-breakpoint
CREATE TABLE `mood_board_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text,
	`source_images` text,
	`output_cf_image_id` text,
	`output_image_url` text,
	`ai_title` text,
	`ai_description` text,
	`room_id` integer,
	`floor_id` integer,
	`model` text,
	`source` text,
	`status` text DEFAULT 'done' NOT NULL,
	`is_shared` integer DEFAULT false NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `photo_viewer_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`author_name` text,
	`author_role` text,
	`note_text` text NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `workstation_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `board_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`cf_image_url` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`render_canvas_id` text,
	`parent_node_id` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 320 NOT NULL,
	`height` real DEFAULT 240 NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`z_index` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `workstation_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`render_canvas_id`) REFERENCES `render_canvases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `photo_collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` text NOT NULL,
	`cf_image_url` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `photo_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photo_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text,
	`dock_slot` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `workstation_boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sample_clippings` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` integer,
	`source_cf_image_url` text NOT NULL,
	`clipping_cf_image_url` text NOT NULL,
	`label` text,
	`bbox_json` text,
	`render_canvas_id` text,
	`is_global` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`render_canvas_id`) REFERENCES `render_canvases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `checklist_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`question_id` integer NOT NULL,
	`scenario_id` text,
	`is_checked` integer DEFAULT false NOT NULL,
	`notes` text,
	`selection_value` text,
	`version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`change_source` text DEFAULT 'manual' NOT NULL,
	`changed_by` text DEFAULT 'homeowner' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `checklist_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `remodel_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `checklist_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`code` text NOT NULL,
	`question_text` text NOT NULL,
	`considerations` text,
	`default_budget_impact_json` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `checklist_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `checklist_room_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`ai_rationale` text,
	`association_status` text DEFAULT 'ai_suggested' NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `checklist_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `checklist_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`helper_text` text,
	`icon_identifier` text DEFAULT 'HelpCircle' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checklist_service_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`processed_records_count` integer DEFAULT 0 NOT NULL,
	`chain_of_thought_dump` text,
	`datetime_executed` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_material_quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`material_name` text NOT NULL,
	`supplier_name` text,
	`homeowner_quote_cents` integer DEFAULT 0 NOT NULL,
	`contractor_discount_offer_cents` integer,
	`contractor_notes` text,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `system_cron_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_key` text NOT NULL,
	`cron_expression` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`description` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `workflow_run_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_key` text NOT NULL,
	`workflow_instance_id` text NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`error_message` text,
	`summary_json` text
);
--> statement-breakpoint
CREATE TABLE `research_plan_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`plan_markdown` text NOT NULL,
	`plan_annotations` text,
	`homeowner_feedback` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `research_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `research_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`prompt` text,
	`research_plan` text,
	`engine` text DEFAULT 'gemini' NOT NULL,
	`cf_engine_config` text,
	`cf_engine_state` text,
	`interaction_id` text,
	`last_event_id` text,
	`interaction_agent` text,
	`mcp_bridge_enabled` integer DEFAULT false,
	`status` text DEFAULT 'pending' NOT NULL,
	`plan_status` text DEFAULT 'none' NOT NULL,
	`plan_annotations` text,
	`plan_interaction_id` text,
	`plan_revision` integer DEFAULT 0 NOT NULL,
	`plan_approved_at` integer,
	`r2_markdown_key` text,
	`r2_webapp_key` text,
	`vector_namespace` text,
	`error_message` text,
	`chunk_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `business_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`business_type_id` integer,
	`phone` text,
	`email` text,
	`website` text,
	`license_number` text,
	`notes` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`business_type_id`) REFERENCES `business_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `company_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`title` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `company_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`tags_json` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `company_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`status` text DEFAULT 'open' NOT NULL,
	`due_date` integer,
	`owner` text,
	`tags_json` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_name` text NOT NULL,
	`title` text,
	`email` text,
	`phone` text,
	`notes` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bid_portfolios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`welcome_message` text,
	`overview_statement` text,
	`show_budget_ranges` integer DEFAULT false NOT NULL,
	`expiration_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_room_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`include_photos` integer DEFAULT true NOT NULL,
	`include_dimensions` integer DEFAULT true NOT NULL,
	`include_condition_notes` integer DEFAULT true NOT NULL,
	`include_scope_items` integer DEFAULT true NOT NULL,
	`include_inspiration` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`section` text,
	`room_id` integer,
	`author_name` text NOT NULL,
	`author_email` text,
	`content` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bid_portfolio_selected_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`room_id` integer,
	`image_id` text NOT NULL,
	`caption_override` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `bid_portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `google_maps_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`api_type` text NOT NULL,
	`api_request` text NOT NULL,
	`api_response` text NOT NULL,
	`endpoint` text,
	`session_token` text,
	`status_code` integer
);
--> statement-breakpoint
CREATE TABLE `gemini_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`model` text NOT NULL,
	`feature` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`prompt_tokens` integer,
	`candidates_tokens` integer,
	`thoughts_tokens` integer,
	`cached_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` real,
	`error_message` text,
	`request_meta` text
);
--> statement-breakpoint
CREATE TABLE `dialer_prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`rank` integer NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`full_name` text NOT NULL,
	`firm` text,
	`roles` text NOT NULL,
	`permit_count` integer NOT NULL,
	`avg_cost` integer,
	`median_cost` integer,
	`scope_keywords` text,
	`is_unbundled_candidate` integer DEFAULT false NOT NULL,
	`collision_risk` integer DEFAULT false NOT NULL,
	`license_no` text,
	`distinct_licenses` integer,
	`distinct_firms` integer,
	`distinct_zips` integer,
	`agent_zip` text,
	`agent_address` text,
	`agent_city` text,
	`agent_state` text,
	`phone` text,
	`phone_source` text,
	`email` text,
	`email_source` text,
	`website` text,
	`contact_status` text DEFAULT 'needs_research' NOT NULL,
	`license_note` text,
	`call_script` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dialer_call_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prospect_id` text NOT NULL,
	`outcome` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dialer_prospect_state` (
	`prospect_id` text PRIMARY KEY NOT NULL,
	`disposition` text DEFAULT 'not_called' NOT NULL,
	`rating` integer,
	`favorite` integer DEFAULT false NOT NULL,
	`left_voicemail` integer DEFAULT false NOT NULL,
	`available_to_hire` integer,
	`good_feeling` integer,
	`notes` text,
	`call_count` integer DEFAULT 0 NOT NULL,
	`emailed_at` text,
	`last_contacted_at` text,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_schedule_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`title` text NOT NULL,
	`room_id` integer NOT NULL,
	`brand` text,
	`model` text,
	`notes` text,
	`is_purchased` integer DEFAULT false,
	`purchased_showroom_product_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `material_required_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_bayarea_cities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bay_area_city_name` text NOT NULL,
	`distance_from_san_francisco` text,
	`hub_route` text,
	`hub_name` text
);
--> statement-breakpoint
CREATE TABLE `showroom_stores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_point` text,
	`bay_area_city_id` integer,
	`location_address` text,
	`phone_number` text,
	`email_address` text,
	`website_url` text,
	`zip_code` text,
	`google_maps_link` text,
	`latitude` real,
	`longitude` real,
	`hub_route` text,
	`hub_name` text,
	`hours_json` text,
	`weekday_hours` text,
	`weekend_hours` text,
	`is_open_weekends` integer DEFAULT false,
	`is_appointment_only` integer DEFAULT false,
	`is_flagship_location` integer DEFAULT false,
	`is_large_selection` integer DEFAULT false NOT NULL,
	`is_bespoke` integer DEFAULT false NOT NULL,
	`is_designer_only` integer DEFAULT false NOT NULL,
	`scale` text,
	`inventory_focus` text,
	`target_demographic` text,
	`main_poc_fullname` text,
	`main_poc_phone_number` text,
	`main_poc_email_address` text,
	`distance_from_sf_time` text,
	`distance_from_sf_miles` text,
	`ai_highlights_for_user_renovation` text,
	`location_notes` text,
	`rating` integer,
	`rating_context_html` text,
	`rating_context_markdown` text,
	`instagram_url` text,
	`facebook_url` text,
	`pinterest_url` text,
	`icon_cf_images_url` text,
	`overview_note_html` text,
	`overview_note_markdown` text,
	`rag_uuid` text,
	`hero_image_cf_images_url` text,
	`scrape_status` text DEFAULT 'idle' NOT NULL,
	`is_trade_rep_required` integer DEFAULT false NOT NULL,
	`google_rating` real,
	`place_id` text,
	`user_rating_count` integer,
	`review_summary` text,
	`access_level` text,
	`access_level_reasoning` text,
	`review_ai_insight` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`bay_area_city_id`) REFERENCES `store_bayarea_cities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_store_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer,
	`brand_id` integer,
	`timestamp` integer DEFAULT (unixepoch()),
	`item_name` text NOT NULL,
	`description` text,
	`colors` text,
	`preferred_color` text,
	`sku` text,
	`price` text,
	`json_details` text,
	`notes` text,
	`lead_time` text,
	`possible_discounts` text,
	`trade_discount` text,
	`product_type` text,
	`model_number` text,
	`model_key` text,
	`msrp` text,
	`msrp_cents` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_store_category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `showroom_store_category_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`ai_rationale` text,
	`ai_rationale_confidence_score` integer,
	`is_bread_butter` integer DEFAULT false,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `showroom_store_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`finding` text NOT NULL,
	`finding_url` text,
	`sentiment` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`finding` text NOT NULL,
	`finding_url` text,
	`sentiment` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_pa_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`product_area_id` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_area_id`) REFERENCES `store_product_area_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_area_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `store_product_pa_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`product_area_id` integer NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_area_id`) REFERENCES `store_product_area_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`note` text,
	`title` text,
	`content_html` text,
	`content_markdown` text,
	`is_active` integer DEFAULT true,
	`tags_json` text,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`note` text NOT NULL,
	`is_active` integer DEFAULT true,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_similar_model_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_store_product_id` integer NOT NULL,
	`similar_store_product_id` integer NOT NULL,
	`similar_model_price` text,
	`similar_model_price_diff` text,
	`ai_analysis` text,
	`ai_similarity_review_score` integer,
	`ai_similarity_review_score_rationale` text,
	`user_feedback_notes` text,
	`is_liked_by_user` integer,
	`user_rating_on_similarity` integer,
	`is_user_interested` integer,
	`user_interest_notes` text,
	`timestamp` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`parent_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`similar_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_similar_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_store_id` integer NOT NULL,
	`similar_store_id` integer NOT NULL,
	`similar_store_price_point` text,
	`ai_analysis` text,
	`ai_similarity_review_score` integer,
	`ai_similarity_review_score_rationale` text,
	`user_feedback_notes` text,
	`is_liked_by_user` integer,
	`user_rating_on_similarity` integer,
	`is_user_interested` integer,
	`user_interest_notes` text,
	`timestamp` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`parent_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`similar_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_tag_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`parent_id` integer,
	`is_active` integer DEFAULT true,
	`is_store_tag_only` integer DEFAULT false,
	`is_store_product_tag_only` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `store_product_tag_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`showroom_tag_id` integer NOT NULL,
	`store_product_id` integer NOT NULL,
	FOREIGN KEY (`showroom_tag_id`) REFERENCES `showroom_tag_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_tag_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`showroom_tag_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	FOREIGN KEY (`showroom_tag_id`) REFERENCES `showroom_tag_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_store_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`rating_created` text,
	`source` text NOT NULL,
	`comment` text,
	`rating` integer NOT NULL,
	`scraped_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`rating_notes` text,
	`is_active` integer DEFAULT true,
	`replaced_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`rating_notes` text,
	`is_active` integer DEFAULT true,
	`replaced_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_scan_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_barcode` integer DEFAULT false,
	`cf_image_url` text,
	`r2_key` text,
	`barcode_decoded_value` text,
	`price` text,
	`json_extracted_data` text,
	`ai_rationale` text,
	`ai_model_used` text,
	`extraction_status` text,
	`matched_store_product_id` integer,
	`auto_created_product_id` integer,
	`store_id` integer,
	`scanned_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`matched_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`auto_created_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_page_url` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`alt_text` text,
	`image_kind` text DEFAULT 'unknown' NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`og_title` text,
	`og_description` text,
	`metadata_json` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`spec_key` text NOT NULL,
	`spec_value` text NOT NULL,
	`unit` text,
	`source_url` text,
	`confidence` integer DEFAULT 70 NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_page_url` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`alt_text` text,
	`image_kind` text DEFAULT 'unknown' NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`og_title` text,
	`og_description` text,
	`metadata_json` text,
	`note_html` text,
	`note_markdown` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sourcing_plan_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sweep_session_id` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`plan_markdown` text NOT NULL,
	`plan_annotations` text,
	`homeowner_feedback` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sweep_session_id`) REFERENCES `sourcing_sweep_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sourcing_sweep_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`prompt` text,
	`research_mode` text DEFAULT 'deep' NOT NULL,
	`max_sources` integer,
	`enable_mcp_bridge` integer DEFAULT false NOT NULL,
	`plan_markdown` text,
	`plan_annotations` text,
	`plan_interaction_id` text,
	`plan_status` text DEFAULT 'drafting' NOT NULL,
	`plan_revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`result_json` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`approved_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `showroom_gaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`context` text NOT NULL,
	`gap_key` text NOT NULL,
	`room_id` integer,
	`room_name` text,
	`name` text NOT NULL,
	`description` text,
	`suggested_action` text,
	`source_signal_json` text,
	`status` text DEFAULT 'open' NOT NULL,
	`material_id` integer,
	`sweep_session_id` integer,
	`identified_at` integer DEFAULT (unixepoch()) NOT NULL,
	`dismissed_at` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `showroom_pocs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`full_name` text,
	`title` text,
	`company` text,
	`phone` text,
	`email` text,
	`website` text,
	`address` text,
	`business_card_front_url` text,
	`business_card_back_url` text,
	`extracted_json` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_product_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_material_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `browser_run_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`showroom_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`page_url` text NOT NULL,
	`markdown_r2_url` text,
	`fullpage_screenshot_cf_images_url` text,
	`workers_ai_prompt` text,
	`workers_ai_structured_schema` text,
	`workers_ai_structured_response` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_photos_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`cf_images_photo_url` text NOT NULL,
	`photo_name` text,
	`photo_width_px` integer,
	`photo_height_px` integer,
	`author_attributes` text,
	`flag_content_uri` text,
	`google_maps_uri` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`day` text NOT NULL,
	`open_hour` integer NOT NULL,
	`open_minute` integer DEFAULT 0 NOT NULL,
	`close_hour` integer NOT NULL,
	`close_minute` integer DEFAULT 0 NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_intel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`review_summary` text,
	`price_range_low` text,
	`price_range_high` text,
	`ai_wholesale_price` text,
	`ai_wholesale_rationale` text,
	`ai_retail_price` text,
	`ai_retail_rationale` text,
	`ai_negotiated_price` text,
	`ai_negotiated_rationale` text,
	`sales_intel` text,
	`ca_regulatory_flag` integer,
	`ca_regulatory_notes` text,
	`research_report` text,
	`research_sources` text,
	`research_status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_showroom_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`product_id` integer NOT NULL,
	`showroom_id` integer,
	`image_url` text,
	`cf_image_id` text,
	`category` text,
	`photo_kind` text DEFAULT 'unknown' NOT NULL,
	`attributes` text,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `product_price_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`showroom_id` integer,
	`retailer_name` text,
	`retailer_url` text,
	`price` text,
	`sale_price` text,
	`discount_info` text,
	`price_cents` integer,
	`sale_price_cents` integer,
	`discount_pct` real,
	`condition` text,
	`lead_time` text,
	`notes` text,
	`observed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`source_photo_id` integer,
	`confidence` integer DEFAULT 100 NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer,
	`showroom_store_product_id` integer,
	`material_schedule_item_id` integer,
	`title` text NOT NULL,
	`image_url` text,
	`price` real,
	`notes` text,
	`status` text DEFAULT 'wishlist' NOT NULL,
	`priority` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`showroom_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`material_schedule_item_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `wishlist_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cover_image_url` text,
	`is_shared` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wishlist_collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`wishlist_item_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `wishlist_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wishlist_item_id`) REFERENCES `wishlist_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`website_url` text,
	`instagram_url` text,
	`facebook_url` text,
	`pinterest_url` text,
	`icon_cf_images_url` text,
	`personal_notes` text,
	`online_rating` real,
	`user_rating` real,
	`price_point` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brand_types_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brand_type_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`brand_icon_cf_images_url` text,
	`type_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `brand_types_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_brand_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_intel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`review_summary` text,
	`review_ai_insight` text,
	`is_bigbox_available` integer,
	`bigbox_availability` text,
	`sales_intel` text,
	`research_report` text,
	`research_sources` text,
	`research_status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_page_url` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`alt_text` text,
	`image_kind` text DEFAULT 'unknown' NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`metadata_json` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_product_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`product_type` text,
	`source_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `research_job_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`step_key` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`artifact` text,
	`detail` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `research_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`topic` text,
	`criteria` text,
	`entity_type` text,
	`entity_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`current_step` text,
	`total_steps` integer DEFAULT 1 NOT NULL,
	`completed_steps` integer DEFAULT 0 NOT NULL,
	`plan` text,
	`outline` text,
	`report` text,
	`sources` text,
	`result` text,
	`error` text,
	`workflow_instance_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `clickup_revision_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clickup_task_id` text,
	`clickup_list_id` text,
	`operation` text NOT NULL,
	`request_payload` text NOT NULL,
	`response_payload` text,
	`response_status` integer,
	`actor` text DEFAULT 'system' NOT NULL,
	`r2_attachment_key` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clickup_task_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clickup_task_id` text NOT NULL,
	`flag_type` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`message` text NOT NULL,
	`audit_run_id` text,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clickup_system_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_type` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`audit_run_id` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`acknowledged_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`default_unit_cost` real,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`subject` text,
	`timestamp_sent` integer,
	`company_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `gmail_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`timestamp` integer,
	`from_recipient` text NOT NULL,
	`to_recipients_json` text NOT NULL,
	`subject` text,
	`body` text,
	`ai_summary` text,
	`rag_uuid` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_message_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`email` text NOT NULL,
	`domain` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `gmail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `worker_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text,
	`body_text` text,
	`body_html` text,
	`raw_headers` text,
	`is_forwarded` integer DEFAULT false NOT NULL,
	`route` text,
	`route_reason` text,
	`original_from_address` text,
	`original_from_name` text,
	`original_date` text,
	`matched_company_id` integer,
	`company_match_confidence` real,
	`company_match_method` text,
	`classification` text,
	`classification_confidence` real,
	`ai_reviewer_flags` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_notes` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`matched_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `worker_email_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`filename` text,
	`mime_type` text,
	`size_bytes` integer,
	`r2_key` text NOT NULL,
	`rag_uuid` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `worker_emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `worker_email_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`attachment_id` integer,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`vendor_name` text,
	`invoice_number` text,
	`invoice_date` text,
	`due_date` text,
	`subtotal` real,
	`tax` real,
	`total` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`line_items_json` text,
	`extracted_raw_json` text,
	`confidence` real,
	`status` text DEFAULT 'draft' NOT NULL,
	`confirmed_at` integer,
	`confirmed_by` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `worker_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `worker_email_attachments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `worker_email_invoice_line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text,
	`quantity` real,
	`unit_price` real,
	`line_total` real,
	`material_schedule_item_id` integer,
	`match_status` text DEFAULT 'unmatched' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `worker_email_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_schedule_item_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `worker_email_staged_companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`suggested_name` text,
	`suggested_email` text,
	`suggested_phone` text,
	`suggested_website` text,
	`suggested_business_type` text,
	`suggested_license_number` text,
	`status` text DEFAULT 'staged' NOT NULL,
	`confirmed_company_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `worker_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `worker_email_contracts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`attachment_id` integer,
	`contract_type` text,
	`party_name` text,
	`counterparty_name` text,
	`scope_summary` text,
	`total_value` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`effective_date` text,
	`completion_date` text,
	`clauses_json` text,
	`payment_milestones_json` text,
	`ai_recommendations_json` text,
	`extracted_raw_json` text,
	`confidence` real,
	`status` text DEFAULT 'draft' NOT NULL,
	`confirmed_at` integer,
	`confirmed_by` text,
	`promoted_contract_id` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `worker_emails`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `worker_email_attachments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `mcp_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`transport` text DEFAULT 'streamable' NOT NULL,
	`principal` text,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_tool_invocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`args_json` text,
	`ok` integer DEFAULT true NOT NULL,
	`result_json` text,
	`error_text` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text,
	`title` text NOT NULL,
	`summary` text,
	`format` text DEFAULT 'markdown' NOT NULL,
	`storage` text DEFAULT 'inline' NOT NULL,
	`content` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_agent_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tool_name` text,
	`summary` text NOT NULL,
	`details` text,
	`severity` text DEFAULT 'medium' NOT NULL,
	`repro_steps` text,
	`session_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`fixed_by_pr` integer,
	`fixed_at` integer,
	`dedupe_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_feature_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`use_case` text,
	`requested_by` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`plan_ref` text,
	`pr_number` integer,
	`session_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'app' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`current_revision_id` integer,
	`source_conversation` text,
	`open_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifact_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_id` integer NOT NULL,
	`revision_number` integer NOT NULL,
	`source_tsx` text NOT NULL,
	`entry_export` text DEFAULT 'default' NOT NULL,
	`imports_json` text,
	`change_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drive_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source_conversation` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drive_list_stops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_list_id` integer NOT NULL,
	`showroom_store_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`leg` text,
	`leg_window` text,
	`name` text NOT NULL,
	`city` text,
	`address` text,
	`phone` text,
	`hours` text,
	`note` text,
	`pick` text,
	`website_url` text,
	`latitude` real,
	`longitude` real,
	`is_optional` integer DEFAULT false NOT NULL,
	`visited` integer DEFAULT false NOT NULL,
	`visited_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`drive_list_id`) REFERENCES `drive_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showroom_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subcategories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category_id` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`hex_code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photo_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photo_subcategories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`subcategory_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photo_colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`color_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`color_id`) REFERENCES `colors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_analytics_region` ON `dashboard_analytics_jobs` (`region`);--> statement-breakpoint
CREATE INDEX `idx_analytics_category` ON `dashboard_analytics_jobs` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_tasks_plan_task_uniq` ON `plan_tasks` (`plan_slug`,`task_key`);--> statement-breakpoint
CREATE INDEX `plan_tasks_plan_idx` ON `plan_tasks` (`plan_slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `supporting_document_room_unique` ON `supporting_document_room_mappings` (`supporting_document_id`,`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `supporting_document_scenario_unique` ON `supporting_document_scenario_mappings` (`supporting_document_id`,`scenario_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `supporting_document_vision_node_unique` ON `supporting_document_vision_node_mappings` (`supporting_document_id`,`vision_node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vision_node_image_unique` ON `vision_node_image_mappings` (`vision_node_id`,`image_id`,`relation_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `vision_node_room_unique` ON `vision_node_room_mappings` (`vision_node_id`,`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_entity_associations_unique` ON `document_entity_associations` (`document_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `document_entity_associations_entity_idx` ON `document_entity_associations` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_saved_views_slug_unique` ON `document_saved_views` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_estimate_line_items_service_id` ON `estimate_line_items` (`service_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_prop_key_types_property_unique` ON `estimate_prop_key_types` (`property`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_statuses_name_unique` ON `estimate_statuses` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `contract_statuses_name_unique` ON `contract_statuses` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `floors_key_unique` ON `floors` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_room_code_unique` ON `rooms` (`room_code`);--> statement-breakpoint
CREATE INDEX `measurements_room_id_idx` ON `measurements` (`room_id`);--> statement-breakpoint
CREATE INDEX `measurements_floor_id_idx` ON `measurements` (`floor_id`);--> statement-breakpoint
CREATE INDEX `measurements_element_type_idx` ON `measurements` (`element_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_funding_accounts_account_key_unique` ON `budget_funding_accounts` (`account_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_project_info_info_key_unique` ON `budget_project_info` (`info_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_sheet_sync_events_idempotency_key_unique` ON `google_sheet_sync_events` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_budget_item_material` ON `budget_item_material_mappings` (`budget_item_track_id`,`material_id`);--> statement-breakpoint
CREATE INDEX `idx_tta_scope_key` ON `truth_table_activities` (`scope_key`);--> statement-breakpoint
CREATE INDEX `idx_tta_trade` ON `truth_table_activities` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_tta_phase` ON `truth_table_activities` (`phase`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tta_track_revision` ON `truth_table_activities` (`track_id`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_ai_summaries_room_unique` ON `room_ai_summaries` (`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `planning_epics_slug_unique` ON `planning_epics` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `planning_tasks_slug_unique` ON `planning_tasks` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `permits_records_record_key_unique` ON `permits_records` (`record_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `permits_contacts_contact_name_unique` ON `permits_contacts` (`contact_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `permits_contact_insights_contact_name_unique` ON `permits_contact_insights` (`contact_name`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `project_system_variables_mapping_ref_key_unique` ON `project_system_variables` (`mapping_ref_key`);--> statement-breakpoint
CREATE INDEX `images_source_file_md5_idx` ON `images` (`source_file_md5`);--> statement-breakpoint
CREATE INDEX `images_source_filename_size_idx` ON `images` (`source_filename_normalized`,`source_file_size`);--> statement-breakpoint
CREATE INDEX `images_is_duplicate_idx` ON `images` (`is_duplicate`);--> statement-breakpoint
CREATE INDEX `images_is_deleted_idx` ON `images` (`is_deleted`);--> statement-breakpoint
CREATE INDEX `images_scope_floor_id_idx` ON `images` (`scope_floor_id`);--> statement-breakpoint
CREATE INDEX `images_inspiration_scope_idx` ON `images` (`inspiration_scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspirational_image_rooms_image_room_unique` ON `inspirational_image_rooms` (`image_id`,`room_id`);--> statement-breakpoint
CREATE INDEX `image_reviews_source_file_md5_idx` ON `image_reviews` (`source_file_md5`);--> statement-breakpoint
CREATE INDEX `image_reviews_source_filename_size_idx` ON `image_reviews` (`source_filename_normalized`,`source_file_size`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_upload_staging_image_unique` ON `image_upload_staging` (`image_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_tags_slug_unique` ON `image_tags` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_tag_mappings_image_tag_unique` ON `image_tag_mappings` (`image_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `photo_viewer_notes_image_id_idx` ON `photo_viewer_notes` (`image_id`);--> statement-breakpoint
CREATE INDEX `photo_viewer_notes_created_at_idx` ON `photo_viewer_notes` (`datetime_created`);--> statement-breakpoint
CREATE INDEX `blank_canvas_generation_job_items_job_id_idx` ON `blank_canvas_generation_job_items` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workstation_boards_room_id_unique` ON `workstation_boards` (`room_id`);--> statement-breakpoint
CREATE INDEX `board_nodes_board_id_idx` ON `board_nodes` (`board_id`);--> statement-breakpoint
CREATE INDEX `board_nodes_board_id_z_index_idx` ON `board_nodes` (`board_id`,`z_index`);--> statement-breakpoint
CREATE INDEX `photo_collection_items_collection_id_idx` ON `photo_collection_items` (`collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_collection_items_collection_image_unique` ON `photo_collection_items` (`collection_id`,`cf_image_url`);--> statement-breakpoint
CREATE INDEX `photo_collections_board_id_idx` ON `photo_collections` (`board_id`);--> statement-breakpoint
CREATE INDEX `sample_clippings_room_id_idx` ON `sample_clippings` (`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_questions_code_unique` ON `checklist_questions` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_room_mappings_unique` ON `checklist_room_mappings` (`question_id`,`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_sections_slug_unique` ON `checklist_sections` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `system_cron_schedules_job_key_unique` ON `system_cron_schedules` (`job_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `business_types_name_unique` ON `business_types` (`name`);--> statement-breakpoint
CREATE INDEX `idx_company_notes_company_id` ON `company_notes` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_company_todos_company_id` ON `company_todos` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_company_todos_company_id_status` ON `company_todos` (`company_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `bid_portfolios_token_unique` ON `bid_portfolios` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_bayarea_cities_bay_area_city_name_unique` ON `store_bayarea_cities` (`bay_area_city_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_stores_place_id_uniq` ON `showroom_stores` (`place_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_store_products_brand_model_uniq` ON `showroom_store_products` (`brand_id`,`model_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_images_product_source_unique` ON `product_images` (`store_product_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `product_images_store_product_idx` ON `product_images` (`store_product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_specs_product_key_source_unique` ON `product_specs` (`store_product_id`,`spec_key`,`source_url`);--> statement-breakpoint
CREATE INDEX `product_specs_store_product_idx` ON `product_specs` (`store_product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_images_store_source_unique` ON `showroom_images` (`store_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `showroom_images_store_idx` ON `showroom_images` (`store_id`);--> statement-breakpoint
CREATE INDEX `sourcing_sweep_sessions_target_idx` ON `sourcing_sweep_sessions` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `sourcing_sweep_sessions_status_idx` ON `sourcing_sweep_sessions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_gaps_ctx_key_idx` ON `showroom_gaps` (`context`,`gap_key`);--> statement-breakpoint
CREATE INDEX `showroom_gaps_status_idx` ON `showroom_gaps` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_mappings_showroom_product_uniq` ON `showroom_product_mappings` (`showroom_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_product_material` ON `product_material_mappings` (`product_id`,`material_id`);--> statement-breakpoint
CREATE INDEX `idx_browser_run_pages_rag_uuid` ON `browser_run_pages` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `idx_browser_run_pages_showroom_id` ON `browser_run_pages` (`showroom_id`);--> statement-breakpoint
CREATE INDEX `showroom_photos_mapping_showroom_idx` ON `showroom_photos_mapping` (`showroom_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_hours_showroom_day_unique` ON `showroom_hours` (`showroom_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_product_intel_product_uniq` ON `store_product_intel` (`store_product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_showroom_photos_rag_uuid_uniq` ON `product_showroom_photos` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `product_showroom_photos_product_idx` ON `product_showroom_photos` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_showroom_photos_showroom_idx` ON `product_showroom_photos` (`showroom_id`);--> statement-breakpoint
CREATE INDEX `price_observations_product_idx` ON `product_price_observations` (`product_id`);--> statement-breakpoint
CREATE INDEX `price_observations_showroom_idx` ON `product_price_observations` (`showroom_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_room_idx` ON `wishlist_items` (`room_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_store_product_idx` ON `wishlist_items` (`showroom_store_product_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_material_item_idx` ON `wishlist_items` (`material_schedule_item_id`);--> statement-breakpoint
CREATE INDEX `wishlist_items_status_idx` ON `wishlist_items` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_collection_items_collection_item_unique` ON `wishlist_collection_items` (`collection_id`,`wishlist_item_id`);--> statement-breakpoint
CREATE INDEX `wishlist_collection_items_wishlist_item_idx` ON `wishlist_collection_items` (`wishlist_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_type_mappings_brand_type_uniq` ON `brand_type_mappings` (`brand_id`,`type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_brand_mappings_showroom_brand_uniq` ON `showroom_brand_mappings` (`showroom_id`,`brand_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_intel_brand_uniq` ON `brand_intel` (`brand_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_images_brand_source_unique` ON `brand_images` (`brand_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `brand_images_brand_idx` ON `brand_images` (`brand_id`);--> statement-breakpoint
CREATE INDEX `brand_product_lines_brand_idx` ON `brand_product_lines` (`brand_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `research_job_steps_job_step_uniq` ON `research_job_steps` (`job_id`,`step_key`);--> statement-breakpoint
CREATE INDEX `research_job_steps_job_idx` ON `research_job_steps` (`job_id`);--> statement-breakpoint
CREATE INDEX `research_jobs_status_idx` ON `research_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `research_jobs_entity_idx` ON `research_jobs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_services_name` ON `services` (`name`);--> statement-breakpoint
CREATE INDEX `idx_services_is_archived` ON `services` (`is_archived`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_threads_thread_id_unique` ON `gmail_threads` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_threads_company_id_idx` ON `gmail_threads` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_messages_message_id_unique` ON `gmail_messages` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_messages_rag_uuid_unique` ON `gmail_messages` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `gmail_messages_thread_id_idx` ON `gmail_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_messages_from_recipient_idx` ON `gmail_messages` (`from_recipient`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_email_idx` ON `gmail_message_participants` (`email`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_domain_idx` ON `gmail_message_participants` (`domain`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_thread_id_idx` ON `gmail_message_participants` (`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_message_participants_message_id_idx` ON `gmail_message_participants` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_message_participants_message_email_role_unique` ON `gmail_message_participants` (`message_id`,`email`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `worker_emails_message_id_idx` ON `worker_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `worker_emails_status_idx` ON `worker_emails` (`status`);--> statement-breakpoint
CREATE INDEX `worker_emails_classification_idx` ON `worker_emails` (`classification`);--> statement-breakpoint
CREATE INDEX `worker_emails_route_idx` ON `worker_emails` (`route`);--> statement-breakpoint
CREATE INDEX `worker_emails_created_at_idx` ON `worker_emails` (`created_at`);--> statement-breakpoint
CREATE INDEX `worker_emails_company_idx` ON `worker_emails` (`matched_company_id`);--> statement-breakpoint
CREATE INDEX `worker_email_attachments_email_idx` ON `worker_email_attachments` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_invoices_email_idx` ON `worker_email_invoices` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_invoices_status_idx` ON `worker_email_invoices` (`status`);--> statement-breakpoint
CREATE INDEX `worker_email_invoice_line_items_invoice_idx` ON `worker_email_invoice_line_items` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `worker_email_invoice_line_items_material_idx` ON `worker_email_invoice_line_items` (`material_schedule_item_id`);--> statement-breakpoint
CREATE INDEX `worker_email_staged_companies_email_idx` ON `worker_email_staged_companies` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_staged_companies_status_idx` ON `worker_email_staged_companies` (`status`);--> statement-breakpoint
CREATE INDEX `worker_email_contracts_email_idx` ON `worker_email_contracts` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_contracts_status_idx` ON `worker_email_contracts` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_sessions_last_seen_idx` ON `mcp_sessions` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_session_idx` ON `mcp_tool_invocations` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_tool_name_idx` ON `mcp_tool_invocations` (`tool_name`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_created_at_idx` ON `mcp_tool_invocations` (`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_ok_idx` ON `mcp_tool_invocations` (`ok`);--> statement-breakpoint
CREATE INDEX `mcp_conversations_session_idx` ON `mcp_conversations` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_conversations_created_at_idx` ON `mcp_conversations` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_agent_issues_dedupe_uniq` ON `mcp_agent_issues` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `mcp_agent_issues_status_idx` ON `mcp_agent_issues` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_agent_issues_severity_idx` ON `mcp_agent_issues` (`severity`);--> statement-breakpoint
CREATE INDEX `mcp_feature_requests_status_idx` ON `mcp_feature_requests` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_feature_requests_created_at_idx` ON `mcp_feature_requests` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_slug_uniq` ON `artifacts` (`slug`);--> statement-breakpoint
CREATE INDEX `artifacts_status_idx` ON `artifacts` (`status`);--> statement-breakpoint
CREATE INDEX `artifacts_kind_idx` ON `artifacts` (`kind`);--> statement-breakpoint
CREATE INDEX `artifact_revisions_artifact_idx` ON `artifact_revisions` (`artifact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_lists_slug_uniq` ON `drive_lists` (`slug`);--> statement-breakpoint
CREATE INDEX `drive_lists_status_idx` ON `drive_lists` (`status`);--> statement-breakpoint
CREATE INDEX `drive_lists_created_idx` ON `drive_lists` (`created_at`);--> statement-breakpoint
CREATE INDEX `drive_list_stops_drive_idx` ON `drive_list_stops` (`drive_list_id`);--> statement-breakpoint
CREATE INDEX `drive_list_stops_showroom_idx` ON `drive_list_stops` (`showroom_store_id`);--> statement-breakpoint
CREATE INDEX `subcategories_category_idx` ON `subcategories` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_categories_photo_category_uniq` ON `photo_categories` (`photo_id`,`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_subcategories_photo_subcategory_uniq` ON `photo_subcategories` (`photo_id`,`subcategory_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_colors_photo_color_uniq` ON `photo_colors` (`photo_id`,`color_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_categories_brand_category_uniq` ON `brand_categories` (`brand_id`,`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_categories_product_category_uniq` ON `product_categories` (`product_id`,`category_id`);