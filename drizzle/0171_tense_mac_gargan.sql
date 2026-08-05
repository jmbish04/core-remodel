CREATE TABLE `showroom_merge_candidate_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`role` text DEFAULT 'BRANCH' NOT NULL,
	`collapse_state` text DEFAULT 'PENDING' NOT NULL,
	`resulting_location_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `showroom_merge_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resulting_location_id`) REFERENCES `showroom_store_locations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_merge_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_key` text NOT NULL,
	`proposed_keeper_store_id` integer,
	`status` text DEFAULT 'TBD' NOT NULL,
	`signals_json` text,
	`evidence_json` text,
	`decided_by_note` text,
	`detected_at` integer DEFAULT (unixepoch()) NOT NULL,
	`decided_at` integer,
	`applied_at` integer,
	FOREIGN KEY (`proposed_keeper_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_merge_exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id_lo` integer NOT NULL,
	`store_id_hi` integer NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id_lo`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id_hi`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_store_locations` ADD `unit` text;--> statement-breakpoint
CREATE INDEX `showroom_merge_candidate_members_candidate_idx` ON `showroom_merge_candidate_members` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `showroom_merge_candidate_members_store_idx` ON `showroom_merge_candidate_members` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_merge_candidate_members_cand_store_uniq` ON `showroom_merge_candidate_members` (`candidate_id`,`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_merge_candidates_group_key_uniq` ON `showroom_merge_candidates` (`group_key`);--> statement-breakpoint
CREATE INDEX `showroom_merge_candidates_status_idx` ON `showroom_merge_candidates` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_merge_exclusions_pair_uniq` ON `showroom_merge_exclusions` (`store_id_lo`,`store_id_hi`);