ALTER TABLE `worker_emails` ADD `source` text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `ai_status` text DEFAULT 'auto_done' NOT NULL;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `ai_approved_at` integer;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `ai_approved_by` text;--> statement-breakpoint
ALTER TABLE `worker_email_attachments` ADD `extracted_text` text;--> statement-breakpoint
ALTER TABLE `worker_email_attachments` ADD `ocr_status` text DEFAULT 'none' NOT NULL;