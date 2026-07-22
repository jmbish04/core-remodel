CREATE TABLE `model_pricing` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`display_name` text,
	`input_per_million_usd` real,
	`output_per_million_usd` real,
	`cached_input_per_million_usd` real,
	`unit` text DEFAULT 'tokens' NOT NULL,
	`source_url` text,
	`source_note` text,
	`is_active` integer DEFAULT true NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_fetch_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`models_found` integer DEFAULT 0 NOT NULL,
	`models_changed` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`duration_ms` integer,
	`at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_pricing_provider_model_uniq` ON `model_pricing` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `model_pricing_provider_idx` ON `model_pricing` (`provider`);--> statement-breakpoint
CREATE INDEX `pricing_fetch_runs_provider_at_idx` ON `pricing_fetch_runs` (`provider`,`at`);