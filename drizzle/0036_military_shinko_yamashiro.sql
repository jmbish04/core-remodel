CREATE TABLE `dialer_prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`rank` integer NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`full_name` text NOT NULL,
	`firm` text,
	`roles` text NOT NULL,
	`permit_count` integer NOT NULL,
	`avg_cost` integer,
	`median_cost` integer,
	`scope_keywords` text,
	`is_unbundled_candidate` integer DEFAULT false NOT NULL,
	`collision_risk` integer DEFAULT false NOT NULL,
	`phone` text,
	`phone_source` text,
	`email` text,
	`email_source` text,
	`website` text,
	`contact_status` text DEFAULT 'needs_research' NOT NULL,
	`license_note` text,
	`call_script` text NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dialer_call_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prospect_id` text NOT NULL,
	`outcome` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dialer_prospect_state` (
	`prospect_id` text PRIMARY KEY NOT NULL,
	`disposition` text DEFAULT 'not_called' NOT NULL,
	`rating` integer,
	`favorite` integer DEFAULT false NOT NULL,
	`left_voicemail` integer DEFAULT false NOT NULL,
	`available_to_hire` integer,
	`good_feeling` integer,
	`notes` text,
	`call_count` integer DEFAULT 0 NOT NULL,
	`emailed_at` text,
	`last_contacted_at` text,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
