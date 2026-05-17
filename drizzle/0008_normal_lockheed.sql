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
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_revision_id`) REFERENCES `estimate_revisions`(`id`) ON UPDATE no action ON DELETE cascade
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
CREATE UNIQUE INDEX `estimate_prop_key_types_property_unique` ON `estimate_prop_key_types` (`property`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_statuses_name_unique` ON `estimate_statuses` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `contract_statuses_name_unique` ON `contract_statuses` (`name`);