CREATE TABLE `drive_use_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drive_roots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_folder_id` text NOT NULL,
	`label` text NOT NULL,
	`use_case_id` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_scanned_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`use_case_id`) REFERENCES `drive_use_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `drive_root_exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`root_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `drive_roots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drive_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_id` text NOT NULL,
	`root_id` integer NOT NULL,
	`parent_folder_id` integer,
	`name` text NOT NULL,
	`web_view_url` text NOT NULL,
	`sharing` text DEFAULT 'PRIVATE' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`superseded_by_id` integer,
	`drive_modified_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `drive_roots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `drive_folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`superseded_by_id`) REFERENCES `drive_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `drive_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_id` text NOT NULL,
	`root_id` integer NOT NULL,
	`folder_id` integer NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer,
	`content_hash` text NOT NULL,
	`hash_source` text NOT NULL,
	`web_view_url` text NOT NULL,
	`sharing` text DEFAULT 'PRIVATE' NOT NULL,
	`drive_modified_at` integer,
	`drive_created_at` integer,
	`extracted_text` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_error` text,
	`rag_uuid` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`superseded_by_id` integer,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `drive_roots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `drive_folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`superseded_by_id`) REFERENCES `drive_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `drive_document_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_document_id` integer NOT NULL,
	`supporting_document_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`drive_document_id`) REFERENCES `drive_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supporting_document_id`) REFERENCES `supporting_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_use_cases_key_unique` ON `drive_use_cases` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_roots_drive_folder_id_unique` ON `drive_roots` (`drive_folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_root_exclusion_unique` ON `drive_root_exclusions` (`root_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `drive_folders_root_active_idx` ON `drive_folders` (`root_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `drive_folders_drive_id_idx` ON `drive_folders` (`drive_id`);--> statement-breakpoint
CREATE INDEX `drive_documents_root_active_idx` ON `drive_documents` (`root_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `drive_documents_folder_idx` ON `drive_documents` (`folder_id`);--> statement-breakpoint
CREATE INDEX `drive_documents_drive_id_idx` ON `drive_documents` (`drive_id`);--> statement-breakpoint
CREATE INDEX `drive_documents_content_hash_idx` ON `drive_documents` (`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_document_link_unique` ON `drive_document_links` (`drive_document_id`,`supporting_document_id`);