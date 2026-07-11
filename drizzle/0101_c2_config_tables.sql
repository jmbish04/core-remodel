CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subcategories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category_id` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subcategories_category_idx` ON `subcategories` (`category_id`);
--> statement-breakpoint
CREATE TABLE `colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`hex_code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photo_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_categories_photo_category_uniq` ON `photo_categories` (`photo_id`,`category_id`);
--> statement-breakpoint
CREATE TABLE `photo_subcategories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`subcategory_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_subcategories_photo_subcategory_uniq` ON `photo_subcategories` (`photo_id`,`subcategory_id`);
--> statement-breakpoint
CREATE TABLE `photo_colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`color_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`color_id`) REFERENCES `colors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_colors_photo_color_uniq` ON `photo_colors` (`photo_id`,`color_id`);
--> statement-breakpoint
CREATE TABLE `brand_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_categories_brand_category_uniq` ON `brand_categories` (`brand_id`,`category_id`);
--> statement-breakpoint
CREATE TABLE `product_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_categories_product_category_uniq` ON `product_categories` (`product_id`,`category_id`);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `description`) VALUES
	('stone', NULL),
	('plumbing', NULL),
	('cabinet', NULL),
	('flooring', NULL),
	('lighting', NULL),
	('tile', NULL),
	('appliance', NULL),
	('other', NULL);
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Marble', `id` FROM `categories` WHERE `name` = 'stone';
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Porcelain', `id` FROM `categories` WHERE `name` = 'stone';
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Quartzite', `id` FROM `categories` WHERE `name` = 'stone';
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Dishwasher', `id` FROM `categories` WHERE `name` = 'appliance';
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Cooktop', `id` FROM `categories` WHERE `name` = 'appliance';
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Microwave', `id` FROM `categories` WHERE `name` = 'appliance';
--> statement-breakpoint
INSERT INTO `subcategories` (`name`, `category_id`)
	SELECT 'Oven', `id` FROM `categories` WHERE `name` = 'appliance';
--> statement-breakpoint
INSERT INTO `colors` (`name`, `hex_code`) VALUES
	('White', '#FFFFFF'),
	('Black', '#000000'),
	('Matte Black', '#28282B'),
	('Chrome', '#C0C0C0'),
	('Brushed Nickel', '#A5A5A5'),
	('Polished Nickel', '#D9D9D9'),
	('Brass', '#B5A642'),
	('Brushed Gold', '#C9B037'),
	('Bronze', '#614E3F'),
	('Stainless', '#E3E4E5'),
	('Gray', '#808080'),
	('Beige', '#E8DCC4'),
	('Navy', '#1F3A5F'),
	('White Oak', '#C9A66B'),
	('Walnut', '#5C4033');
