ALTER TABLE `ripple_rules` ADD `rule_kind` text DEFAULT 'physical_ripple' NOT NULL;--> statement-breakpoint
ALTER TABLE `ripple_rules` ADD `resolution` text;