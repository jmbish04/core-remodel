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
ALTER TABLE `supporting_documents` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `supporting_documents` ADD `extracted_text` text;--> statement-breakpoint
ALTER TABLE `supporting_documents` ADD `extraction_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `supporting_documents` ADD `doc_type` text;--> statement-breakpoint
CREATE UNIQUE INDEX `document_entity_associations_unique` ON `document_entity_associations` (`document_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `document_entity_associations_entity_idx` ON `document_entity_associations` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_saved_views_slug_unique` ON `document_saved_views` (`slug`);