CREATE TABLE `drive_list_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_list_id` integer NOT NULL,
	`drive_list_stop_id` integer,
	`body` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`drive_list_id`) REFERENCES `drive_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drive_list_stop_id`) REFERENCES `drive_list_stops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `drive_list_stops` ADD `kind` text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE `drive_list_stops` ADD `suggested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drive_list_stops` ADD `skipped` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drive_list_stops` ADD `skipped_at` integer;--> statement-breakpoint
CREATE INDEX `drive_list_notes_drive_idx` ON `drive_list_notes` (`drive_list_id`);--> statement-breakpoint
CREATE INDEX `drive_list_notes_stop_idx` ON `drive_list_notes` (`drive_list_stop_id`);--> statement-breakpoint
-- Backfill `kind` from the legacy `is_optional` flag (core stays default 'core').
UPDATE `drive_list_stops` SET `kind` = 'optional' WHERE `is_optional` = 1;--> statement-breakpoint
-- Migrate legacy drive-global notes (JSON array in drive_lists.notes) into rows.
INSERT INTO `drive_list_notes` (`drive_list_id`, `body`, `source`, `created_at`)
  SELECT dl.`id`, trim(je.value), 'user', unixepoch()
  FROM `drive_lists` dl, json_each(dl.`notes`) je
  WHERE dl.`notes` IS NOT NULL AND json_valid(dl.`notes`) = 1
    AND json_type(dl.`notes`) = 'array' AND trim(je.value) <> '';--> statement-breakpoint
-- Legacy rows that stored a single non-JSON chunk become one note each.
INSERT INTO `drive_list_notes` (`drive_list_id`, `body`, `source`, `created_at`)
  SELECT dl.`id`, trim(dl.`notes`), 'user', unixepoch()
  FROM `drive_lists` dl
  WHERE dl.`notes` IS NOT NULL AND trim(dl.`notes`) <> ''
    AND (json_valid(dl.`notes`) = 0 OR json_type(dl.`notes`) <> 'array');--> statement-breakpoint
-- Decode HTML entities that leaked into display text from MCP-created drives
-- (e.g. "Wall &amp; Floor" -> "Wall & Floor"). &amp; is decoded LAST so a
-- double-encoded "&amp;lt;" resolves correctly. Slugs are left as-is (stable URLs).
UPDATE `drive_lists` SET
  `title` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`title`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&'),
  `description` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`description`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&')
  WHERE `title` LIKE '%&%;%' OR `description` LIKE '%&%;%';--> statement-breakpoint
UPDATE `drive_list_stops` SET
  `name` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`name`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&'),
  `city` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`city`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&'),
  `address` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`address`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&'),
  `note` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`note`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&'),
  `pick` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`pick`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&')
  WHERE `name` LIKE '%&%;%' OR `city` LIKE '%&%;%' OR `address` LIKE '%&%;%' OR `note` LIKE '%&%;%' OR `pick` LIKE '%&%;%';--> statement-breakpoint
UPDATE `drive_list_notes` SET
  `body` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`body`,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&#39;',''''),'&amp;','&')
  WHERE `body` LIKE '%&%;%';