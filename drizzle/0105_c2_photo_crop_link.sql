-- Phase 4 masking: link a crop child photo back to the wide source photo it
-- was cropped from. Additive ADD COLUMN only — no table rebuild.
ALTER TABLE `product_showroom_photos` ADD COLUMN `parent_photo_id` integer REFERENCES product_showroom_photos(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `product_showroom_photos` ADD COLUMN `crop_region` text;
--> statement-breakpoint
CREATE INDEX `product_showroom_photos_parent_idx` ON `product_showroom_photos` (`parent_photo_id`);
