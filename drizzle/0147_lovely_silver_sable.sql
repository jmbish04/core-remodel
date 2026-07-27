ALTER TABLE `showroom_visit_log` ADD `visit_type` text DEFAULT 'SOFT_ARRIVAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_visit_log` ADD `match_distance_m` real;--> statement-breakpoint
ALTER TABLE `showroom_visit_log` ADD `provenance_json` text;