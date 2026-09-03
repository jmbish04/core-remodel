CREATE INDEX `idx_estimate_line_items_mapping_status_id` ON `estimate_line_items` (`mapping_status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_is_active` ON `contracts` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_contracts_estimate_company_id` ON `contracts` (`estimate_company_id`);--> statement-breakpoint
CREATE INDEX `idx_contracts_linked_estimate_id` ON `contracts` (`linked_estimate_id`);--> statement-breakpoint
CREATE INDEX `idx_bee_active_track_date` ON `budget_expense_entries` (`is_active`,`budget_item_track_id`,`date_incurred`);--> statement-breakpoint
CREATE INDEX `idx_bee_active_room` ON `budget_expense_entries` (`is_active`,`room_id`);--> statement-breakpoint
CREATE INDEX `idx_btir_room` ON `budget_tracker_item_rooms` (`room_id`);--> statement-breakpoint
CREATE INDEX `idx_bti_active_phase` ON `budget_tracker_items` (`is_active`,`phase_id`);--> statement-breakpoint
CREATE INDEX `idx_budget_reallocation_ledger_occurred_at_id` ON `budget_reallocation_ledger` (`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_budget_phases_active_sort` ON `budget_phases` (`is_active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_budget_plan_schedule_period` ON `budget_plan_schedule` (`period`);