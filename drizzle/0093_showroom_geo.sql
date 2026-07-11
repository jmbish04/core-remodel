ALTER TABLE `showroom_stores` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `hub_route` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `hub_name` text;--> statement-breakpoint
UPDATE `showroom_stores`
SET
  `hub_route` = (
    SELECT `c`.`hub_route` FROM `store_bayarea_cities` `c`
    WHERE `c`.`id` = `showroom_stores`.`bay_area_city_id`
  ),
  `hub_name` = (
    SELECT `c`.`hub_name` FROM `store_bayarea_cities` `c`
    WHERE `c`.`id` = `showroom_stores`.`bay_area_city_id`
  )
WHERE `bay_area_city_id` IS NOT NULL AND `hub_route` IS NULL;
