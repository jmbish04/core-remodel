CREATE TABLE `google_oauth_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`refresh_token` text NOT NULL,
	`scope` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
