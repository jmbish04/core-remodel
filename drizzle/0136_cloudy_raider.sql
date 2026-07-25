ALTER TABLE `brand_types_def` ADD `ai_rationale` text;--> statement-breakpoint
ALTER TABLE `brand_type_mappings` ADD `is_primary` integer DEFAULT false NOT NULL;