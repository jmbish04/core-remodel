CREATE TABLE `gmail_message_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gmail_message_id` integer NOT NULL,
	`rag_uuid` text NOT NULL,
	`file_name` text,
	`file_ext` text,
	`file_mimetype` text,
	`file_size_bytes` integer,
	`md5` text,
	`r2_key` text,
	`ocr_text` text,
	`ai_summary` text,
	`ai_confidence` real,
	`ai_metadata` text,
	`remodel_doc_type` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`gmail_message_id`) REFERENCES `gmail_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `gmail_messages` ADD `body_plain_txt` text;--> statement-breakpoint
ALTER TABLE `gmail_messages` ADD `body_html` text;--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `recipient_type` text;--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `showroom_store_id` integer REFERENCES showroom_stores(id);--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `showroom_store_contact_id` integer REFERENCES showroom_store_contacts(id);--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `contractor_business_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `gmail_message_participants` ADD `contractor_business_contact_id` integer REFERENCES company_contacts(id);--> statement-breakpoint
CREATE INDEX `gmail_message_attachments_message_id_idx` ON `gmail_message_attachments` (`gmail_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_message_attachments_rag_uuid_unique` ON `gmail_message_attachments` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `gmail_message_attachments_doc_type_idx` ON `gmail_message_attachments` (`remodel_doc_type`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/