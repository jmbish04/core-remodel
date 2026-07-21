-- Keep `brands.name` permanently equal to the is_primary row in
-- `brand_name_variations`, in BOTH directions, enforced by the database.
--
-- WHY TRIGGERS AND NOT APPLICATION CODE: `brands.name` is read by 36 call sites
-- across 15 files. Rewriting every one to join the variations table is a large
-- diff whose only effect is to read the same string a slower way — and it still
-- leaves the 37th call site, written next month, free to diverge. Making the
-- column a database-maintained projection of the primary variation means every
-- existing reader is correct by construction and stays correct.
--
-- It also unblocks dropping the column later without a flag day: readers can be
-- migrated to `primaryName` at leisure, because both sources are guaranteed
-- identical in the meantime.
--
-- Triggers are hand-written because drizzle-kit cannot express them; the
-- accompanying 0117 snapshot is a copy of 0116 (triggers do not appear in
-- drizzle snapshots) so the migration chain stays linear and `db:generate`
-- keeps working.
--
-- NOTE ON RECURSION: SQLite runs with `recursive_triggers` OFF by default, so
-- statements inside a trigger body do not fire further triggers. The guards
-- below (`IS NOT`) are belt-and-braces and also avoid pointless writes.

-- 1. A new primary variation renames the brand.
CREATE TRIGGER IF NOT EXISTS brand_name_sync_from_variation_insert
AFTER INSERT ON brand_name_variations
WHEN NEW.is_primary = 1
BEGIN
  UPDATE brands
     SET name = NEW.brand_name
   WHERE id = NEW.brand_id
     AND name IS NOT NEW.brand_name;
END;
--> statement-breakpoint

-- 2. Promoting/renaming an existing variation renames the brand. This is what
--    makes "fix the display name" a toggle: flip is_primary, the brand follows.
CREATE TRIGGER IF NOT EXISTS brand_name_sync_from_variation_update
AFTER UPDATE ON brand_name_variations
WHEN NEW.is_primary = 1
BEGIN
  UPDATE brands
     SET name = NEW.brand_name
   WHERE id = NEW.brand_id
     AND name IS NOT NEW.brand_name;
END;
--> statement-breakpoint

-- 3. Every brand row gets a primary variation, whatever inserted it. Covers all
--    9 existing insert paths and any future one, so a brand can never exist
--    without a resolvable name.
CREATE TRIGGER IF NOT EXISTS brand_seed_primary_variation
AFTER INSERT ON brands
WHEN trim(COALESCE(NEW.name, '')) != ''
BEGIN
  INSERT OR IGNORE INTO brand_name_variations
    (brand_id, brand_name, is_active, is_primary)
  VALUES (NEW.id, trim(NEW.name), 1, 1);
END;
--> statement-breakpoint

-- 4. The reverse direction: a legacy write straight to `brands.name` is
--    reflected back into the variations table rather than silently diverging.
--    The old primary is DEMOTED, not deleted — it stays a lookup key, which is
--    the entire point of the table.
CREATE TRIGGER IF NOT EXISTS brand_variation_sync_from_brand_update
AFTER UPDATE OF name ON brands
WHEN trim(COALESCE(NEW.name, '')) != '' AND NEW.name IS NOT OLD.name
BEGIN
  UPDATE brand_name_variations
     SET is_primary = 0
   WHERE brand_id = NEW.id
     AND is_primary = 1
     AND brand_name IS NOT NEW.name;

  INSERT INTO brand_name_variations
    (brand_id, brand_name, is_active, is_primary)
  VALUES (NEW.id, trim(NEW.name), 1, 1)
  ON CONFLICT (brand_id, brand_name)
  DO UPDATE SET is_primary = 1, is_active = 1;
END;
