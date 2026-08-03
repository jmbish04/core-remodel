CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`project_type` text DEFAULT 'lifestyle_change' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `room_stop_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`stop` text NOT NULL,
	`entered_by` text,
	`reason` text,
	`entered_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `spec_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`value_kind` text DEFAULT 'text' NOT NULL,
	`choice_options` text,
	`is_required_for_threshold` integer DEFAULT false NOT NULL,
	`applies_to_room_kinds` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `room_spec_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`spec_definition_id` integer NOT NULL,
	`product_id` integer,
	`material_id` integer,
	`value_text` text,
	`value_cents` integer,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`waived_reason` text,
	`provenance_actor` text,
	`provenance_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spec_definition_id`) REFERENCES `spec_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`room_id` integer,
	`title` text NOT NULL,
	`body_markdown` text,
	`body_html` text,
	`governing_intent` text,
	`parent_decision_id` integer,
	`status` text DEFAULT 'proposed' NOT NULL,
	`decided_by` text,
	`reconsider_if` text,
	`decided_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_reopenings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`cause_kind` text NOT NULL,
	`cause_id` integer,
	`reason_at_time` text NOT NULL,
	`recorded_by` text,
	`occurred_at` integer,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `impact_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`description` text,
	`risk_inputs` text,
	`default_severity` integer DEFAULT 50 NOT NULL,
	`requires_actor_party` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `impacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`definition_id` integer NOT NULL,
	`title` text NOT NULL,
	`detail_markdown` text,
	`detail_html` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text NOT NULL,
	`actor_party_kind` text,
	`actor_company_id` integer,
	`actor_party_id` integer,
	`confidence` integer,
	`cost_exposure_cents` integer,
	`cost_exposure_text` text,
	`days_exposure` integer,
	`provenance_actor` text,
	`provenance_at` integer,
	`resolved_at` integer,
	`resolution_note` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`definition_id`) REFERENCES `impact_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `impact_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`impact_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`effect` text NOT NULL,
	`note` text,
	`source` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `impact_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`blocking_impact_id` integer NOT NULL,
	`blocked_impact_id` integer NOT NULL,
	`note` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`blocking_impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `impact_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`impact_id` integer NOT NULL,
	`kind` text NOT NULL,
	`document_id` integer,
	`image_id` integer,
	`external_ref` text,
	`body_markdown` text,
	`body_html` text,
	`recorded_by` text,
	`occurred_at` integer,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ripple_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`trigger_name` text NOT NULL,
	`trigger_match` text NOT NULL,
	`consequences` text NOT NULL,
	`rationale` text,
	`strength` text DEFAULT 'usually' NOT NULL,
	`jurisdiction` text,
	`rule_kind` text DEFAULT 'physical_ripple' NOT NULL,
	`resolution` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
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
	`area_sq_ft_override` real,
	`area_sq_ft_override_notes` text,
	`area_sq_ft_override_calculation` text,
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
CREATE TABLE `room_note_type_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_note_id` integer NOT NULL,
	`room_note_type_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_note_id`) REFERENCES `room_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_note_type_id`) REFERENCES `room_note_type_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`note_markdown` text,
	`note_html` text,
	`note_plaintext` text,
	`author` text,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`intent_type_id` integer NOT NULL,
	`caused_by_impact_id` integer,
	`status` text DEFAULT 'proposed' NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intent_type_id`) REFERENCES `room_intent_type_def`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`caused_by_impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `room_problem_document_type_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_problem_document_id` integer NOT NULL,
	`room_problem_document_type_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_problem_document_id`) REFERENCES `room_problem_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_problem_document_type_id`) REFERENCES `room_problem_document_type_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_problem_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_problem_id` integer NOT NULL,
	`room_problem_fix_id` integer,
	`document_type` text DEFAULT 'PROBLEM' NOT NULL,
	`rag_uuid` text,
	`r2_key` text,
	`sha_hash` text,
	`doc_text` text,
	`ai_summary` text,
	`doc_title` text,
	`filename` text,
	`mimetype` text,
	`filesize` integer,
	`ocr_status` text DEFAULT 'pending' NOT NULL,
	`extracted_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_problem_id`) REFERENCES `room_problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_problem_fix_id`) REFERENCES `room_problem_fix_def`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `room_problem_fix_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_problem_id` integer NOT NULL,
	`room_problem_fix_id` integer NOT NULL,
	`company_id` integer,
	`estimated_cost_text` text,
	`estimated_cost_cents` integer,
	`notes_markdown` text,
	`notes_html` text,
	`notes_plaintext` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_problem_id`) REFERENCES `room_problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_problem_fix_id`) REFERENCES `room_problem_fix_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `room_problem_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_problem_id` integer NOT NULL,
	`room_problem_fix_id` integer,
	`photo_type` text DEFAULT 'PROBLEM' NOT NULL,
	`image_id` text,
	`name` text,
	`description_markdown` text,
	`description_html` text,
	`description_plaintext` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`taken_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_problem_id`) REFERENCES `room_problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_problem_fix_id`) REFERENCES `room_problem_fix_def`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `room_problem_type_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_problem_id` integer NOT NULL,
	`room_problem_type_id` integer NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_problem_id`) REFERENCES `room_problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_problem_type_id`) REFERENCES `room_problem_type_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_problems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`overview_markdown` text,
	`overview_html` text,
	`overview_plaintext` text,
	`severity` text DEFAULT 'minor' NOT NULL,
	`is_safety_hazard` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'suspected' NOT NULL,
	`impact_id` integer,
	`discovered_during` text,
	`discovered_at` integer,
	`resolved_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`impact_id`) REFERENCES `impacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
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
CREATE TABLE `room_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`event_kind` text NOT NULL,
	`subject_kind` text,
	`subject_id` integer,
	`summary` text,
	`actor` text,
	`occurred_at` integer,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_permit_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`permit_id` text NOT NULL,
	`scope_notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permit_id`) REFERENCES `permits_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_trade_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`trade_type_id` integer,
	`scope_notes_markdown` text,
	`scope_notes_html` text,
	`scope_notes_plaintext` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_type_id`) REFERENCES `business_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `floors` ADD `is_physical` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `line_color_hex` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `line_order` integer;--> statement-breakpoint
ALTER TABLE `material_schedule_items` ADD `material_type_id` integer REFERENCES material_type_def(id);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `room_stop_state_room_entered_idx` ON `room_stop_state` (`room_id`,`entered_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `spec_definitions_key_unique` ON `spec_definitions` (`key`);--> statement-breakpoint
CREATE INDEX `room_spec_fields_room_idx` ON `room_spec_fields` (`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_spec_fields_room_definition_unique` ON `room_spec_fields` (`room_id`,`spec_definition_id`);--> statement-breakpoint
CREATE INDEX `decisions_project_idx` ON `decisions` (`project_id`);--> statement-breakpoint
CREATE INDEX `decisions_room_status_idx` ON `decisions` (`room_id`,`status`);--> statement-breakpoint
CREATE INDEX `decisions_parent_idx` ON `decisions` (`parent_decision_id`);--> statement-breakpoint
CREATE INDEX `decision_reopenings_decision_idx` ON `decision_reopenings` (`decision_id`);--> statement-breakpoint
CREATE INDEX `decision_reopenings_cause_idx` ON `decision_reopenings` (`cause_kind`,`cause_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_definitions_key_unique` ON `impact_definitions` (`key`);--> statement-breakpoint
CREATE INDEX `impacts_project_status_idx` ON `impacts` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `impacts_definition_idx` ON `impacts` (`definition_id`);--> statement-breakpoint
CREATE INDEX `impacts_actor_company_idx` ON `impacts` (`actor_company_id`);--> statement-breakpoint
CREATE INDEX `impact_targets_target_idx` ON `impact_targets` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `impact_targets_impact_idx` ON `impact_targets` (`impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_targets_impact_target_effect_unique` ON `impact_targets` (`impact_id`,`target_kind`,`target_id`,`effect`);--> statement-breakpoint
CREATE INDEX `impact_blocks_blocked_idx` ON `impact_blocks` (`blocked_impact_id`);--> statement-breakpoint
CREATE INDEX `impact_blocks_blocking_idx` ON `impact_blocks` (`blocking_impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `impact_blocks_edge_unique` ON `impact_blocks` (`blocking_impact_id`,`blocked_impact_id`);--> statement-breakpoint
CREATE INDEX `impact_evidence_impact_idx` ON `impact_evidence` (`impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ripple_rules_key_unique` ON `ripple_rules` (`key`);--> statement-breakpoint
CREATE INDEX `ripple_rules_active_idx` ON `ripple_rules` (`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_note_type_def_key_unique` ON `room_note_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_type_def_key_unique` ON `room_problem_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_fix_def_key_unique` ON `room_problem_fix_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_document_type_def_key_unique` ON `room_problem_document_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_use_def_key_unique` ON `room_use_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_type_def_key_unique` ON `room_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_intent_type_def_key_unique` ON `room_intent_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_type_def_key_unique` ON `material_type_def` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_type_room_type_mapping_material_room_uniq` ON `material_type_room_type_mapping` (`material_type_id`,`room_type_id`);--> statement-breakpoint
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
CREATE INDEX `room_measurements_scenario_idx` ON `room_measurements` (`scenario_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_note_type_mapping_note_type_uniq` ON `room_note_type_mapping` (`room_note_id`,`room_note_type_id`);--> statement-breakpoint
CREATE INDEX `room_note_type_mapping_type_idx` ON `room_note_type_mapping` (`room_note_type_id`);--> statement-breakpoint
CREATE INDEX `room_notes_room_idx` ON `room_notes` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_intents_room_idx` ON `room_intents` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_intents_project_idx` ON `room_intents` (`project_id`);--> statement-breakpoint
CREATE INDEX `room_intents_cause_idx` ON `room_intents` (`caused_by_impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_document_type_mapping_doc_type_uniq` ON `room_problem_document_type_mapping` (`room_problem_document_id`,`room_problem_document_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_documents_sha_hash_unique` ON `room_problem_documents` (`sha_hash`);--> statement-breakpoint
CREATE INDEX `room_problem_documents_problem_idx` ON `room_problem_documents` (`room_problem_id`);--> statement-breakpoint
CREATE INDEX `room_problem_fix_mapping_problem_idx` ON `room_problem_fix_mapping` (`room_problem_id`);--> statement-breakpoint
CREATE INDEX `room_problem_photos_problem_idx` ON `room_problem_photos` (`room_problem_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_photos_primary_uniq` ON `room_problem_photos` (`room_problem_id`) WHERE "room_problem_photos"."is_primary" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_type_mapping_problem_type_uniq` ON `room_problem_type_mapping` (`room_problem_id`,`room_problem_type_id`);--> statement-breakpoint
CREATE INDEX `room_problems_room_status_idx` ON `room_problems` (`room_id`,`status`);--> statement-breakpoint
CREATE INDEX `room_problems_impact_idx` ON `room_problems` (`impact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assembly_layer_kind_def_key_unique` ON `assembly_layer_kind_def` (`key`);--> statement-breakpoint
CREATE INDEX `assembly_layers_assembly_idx` ON `assembly_layers` (`assembly_id`,`position`);--> statement-breakpoint
CREATE INDEX `fixture_requirements_fixture_idx` ON `fixture_requirements` (`fixture_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fixture_type_def_key_unique` ON `fixture_type_def` (`key`);--> statement-breakpoint
CREATE INDEX `surface_assemblies_surface_idx` ON `surface_assemblies` (`surface_kind`,`surface_id`);--> statement-breakpoint
CREATE INDEX `surface_fixtures_surface_idx` ON `surface_fixtures` (`surface_kind`,`surface_id`);--> statement-breakpoint
CREATE INDEX `surface_fixtures_type_idx` ON `surface_fixtures` (`fixture_type_id`);--> statement-breakpoint
CREATE INDEX `room_events_room_occurred_idx` ON `room_events` (`room_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `room_events_subject_idx` ON `room_events` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `room_permit_mapping_room_idx` ON `room_permit_mapping` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_permit_mapping_permit_idx` ON `room_permit_mapping` (`permit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_permit_mapping_room_permit_uniq` ON `room_permit_mapping` (`room_id`,`permit_id`);--> statement-breakpoint
CREATE INDEX `room_trade_assignments_room_idx` ON `room_trade_assignments` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_trade_assignments_company_idx` ON `room_trade_assignments` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_trade_assignments_room_company_trade_uniq` ON `room_trade_assignments` (`room_id`,`company_id`,`trade_type_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `rooms` DROP COLUMN `area_sq_ft`;