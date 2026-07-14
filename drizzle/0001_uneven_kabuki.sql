ALTER TABLE `worker_email_invoice_line_items` ADD `service_id` integer REFERENCES services(id);--> statement-breakpoint
ALTER TABLE `worker_email_contracts` ADD `service_id` integer REFERENCES services(id);--> statement-breakpoint
CREATE INDEX `worker_email_invoice_line_items_service_idx` ON `worker_email_invoice_line_items` (`service_id`);--> statement-breakpoint
CREATE INDEX `worker_email_contracts_service_idx` ON `worker_email_contracts` (`service_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/