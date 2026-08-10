ALTER TABLE `drive_roots` ADD `scan_started_at` integer;--> statement-breakpoint
CREATE INDEX `drive_folders_superseded_by_idx` ON `drive_folders` (`superseded_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_folders_active_drive_id_uidx` ON `drive_folders` (`root_id`,`drive_id`) WHERE "drive_folders"."is_active" = 1;--> statement-breakpoint
CREATE INDEX `drive_documents_superseded_by_idx` ON `drive_documents` (`superseded_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_documents_active_drive_id_uidx` ON `drive_documents` (`root_id`,`drive_id`) WHERE "drive_documents"."is_active" = 1;