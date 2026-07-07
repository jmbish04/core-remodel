CREATE TABLE `company_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `company_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`status` text DEFAULT 'open' NOT NULL,
	`due_date` integer,
	`owner` text,
	`tags_json` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_company_notes_company_id` ON `company_notes` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_company_todos_company_id` ON `company_todos` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_company_todos_company_id_status` ON `company_todos` (`company_id`,`status`);