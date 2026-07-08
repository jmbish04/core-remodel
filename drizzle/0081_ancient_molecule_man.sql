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
ALTER TABLE `worker_emails` ADD `is_forwarded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `original_from_address` text;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `original_from_name` text;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `original_date` text;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `matched_company_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `company_match_confidence` real;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `company_match_method` text;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `ai_reviewer_flags` text;--> statement-breakpoint
CREATE INDEX `worker_email_staged_companies_email_idx` ON `worker_email_staged_companies` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_staged_companies_status_idx` ON `worker_email_staged_companies` (`status`);--> statement-breakpoint
CREATE INDEX `worker_email_contracts_email_idx` ON `worker_email_contracts` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_contracts_status_idx` ON `worker_email_contracts` (`status`);--> statement-breakpoint
CREATE INDEX `worker_emails_company_idx` ON `worker_emails` (`matched_company_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/