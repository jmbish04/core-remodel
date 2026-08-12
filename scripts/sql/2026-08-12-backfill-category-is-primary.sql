-- One-off backfill for migration 0179 (showroom_store_category_mapping.is_primary).
-- Sets exactly ONE is_primary=1 per store: the highest ai_rationale_confidence_score
-- mapping (tie → lowest id). The partial-unique index sscm_one_primary_per_store
-- guarantees at most one, so this is safe to re-run on any D1 that has the column
-- but no primary yet (fresh/local dev; prod already backfilled 2026-08-12).
-- Apply: npx wrangler d1 execute core-remodel --remote --file=scripts/sql/2026-08-12-backfill-category-is-primary.sql
UPDATE showroom_store_category_mapping SET is_primary = 1
WHERE id IN (
  SELECT m.id FROM showroom_store_category_mapping m
  JOIN (
    SELECT store_id, MIN(
      (9 - COALESCE(ai_rationale_confidence_score, 5)) * 100000 + id
    ) AS best_rank
    FROM showroom_store_category_mapping
    GROUP BY store_id
  ) pick ON pick.store_id = m.store_id
       AND ((9 - COALESCE(m.ai_rationale_confidence_score, 5)) * 100000 + m.id) = pick.best_rank
)
AND is_primary = 0;
