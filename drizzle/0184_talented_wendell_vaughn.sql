CREATE TABLE `estimate_line_room_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`estimate_line_item_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`verdict` text NOT NULL,
	`reasoning_markdown` text,
	`reasoning_html` text,
	`evidence_json` text,
	`confidence` real,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`estimate_line_item_id`) REFERENCES `estimate_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_compliance_gates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`gate_type` text NOT NULL,
	`state` text NOT NULL,
	`evidence_markdown` text,
	`evidence_html` text,
	`evaluated_at` integer,
	`expires_at` integer,
	`source_ref` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	`datetime_updated` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budget_reallocation_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` integer NOT NULL,
	`event_title` text NOT NULL,
	`event_detail` text,
	`from_account_id` integer,
	`to_account_id` integer,
	`from_room_id` integer,
	`to_room_id` integer,
	`amount_cents` integer NOT NULL,
	`amount_text` text,
	`reference_type` text,
	`reference_id` text,
	`created_by` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`from_account_id`) REFERENCES `budget_funding_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_account_id`) REFERENCES `budget_funding_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `estimate_companies` ADD `license_expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_estimate_line_room_candidates_line_room` ON `estimate_line_room_candidates` (`estimate_line_item_id`,`room_id`);--> statement-breakpoint
CREATE INDEX `idx_estimate_line_room_candidates_line_rank` ON `estimate_line_room_candidates` (`estimate_line_item_id`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_contract_compliance_gates_contract_type` ON `contract_compliance_gates` (`contract_id`,`gate_type`);--> statement-breakpoint
CREATE INDEX `idx_contract_compliance_gates_contract_state` ON `contract_compliance_gates` (`contract_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_budget_reallocation_ledger_occurred_at` ON `budget_reallocation_ledger` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_budget_reallocation_ledger_from_account` ON `budget_reallocation_ledger` (`from_account_id`);--> statement-breakpoint
CREATE INDEX `idx_budget_reallocation_ledger_to_account` ON `budget_reallocation_ledger` (`to_account_id`);