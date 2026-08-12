CREATE TABLE `email_instructions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instructions_markdown` text DEFAULT '' NOT NULL,
	`instructions_html` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
