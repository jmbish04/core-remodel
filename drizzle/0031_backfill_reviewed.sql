-- Backfill reviewed=true for photos that already have review notes saved.
UPDATE "image_reviews" SET "reviewed" = 1 WHERE "note" IS NOT NULL AND "note" != '';
