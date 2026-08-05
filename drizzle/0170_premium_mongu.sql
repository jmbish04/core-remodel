-- 0170 (manual rebuild). SQLite/D1 cannot ALTER a column's type or add a foreign
-- key to an existing column, so drizzle-kit emits no statements for these two
-- changes. Both target tables are NEW in 0043 and EMPTY (verified on remote:
-- room_problem_photos = 0 rows, decisions = 0 rows, before writing this), so a
-- DROP + CREATE with the correction is a safe rebuild with no data to preserve.
-- The 0170 snapshot drizzle generated already reflects the corrected schema.

-- room_problem_photos.image_id: text -> integer (images.id is an integer PK; a
-- text FK never matches on JOIN and is not enforced).
DROP TABLE IF EXISTS `room_problem_photos`;--> statement-breakpoint
CREATE TABLE `room_problem_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_problem_id` integer NOT NULL,
	`room_problem_fix_id` integer,
	`photo_type` text DEFAULT 'PROBLEM' NOT NULL,
	`image_id` integer,
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
);--> statement-breakpoint
CREATE INDEX `room_problem_photos_problem_idx` ON `room_problem_photos` (`room_problem_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_problem_photos_primary_uniq` ON `room_problem_photos` (`room_problem_id`) WHERE "room_problem_photos"."is_primary" = 1;--> statement-breakpoint
-- decisions.parent_decision_id: add the self-referencing FK -> decisions(id),
-- ON DELETE set null (removing a parent re-roots its children).
DROP TABLE IF EXISTS `decisions`;--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`room_id` integer,
	`title` text NOT NULL,
	`body_markdown` text,
	`body_html` text,
	`governing_intent` text,
	`parent_decision_id` integer,
	`status` text DEFAULT 'proposed' NOT NULL,
	`decided_by` text,
	`reconsider_if` text,
	`decided_at` integer,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `decisions_project_idx` ON `decisions` (`project_id`);--> statement-breakpoint
CREATE INDEX `decisions_room_status_idx` ON `decisions` (`room_id`,`status`);--> statement-breakpoint
CREATE INDEX `decisions_parent_idx` ON `decisions` (`parent_decision_id`);
