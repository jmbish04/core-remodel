ALTER TABLE `gmail_messages` ADD `read_at` integer;--> statement-breakpoint
-- 0040 P4: existing messages are treated as already-read so the showroom inbox
-- badge only ever reflects NEW mail. New ingests leave read_at NULL (unread).
UPDATE `gmail_messages` SET `read_at` = `created_at` WHERE `read_at` IS NULL;
