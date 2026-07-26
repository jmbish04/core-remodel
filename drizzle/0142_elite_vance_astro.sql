-- Only the drive_lists start-capture columns are a real delta here. The
-- generator re-emitted showroom_visit_log / drive_list_notes / drive_list_stops
-- columns because an earlier meta snapshot lagged behind #253/#258, but those
-- objects already exist on remote (verified) — re-creating them would error.
-- Stripped to the true delta; the 0142 snapshot is complete, so future
-- db:generate diffs cleanly against it.
ALTER TABLE `drive_lists` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `drive_lists` ADD `start_latitude` real;--> statement-breakpoint
ALTER TABLE `drive_lists` ADD `start_longitude` real;
