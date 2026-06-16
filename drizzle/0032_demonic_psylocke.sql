ALTER TABLE `permits_records` ADD `filed_date` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `license_number` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `sf_business_license_number` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `firm_name` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `firm_address` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `role` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `anchor_permit_identifiers` text;--> statement-breakpoint
ALTER TABLE `permits_contacts` ADD `anchor_reference_filed_date` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `trade` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `filed_date` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `block` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `lot` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `is_open` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `is_recently_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `relation_to_anchor` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `recent_activity_type` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `recent_activity_date` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `recent_activity_detail` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `match_strategy` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `match_confidence` text;--> statement-breakpoint
ALTER TABLE `permits_contact_activity` ADD `anchor_permit_identifier` text;--> statement-breakpoint
ALTER TABLE `permits_contact_insights` ADD `before_busyness` text;--> statement-breakpoint
ALTER TABLE `permits_contact_insights` ADD `after_busyness` text;