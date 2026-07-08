CREATE TABLE `worker_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text,
	`body_text` text,
	`body_html` text,
	`raw_headers` text,
	`classification` text,
	`classification_confidence` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_notes` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
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
CREATE UNIQUE INDEX `worker_emails_message_id_idx` ON `worker_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `worker_emails_status_idx` ON `worker_emails` (`status`);--> statement-breakpoint
CREATE INDEX `worker_emails_classification_idx` ON `worker_emails` (`classification`);--> statement-breakpoint
CREATE INDEX `worker_emails_created_at_idx` ON `worker_emails` (`created_at`);--> statement-breakpoint
CREATE INDEX `worker_email_attachments_email_idx` ON `worker_email_attachments` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_invoices_email_idx` ON `worker_email_invoices` (`email_id`);--> statement-breakpoint
CREATE INDEX `worker_email_invoices_status_idx` ON `worker_email_invoices` (`status`);--> statement-breakpoint
CREATE INDEX `worker_email_invoice_line_items_invoice_idx` ON `worker_email_invoice_line_items` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `worker_email_invoice_line_items_material_idx` ON `worker_email_invoice_line_items` (`material_schedule_item_id`);