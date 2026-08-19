-- 0042 P5 review: drop the denormalized brand_id from invoice line items.
-- Brand derives from products.brandId (JOIN); never duplicated onto the line.
-- Native SQLite/D1 DROP COLUMN — no table rebuild, so the material_room_proposals
-- FK on this table is untouched (no cascade).
ALTER TABLE `worker_email_invoice_line_items` DROP COLUMN `brand_id`;
