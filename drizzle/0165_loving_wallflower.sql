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
CREATE INDEX `room_problems_impact_idx` ON `room_problems` (`impact_id`);