ALTER TABLE `worker_emails` ADD `route` text;--> statement-breakpoint
ALTER TABLE `worker_emails` ADD `route_reason` text;--> statement-breakpoint
CREATE INDEX `worker_emails_route_idx` ON `worker_emails` (`route`);