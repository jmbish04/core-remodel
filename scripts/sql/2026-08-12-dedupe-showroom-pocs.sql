-- Dedupe exact-duplicate showroom_pocs left by store-merge child remaps (a POC copied
-- once per merged branch, e.g. Jack London had 2x Cyndi Campos + 2x Vince Sacdalan).
-- Soft-deactivates all but the lowest-id row per (store, name, phone, email); reversible.
-- Backup: db-archive/pocs-backup-20260812/. Apply:
--   npx wrangler d1 execute core-remodel --remote --file=scripts/sql/2026-08-12-dedupe-showroom-pocs.sql
UPDATE showroom_pocs SET is_active = 0
WHERE is_active = 1
  AND id NOT IN (
    SELECT MIN(id) FROM showroom_pocs
    WHERE is_active = 1
    GROUP BY showroom_id, LOWER(TRIM(full_name)), COALESCE(phone, ''), COALESCE(email, '')
  );
