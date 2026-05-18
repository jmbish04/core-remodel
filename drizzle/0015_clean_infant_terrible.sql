ALTER TABLE `image_upload_staging` ADD `processing_status` text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE `image_upload_staging` ADD `workflow_instance_id` text;--> statement-breakpoint
ALTER TABLE `image_upload_staging` ADD `processing_error` text;--> statement-breakpoint
ALTER TABLE `image_upload_staging` ADD `datetime_processing_started` integer;--> statement-breakpoint
ALTER TABLE `image_upload_staging` ADD `datetime_processed` integer;