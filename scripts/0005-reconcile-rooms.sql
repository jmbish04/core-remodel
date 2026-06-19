-- =============================================================================
-- 0005-reconcile-rooms.sql
-- Feature 0005 — Room Data Reconciliation (REVISED R2 — merge-into-existing-final)
-- =============================================================================
--
-- WHAT CHANGED FROM THE ORIGINAL (R1)
-- ------------------------------------
-- The original R1 script used UPDATE rooms SET room_code='final-code' ... to
-- rename old rows into their final codes.  That NOW FAILS because a prior seed
-- run already created rows with the final codes (3284726–3284744) and room_code
-- has a UNIQUE constraint.
--
-- This R2 script uses the MERGE-INTO-EXISTING-FINAL model instead:
--   1. For every OLD row (id=1–20) or GHOST row (id=2330293–2330301) that
--      holds photos or FK references, we UPDATE all FK-referencing tables to
--      point from the old/ghost id to the already-existing FINAL row id.
--   2. After all FKs are repointed we soft-delete the source row:
--        UPDATE rooms SET is_active=0 WHERE id=<source>;
--   3. Kept old rows (lower-family-room/2, lower-laundry/4, lower-garage/6,
--      upper-lightwell/18) are NOT merged — we just set their coords.
--   4. Deactivate-only rows (lower-storage/5, upper-deck/20) have no photos;
--      they get is_active=0 without any FK work.
--
-- IDEMPOTENCY
-- -----------
-- Every FK UPDATE is safe to re-run: if the source room_id no longer has any
-- rows (already repointed on a prior run) the UPDATE affects 0 rows.  The
-- inspiration dedupe (INSERT OR IGNORE / DELETE before UPDATE) is also safe to
-- re-run.  The final UPDATE rooms SET is_active=0 WHERE id=X AND is_active=1
-- is a no-op on re-run because the guard prevents double-firing.
--
-- LIVE ID REFERENCE (verified 2026-06-19)
-- ----------------------------------------
-- FINAL target rooms (already exist with correct room_code + coords):
--   lower-guest-bedroom  = 3284726
--   lower-guest-bath     = 3284728
--   street-front-door    = 3284731
--   lower-foyer          = 3284732
--   outside-patio        = 3284733
--   outside-backyard     = 3284734
--   primary-bedroom      = 3284735
--   jason-office         = 3284736
--   justin-office        = 3284737
--   upper-living-room    = 3284738
--   upper-dining-room    = 3284739
--   upper-kitchen        = 3284740
--   upper-hall-bath      = 3284741
--   upper-stair-landing  = 3284743
--   primary-bathroom     = 3284744
--
-- OLD canonical rooms to be merged (hold listing photos, no coords):
--   id=1  lower-bedroom-1         → merge into 3284726
--   id=2  lower-family-room       → KEPT active; merge 2330299 into it; set coords
--   id=3  lower-bath-1            → merge into 3284728
--   id=4  lower-laundry           → KEPT active; set coords only
--   id=5  lower-storage           → deactivate (no photos)
--   id=6  lower-garage            → KEPT active; set coords only
--   id=7  lower-entryway          → photo-split; allowlist→3284731, rest→3284732; deactivate
--   id=8  lower-patio             → merge into 3284733
--   id=9  lower-rear-patio        → merge into 3284733
--   id=10 lower-backyard          → merge into 3284734
--   id=11 upper-primary-bedroom   → merge into 3284735
--   id=12 upper-bedroom-2         → merge into 3284736
--   id=13 upper-bedroom-3         → merge into 3284737
--   id=14 upper-living-dining     → photo-split; dining→3284739, stair→3284743, residual→3284738; deactivate
--   id=15 upper-kitchen-breakfast → merge into 3284740
--   id=16 upper-bath-1            → merge into 3284741
--   id=17 upper-bath-2            → merge into 3284744 (coord donor)
--   id=18 upper-lightwell         → KEPT active; set coords only
--   id=19 upper-workshop          → merge into 3284743
--   id=20 upper-deck              → deactivate (no photos)
--
-- GHOST drift rooms to be merged (hold inspiration photos):
--   id=2330293 primary_bathroom → merge into 3284744
--   id=2330294 entry_foyer      → merge into 3284732
--   id=2330295 kitchen          → merge into 3284740
--   id=2330296 guest_bathroom   → merge into 3284728
--   id=2330297 hall_bathroom    → merge into 3284741
--   id=2330298 guest_bedroom    → merge into 3284726
--   id=2330299 living_room      → merge into 2 (kept old lower-family-room)
--   id=2330300 family_room      → merge into 3284738
--   id=2330301 backyard         → merge into 3284734
--
-- Floors:
--   lower_level floor id = (SELECT id FROM floors WHERE key='lower_level')  -- id=1
--   upper_level floor id = (SELECT id FROM floors WHERE key='upper_level')  -- id=2
--   outside     floor id = 233121, key='outside'
--   all_levels  floor id = 233122, key='all_levels'
--
-- NOTE: The 2 duplicate image hard-deletes (4a06d3af, 1343677a) are NOT here
-- because they also require deleting the Cloudflare Images asset.  Use the
-- Worker API (or the .ts script with CF_WORKER_URL set):
--   curl -X DELETE https://<worker>/api/images/4a06d3af-d8ac-4577-87bb-32a228175898 \
--        -H "Authorization: Bearer <token>"
--   curl -X DELETE https://<worker>/api/images/1343677a-db36-4252-85d6-e965dd9c2779 \
--        -H "Authorization: Bearer <token>"
-- D1-only fallback (CF asset already cleaned):
--   DELETE FROM inspirational_image_rooms WHERE image_id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');
--   DELETE FROM images WHERE id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');
-- =============================================================================


-- =============================================================================
-- SECTION 1: LOWER LEVEL MERGES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- L1: Merge lower-bedroom-1 (id=1) → lower-guest-bedroom (id=3284726)
--
-- The old row (id=1) holds listing photos.  Repoint all FK tables from id=1
-- to id=3284726, deduplicate constrained join tables, then soft-delete id=1.
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284726 WHERE room_id = 1;
UPDATE listing_photos       SET room_id = 3284726 WHERE room_id = 1;
UPDATE planning_tasks       SET room_id = 3284726 WHERE room_id = 1;
UPDATE room_action_items    SET room_id = 3284726 WHERE room_id = 1;
UPDATE scenario_room_plans  SET room_id = 3284726 WHERE room_id = 1;
UPDATE budget_tracker_item_rooms SET room_id = 3284726 WHERE room_id = 1;
UPDATE standard_costs       SET room_id = 3284726 WHERE room_id = 1;
UPDATE estimate_room_mappings SET room_id = 3284726 WHERE room_id = 1;
UPDATE bid_portfolio_room_configs SET room_id = 3284726 WHERE room_id = 1;
UPDATE bid_portfolio_comments SET room_id = 3284726 WHERE room_id = 1;
UPDATE bid_portfolio_selected_photos SET room_id = 3284726 WHERE room_id = 1;
UPDATE render_canvases      SET room_id = 3284726 WHERE room_id = 1;
UPDATE render_sessions      SET room_id = 3284726 WHERE room_id = 1;
UPDATE mood_board_generations SET room_id = 3284726 WHERE room_id = 1;
UPDATE room_material_quotes SET room_id = 3284726 WHERE room_id = 1;
-- vision_node_room_mappings: unique(vision_node_id, room_id) — skip dupes, delete conflicts
UPDATE vision_node_room_mappings SET room_id = 3284726
 WHERE room_id = 1
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284726);
DELETE FROM vision_node_room_mappings WHERE room_id = 1;
-- checklist_room_mappings: unique(question_id, room_id)
UPDATE checklist_room_mappings SET room_id = 3284726
 WHERE room_id = 1
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284726);
DELETE FROM checklist_room_mappings WHERE room_id = 1;
-- supporting_document_room_mappings: unique(supporting_document_id, room_id)
UPDATE supporting_document_room_mappings SET room_id = 3284726
 WHERE room_id = 1
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284726);
DELETE FROM supporting_document_room_mappings WHERE room_id = 1;
-- inspirational_image_rooms: unique(image_id, room_id) — dedupe then repoint
DELETE FROM inspirational_image_rooms
 WHERE room_id = 1
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284726);
UPDATE inspirational_image_rooms SET room_id = 3284726 WHERE room_id = 1;
-- room_ai_summaries: unique(room_id) — keep target's row
DELETE FROM room_ai_summaries
 WHERE room_id = 1
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284726);
UPDATE room_ai_summaries SET room_id = 3284726
 WHERE room_id = 1
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284726);
-- Soft-delete source (C1 mandate: is_active=0, not DELETE)
UPDATE rooms SET is_active = 0 WHERE id = 1 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L1b: Merge guest_bedroom ghost (id=2330298) → lower-guest-bedroom (id=3284726)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE listing_photos       SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE planning_tasks       SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE room_action_items    SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE scenario_room_plans  SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE budget_tracker_item_rooms SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE standard_costs       SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE estimate_room_mappings SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE bid_portfolio_room_configs SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE bid_portfolio_comments SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE bid_portfolio_selected_photos SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE render_canvases      SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE render_sessions      SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE mood_board_generations SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE room_material_quotes SET room_id = 3284726 WHERE room_id = 2330298;
UPDATE vision_node_room_mappings SET room_id = 3284726
 WHERE room_id = 2330298
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284726);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330298;
UPDATE checklist_room_mappings SET room_id = 3284726
 WHERE room_id = 2330298
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284726);
DELETE FROM checklist_room_mappings WHERE room_id = 2330298;
UPDATE supporting_document_room_mappings SET room_id = 3284726
 WHERE room_id = 2330298
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284726);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330298;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330298
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284726);
UPDATE inspirational_image_rooms SET room_id = 3284726 WHERE room_id = 2330298;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330298
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284726);
UPDATE room_ai_summaries SET room_id = 3284726
 WHERE room_id = 2330298
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284726);
UPDATE rooms SET is_active = 0 WHERE id = 2330298 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L2: Merge living_room ghost (id=2330299) → lower-family-room KEPT (id=2)
--
-- lower-family-room (id=2) has no final-code counterpart — it is KEPT active.
-- We only merge the ghost living_room row into it.
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 2 WHERE room_id = 2330299;
UPDATE listing_photos       SET room_id = 2 WHERE room_id = 2330299;
UPDATE planning_tasks       SET room_id = 2 WHERE room_id = 2330299;
UPDATE room_action_items    SET room_id = 2 WHERE room_id = 2330299;
UPDATE scenario_room_plans  SET room_id = 2 WHERE room_id = 2330299;
UPDATE budget_tracker_item_rooms SET room_id = 2 WHERE room_id = 2330299;
UPDATE standard_costs       SET room_id = 2 WHERE room_id = 2330299;
UPDATE estimate_room_mappings SET room_id = 2 WHERE room_id = 2330299;
UPDATE bid_portfolio_room_configs SET room_id = 2 WHERE room_id = 2330299;
UPDATE bid_portfolio_comments SET room_id = 2 WHERE room_id = 2330299;
UPDATE bid_portfolio_selected_photos SET room_id = 2 WHERE room_id = 2330299;
UPDATE render_canvases      SET room_id = 2 WHERE room_id = 2330299;
UPDATE render_sessions      SET room_id = 2 WHERE room_id = 2330299;
UPDATE mood_board_generations SET room_id = 2 WHERE room_id = 2330299;
UPDATE room_material_quotes SET room_id = 2 WHERE room_id = 2330299;
UPDATE vision_node_room_mappings SET room_id = 2
 WHERE room_id = 2330299
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 2);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330299;
UPDATE checklist_room_mappings SET room_id = 2
 WHERE room_id = 2330299
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 2);
DELETE FROM checklist_room_mappings WHERE room_id = 2330299;
UPDATE supporting_document_room_mappings SET room_id = 2
 WHERE room_id = 2330299
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 2);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330299;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330299
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 2);
UPDATE inspirational_image_rooms SET room_id = 2 WHERE room_id = 2330299;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330299
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 2);
UPDATE room_ai_summaries SET room_id = 2
 WHERE room_id = 2330299
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 2);
UPDATE rooms SET is_active = 0 WHERE id = 2330299 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L3: Merge lower-bath-1 (id=3) → lower-guest-bath (id=3284728)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284728 WHERE room_id = 3;
UPDATE listing_photos       SET room_id = 3284728 WHERE room_id = 3;
UPDATE planning_tasks       SET room_id = 3284728 WHERE room_id = 3;
UPDATE room_action_items    SET room_id = 3284728 WHERE room_id = 3;
UPDATE scenario_room_plans  SET room_id = 3284728 WHERE room_id = 3;
UPDATE budget_tracker_item_rooms SET room_id = 3284728 WHERE room_id = 3;
UPDATE standard_costs       SET room_id = 3284728 WHERE room_id = 3;
UPDATE estimate_room_mappings SET room_id = 3284728 WHERE room_id = 3;
UPDATE bid_portfolio_room_configs SET room_id = 3284728 WHERE room_id = 3;
UPDATE bid_portfolio_comments SET room_id = 3284728 WHERE room_id = 3;
UPDATE bid_portfolio_selected_photos SET room_id = 3284728 WHERE room_id = 3;
UPDATE render_canvases      SET room_id = 3284728 WHERE room_id = 3;
UPDATE render_sessions      SET room_id = 3284728 WHERE room_id = 3;
UPDATE mood_board_generations SET room_id = 3284728 WHERE room_id = 3;
UPDATE room_material_quotes SET room_id = 3284728 WHERE room_id = 3;
UPDATE vision_node_room_mappings SET room_id = 3284728
 WHERE room_id = 3
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284728);
DELETE FROM vision_node_room_mappings WHERE room_id = 3;
UPDATE checklist_room_mappings SET room_id = 3284728
 WHERE room_id = 3
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284728);
DELETE FROM checklist_room_mappings WHERE room_id = 3;
UPDATE supporting_document_room_mappings SET room_id = 3284728
 WHERE room_id = 3
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284728);
DELETE FROM supporting_document_room_mappings WHERE room_id = 3;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 3
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284728);
UPDATE inspirational_image_rooms SET room_id = 3284728 WHERE room_id = 3;
DELETE FROM room_ai_summaries
 WHERE room_id = 3
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284728);
UPDATE room_ai_summaries SET room_id = 3284728
 WHERE room_id = 3
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284728);
UPDATE rooms SET is_active = 0 WHERE id = 3 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L3b: Merge guest_bathroom ghost (id=2330296) → lower-guest-bath (id=3284728)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE listing_photos       SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE planning_tasks       SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE room_action_items    SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE scenario_room_plans  SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE budget_tracker_item_rooms SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE standard_costs       SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE estimate_room_mappings SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE bid_portfolio_room_configs SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE bid_portfolio_comments SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE bid_portfolio_selected_photos SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE render_canvases      SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE render_sessions      SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE mood_board_generations SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE room_material_quotes SET room_id = 3284728 WHERE room_id = 2330296;
UPDATE vision_node_room_mappings SET room_id = 3284728
 WHERE room_id = 2330296
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284728);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330296;
UPDATE checklist_room_mappings SET room_id = 3284728
 WHERE room_id = 2330296
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284728);
DELETE FROM checklist_room_mappings WHERE room_id = 2330296;
UPDATE supporting_document_room_mappings SET room_id = 3284728
 WHERE room_id = 2330296
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284728);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330296;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330296
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284728);
UPDATE inspirational_image_rooms SET room_id = 3284728 WHERE room_id = 2330296;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330296
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284728);
UPDATE room_ai_summaries SET room_id = 3284728
 WHERE room_id = 2330296
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284728);
UPDATE rooms SET is_active = 0 WHERE id = 2330296 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L4: Merge lower-patio (id=8) → outside-patio (id=3284733)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284733 WHERE room_id = 8;
UPDATE listing_photos       SET room_id = 3284733 WHERE room_id = 8;
UPDATE planning_tasks       SET room_id = 3284733 WHERE room_id = 8;
UPDATE room_action_items    SET room_id = 3284733 WHERE room_id = 8;
UPDATE scenario_room_plans  SET room_id = 3284733 WHERE room_id = 8;
UPDATE budget_tracker_item_rooms SET room_id = 3284733 WHERE room_id = 8;
UPDATE standard_costs       SET room_id = 3284733 WHERE room_id = 8;
UPDATE estimate_room_mappings SET room_id = 3284733 WHERE room_id = 8;
UPDATE bid_portfolio_room_configs SET room_id = 3284733 WHERE room_id = 8;
UPDATE bid_portfolio_comments SET room_id = 3284733 WHERE room_id = 8;
UPDATE bid_portfolio_selected_photos SET room_id = 3284733 WHERE room_id = 8;
UPDATE render_canvases      SET room_id = 3284733 WHERE room_id = 8;
UPDATE render_sessions      SET room_id = 3284733 WHERE room_id = 8;
UPDATE mood_board_generations SET room_id = 3284733 WHERE room_id = 8;
UPDATE room_material_quotes SET room_id = 3284733 WHERE room_id = 8;
UPDATE vision_node_room_mappings SET room_id = 3284733
 WHERE room_id = 8
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284733);
DELETE FROM vision_node_room_mappings WHERE room_id = 8;
UPDATE checklist_room_mappings SET room_id = 3284733
 WHERE room_id = 8
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284733);
DELETE FROM checklist_room_mappings WHERE room_id = 8;
UPDATE supporting_document_room_mappings SET room_id = 3284733
 WHERE room_id = 8
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284733);
DELETE FROM supporting_document_room_mappings WHERE room_id = 8;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 8
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284733);
UPDATE inspirational_image_rooms SET room_id = 3284733 WHERE room_id = 8;
DELETE FROM room_ai_summaries
 WHERE room_id = 8
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284733);
UPDATE room_ai_summaries SET room_id = 3284733
 WHERE room_id = 8
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284733);
UPDATE rooms SET is_active = 0 WHERE id = 8 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L4b: Merge lower-rear-patio (id=9) → outside-patio (id=3284733)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284733 WHERE room_id = 9;
UPDATE listing_photos       SET room_id = 3284733 WHERE room_id = 9;
UPDATE planning_tasks       SET room_id = 3284733 WHERE room_id = 9;
UPDATE room_action_items    SET room_id = 3284733 WHERE room_id = 9;
UPDATE scenario_room_plans  SET room_id = 3284733 WHERE room_id = 9;
UPDATE budget_tracker_item_rooms SET room_id = 3284733 WHERE room_id = 9;
UPDATE standard_costs       SET room_id = 3284733 WHERE room_id = 9;
UPDATE estimate_room_mappings SET room_id = 3284733 WHERE room_id = 9;
UPDATE bid_portfolio_room_configs SET room_id = 3284733 WHERE room_id = 9;
UPDATE bid_portfolio_comments SET room_id = 3284733 WHERE room_id = 9;
UPDATE bid_portfolio_selected_photos SET room_id = 3284733 WHERE room_id = 9;
UPDATE render_canvases      SET room_id = 3284733 WHERE room_id = 9;
UPDATE render_sessions      SET room_id = 3284733 WHERE room_id = 9;
UPDATE mood_board_generations SET room_id = 3284733 WHERE room_id = 9;
UPDATE room_material_quotes SET room_id = 3284733 WHERE room_id = 9;
UPDATE vision_node_room_mappings SET room_id = 3284733
 WHERE room_id = 9
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284733);
DELETE FROM vision_node_room_mappings WHERE room_id = 9;
UPDATE checklist_room_mappings SET room_id = 3284733
 WHERE room_id = 9
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284733);
DELETE FROM checklist_room_mappings WHERE room_id = 9;
UPDATE supporting_document_room_mappings SET room_id = 3284733
 WHERE room_id = 9
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284733);
DELETE FROM supporting_document_room_mappings WHERE room_id = 9;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 9
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284733);
UPDATE inspirational_image_rooms SET room_id = 3284733 WHERE room_id = 9;
DELETE FROM room_ai_summaries
 WHERE room_id = 9
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284733);
UPDATE room_ai_summaries SET room_id = 3284733
 WHERE room_id = 9
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284733);
UPDATE rooms SET is_active = 0 WHERE id = 9 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L5: Merge lower-backyard (id=10) → outside-backyard (id=3284734)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284734 WHERE room_id = 10;
UPDATE listing_photos       SET room_id = 3284734 WHERE room_id = 10;
UPDATE planning_tasks       SET room_id = 3284734 WHERE room_id = 10;
UPDATE room_action_items    SET room_id = 3284734 WHERE room_id = 10;
UPDATE scenario_room_plans  SET room_id = 3284734 WHERE room_id = 10;
UPDATE budget_tracker_item_rooms SET room_id = 3284734 WHERE room_id = 10;
UPDATE standard_costs       SET room_id = 3284734 WHERE room_id = 10;
UPDATE estimate_room_mappings SET room_id = 3284734 WHERE room_id = 10;
UPDATE bid_portfolio_room_configs SET room_id = 3284734 WHERE room_id = 10;
UPDATE bid_portfolio_comments SET room_id = 3284734 WHERE room_id = 10;
UPDATE bid_portfolio_selected_photos SET room_id = 3284734 WHERE room_id = 10;
UPDATE render_canvases      SET room_id = 3284734 WHERE room_id = 10;
UPDATE render_sessions      SET room_id = 3284734 WHERE room_id = 10;
UPDATE mood_board_generations SET room_id = 3284734 WHERE room_id = 10;
UPDATE room_material_quotes SET room_id = 3284734 WHERE room_id = 10;
UPDATE vision_node_room_mappings SET room_id = 3284734
 WHERE room_id = 10
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284734);
DELETE FROM vision_node_room_mappings WHERE room_id = 10;
UPDATE checklist_room_mappings SET room_id = 3284734
 WHERE room_id = 10
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284734);
DELETE FROM checklist_room_mappings WHERE room_id = 10;
UPDATE supporting_document_room_mappings SET room_id = 3284734
 WHERE room_id = 10
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284734);
DELETE FROM supporting_document_room_mappings WHERE room_id = 10;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 10
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284734);
UPDATE inspirational_image_rooms SET room_id = 3284734 WHERE room_id = 10;
DELETE FROM room_ai_summaries
 WHERE room_id = 10
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284734);
UPDATE room_ai_summaries SET room_id = 3284734
 WHERE room_id = 10
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284734);
UPDATE rooms SET is_active = 0 WHERE id = 10 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L5b: Merge backyard ghost (id=2330301) → outside-backyard (id=3284734)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE listing_photos       SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE planning_tasks       SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE room_action_items    SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE scenario_room_plans  SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE budget_tracker_item_rooms SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE standard_costs       SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE estimate_room_mappings SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE bid_portfolio_room_configs SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE bid_portfolio_comments SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE bid_portfolio_selected_photos SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE render_canvases      SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE render_sessions      SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE mood_board_generations SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE room_material_quotes SET room_id = 3284734 WHERE room_id = 2330301;
UPDATE vision_node_room_mappings SET room_id = 3284734
 WHERE room_id = 2330301
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284734);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330301;
UPDATE checklist_room_mappings SET room_id = 3284734
 WHERE room_id = 2330301
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284734);
DELETE FROM checklist_room_mappings WHERE room_id = 2330301;
UPDATE supporting_document_room_mappings SET room_id = 3284734
 WHERE room_id = 2330301
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284734);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330301;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330301
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284734);
UPDATE inspirational_image_rooms SET room_id = 3284734 WHERE room_id = 2330301;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330301
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284734);
UPDATE room_ai_summaries SET room_id = 3284734
 WHERE room_id = 2330301
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284734);
UPDATE rooms SET is_active = 0 WHERE id = 2330301 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L6: Entryway photo-split — lower-entryway (id=7) → two final rooms
--
-- Images fd965547 and 4ce41f86 belong to street-front-door (3284731).
-- ALL OTHER images on room 7 (both listing and inspiration) go to lower-foyer (3284732).
-- After the split, room 7 must have zero photos before deactivation.
--
-- Photo split: listing images (images.room_id = 7)
-- ---------------------------------------------------------------------------

-- Non-allowlisted listing photos → lower-foyer (3284732)
UPDATE images
   SET room_id = 3284732
 WHERE room_id = 7
   AND id NOT IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );

-- Allowlisted listing photos → street-front-door (3284731)
-- (If they are already on 3284731 from a prior run, this is a no-op.)
UPDATE images
   SET room_id = 3284731
 WHERE room_id = 7
   AND id IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );

-- Photo split: inspiration mappings (inspirational_image_rooms.room_id = 7)
-- Non-allowlisted inspiration → lower-foyer (3284732)
-- Step 1: insert to lower-foyer, skip if already mapped there
INSERT OR IGNORE INTO inspirational_image_rooms (image_id, room_id)
SELECT image_id, 3284732
  FROM inspirational_image_rooms
 WHERE room_id = 7
   AND image_id NOT IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );
-- Step 2: remove from room 7
DELETE FROM inspirational_image_rooms
 WHERE room_id = 7
   AND image_id NOT IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );

-- Allowlisted inspiration → street-front-door (3284731)
INSERT OR IGNORE INTO inspirational_image_rooms (image_id, room_id)
SELECT image_id, 3284731
  FROM inspirational_image_rooms
 WHERE room_id = 7
   AND image_id IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );
DELETE FROM inspirational_image_rooms
 WHERE room_id = 7
   AND image_id IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );

-- Repoint all other FK tables from room 7 → lower-foyer (3284732)
-- (These tables do not have photos; repointing them keeps FK integrity.)
UPDATE listing_photos       SET room_id = 3284732 WHERE room_id = 7;
UPDATE planning_tasks       SET room_id = 3284732 WHERE room_id = 7;
UPDATE room_action_items    SET room_id = 3284732 WHERE room_id = 7;
UPDATE scenario_room_plans  SET room_id = 3284732 WHERE room_id = 7;
UPDATE budget_tracker_item_rooms SET room_id = 3284732 WHERE room_id = 7;
UPDATE standard_costs       SET room_id = 3284732 WHERE room_id = 7;
UPDATE estimate_room_mappings SET room_id = 3284732 WHERE room_id = 7;
UPDATE bid_portfolio_room_configs SET room_id = 3284732 WHERE room_id = 7;
UPDATE bid_portfolio_comments SET room_id = 3284732 WHERE room_id = 7;
UPDATE bid_portfolio_selected_photos SET room_id = 3284732 WHERE room_id = 7;
UPDATE render_canvases      SET room_id = 3284732 WHERE room_id = 7;
UPDATE render_sessions      SET room_id = 3284732 WHERE room_id = 7;
UPDATE mood_board_generations SET room_id = 3284732 WHERE room_id = 7;
UPDATE room_material_quotes SET room_id = 3284732 WHERE room_id = 7;
UPDATE vision_node_room_mappings SET room_id = 3284732
 WHERE room_id = 7
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284732);
DELETE FROM vision_node_room_mappings WHERE room_id = 7;
UPDATE checklist_room_mappings SET room_id = 3284732
 WHERE room_id = 7
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284732);
DELETE FROM checklist_room_mappings WHERE room_id = 7;
UPDATE supporting_document_room_mappings SET room_id = 3284732
 WHERE room_id = 7
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284732);
DELETE FROM supporting_document_room_mappings WHERE room_id = 7;
DELETE FROM room_ai_summaries
 WHERE room_id = 7
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284732);
UPDATE room_ai_summaries SET room_id = 3284732
 WHERE room_id = 7
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284732);
-- Soft-delete room 7 — all photos are now on final rows 3284731 or 3284732
UPDATE rooms SET is_active = 0 WHERE id = 7 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L6b: Merge entry_foyer ghost (id=2330294) → lower-foyer (id=3284732)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE listing_photos       SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE planning_tasks       SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE room_action_items    SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE scenario_room_plans  SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE budget_tracker_item_rooms SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE standard_costs       SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE estimate_room_mappings SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE bid_portfolio_room_configs SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE bid_portfolio_comments SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE bid_portfolio_selected_photos SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE render_canvases      SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE render_sessions      SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE mood_board_generations SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE room_material_quotes SET room_id = 3284732 WHERE room_id = 2330294;
UPDATE vision_node_room_mappings SET room_id = 3284732
 WHERE room_id = 2330294
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284732);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330294;
UPDATE checklist_room_mappings SET room_id = 3284732
 WHERE room_id = 2330294
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284732);
DELETE FROM checklist_room_mappings WHERE room_id = 2330294;
UPDATE supporting_document_room_mappings SET room_id = 3284732
 WHERE room_id = 2330294
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284732);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330294;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330294
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284732);
UPDATE inspirational_image_rooms SET room_id = 3284732 WHERE room_id = 2330294;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330294
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284732);
UPDATE room_ai_summaries SET room_id = 3284732
 WHERE room_id = 2330294
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284732);
UPDATE rooms SET is_active = 0 WHERE id = 2330294 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- L7: Set coords on kept lower-laundry (id=4): lower_level (26, 49)
-- L7b: Set coords on kept lower-garage (id=6): lower_level (25, 77)
-- L8: Deactivate lower-storage (id=5) — no photos
-- ---------------------------------------------------------------------------
UPDATE rooms
   SET floorplan_floor_key = 'lower_level', floorplan_x_pct = 26, floorplan_y_pct = 49
 WHERE id = 4;

UPDATE rooms
   SET floorplan_floor_key = 'lower_level', floorplan_x_pct = 25, floorplan_y_pct = 77
 WHERE id = 6;

-- lower-storage (id=5): no photos; safe to deactivate directly.
-- Verify no photos remain before this runs (checked in VERIFY section).
UPDATE rooms SET is_active = 0 WHERE id = 5 AND is_active = 1;


-- =============================================================================
-- SECTION 2: UPPER LEVEL MERGES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- U1: Merge upper-primary-bedroom (id=11) → primary-bedroom (id=3284735)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284735 WHERE room_id = 11;
UPDATE listing_photos       SET room_id = 3284735 WHERE room_id = 11;
UPDATE planning_tasks       SET room_id = 3284735 WHERE room_id = 11;
UPDATE room_action_items    SET room_id = 3284735 WHERE room_id = 11;
UPDATE scenario_room_plans  SET room_id = 3284735 WHERE room_id = 11;
UPDATE budget_tracker_item_rooms SET room_id = 3284735 WHERE room_id = 11;
UPDATE standard_costs       SET room_id = 3284735 WHERE room_id = 11;
UPDATE estimate_room_mappings SET room_id = 3284735 WHERE room_id = 11;
UPDATE bid_portfolio_room_configs SET room_id = 3284735 WHERE room_id = 11;
UPDATE bid_portfolio_comments SET room_id = 3284735 WHERE room_id = 11;
UPDATE bid_portfolio_selected_photos SET room_id = 3284735 WHERE room_id = 11;
UPDATE render_canvases      SET room_id = 3284735 WHERE room_id = 11;
UPDATE render_sessions      SET room_id = 3284735 WHERE room_id = 11;
UPDATE mood_board_generations SET room_id = 3284735 WHERE room_id = 11;
UPDATE room_material_quotes SET room_id = 3284735 WHERE room_id = 11;
UPDATE vision_node_room_mappings SET room_id = 3284735
 WHERE room_id = 11
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284735);
DELETE FROM vision_node_room_mappings WHERE room_id = 11;
UPDATE checklist_room_mappings SET room_id = 3284735
 WHERE room_id = 11
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284735);
DELETE FROM checklist_room_mappings WHERE room_id = 11;
UPDATE supporting_document_room_mappings SET room_id = 3284735
 WHERE room_id = 11
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284735);
DELETE FROM supporting_document_room_mappings WHERE room_id = 11;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 11
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284735);
UPDATE inspirational_image_rooms SET room_id = 3284735 WHERE room_id = 11;
DELETE FROM room_ai_summaries
 WHERE room_id = 11
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284735);
UPDATE room_ai_summaries SET room_id = 3284735
 WHERE room_id = 11
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284735);
UPDATE rooms SET is_active = 0 WHERE id = 11 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U2: Merge primary_bathroom ghost (id=2330293) → primary-bathroom (id=3284744)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE listing_photos       SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE planning_tasks       SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE room_action_items    SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE scenario_room_plans  SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE budget_tracker_item_rooms SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE standard_costs       SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE estimate_room_mappings SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE bid_portfolio_room_configs SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE bid_portfolio_comments SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE bid_portfolio_selected_photos SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE render_canvases      SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE render_sessions      SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE mood_board_generations SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE room_material_quotes SET room_id = 3284744 WHERE room_id = 2330293;
UPDATE vision_node_room_mappings SET room_id = 3284744
 WHERE room_id = 2330293
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284744);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330293;
UPDATE checklist_room_mappings SET room_id = 3284744
 WHERE room_id = 2330293
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284744);
DELETE FROM checklist_room_mappings WHERE room_id = 2330293;
UPDATE supporting_document_room_mappings SET room_id = 3284744
 WHERE room_id = 2330293
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284744);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330293;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330293
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284744);
UPDATE inspirational_image_rooms SET room_id = 3284744 WHERE room_id = 2330293;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330293
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284744);
UPDATE room_ai_summaries SET room_id = 3284744
 WHERE room_id = 2330293
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284744);
UPDATE rooms SET is_active = 0 WHERE id = 2330293 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U2b: Merge upper-bath-2 (id=17) → primary-bathroom (id=3284744)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284744 WHERE room_id = 17;
UPDATE listing_photos       SET room_id = 3284744 WHERE room_id = 17;
UPDATE planning_tasks       SET room_id = 3284744 WHERE room_id = 17;
UPDATE room_action_items    SET room_id = 3284744 WHERE room_id = 17;
UPDATE scenario_room_plans  SET room_id = 3284744 WHERE room_id = 17;
UPDATE budget_tracker_item_rooms SET room_id = 3284744 WHERE room_id = 17;
UPDATE standard_costs       SET room_id = 3284744 WHERE room_id = 17;
UPDATE estimate_room_mappings SET room_id = 3284744 WHERE room_id = 17;
UPDATE bid_portfolio_room_configs SET room_id = 3284744 WHERE room_id = 17;
UPDATE bid_portfolio_comments SET room_id = 3284744 WHERE room_id = 17;
UPDATE bid_portfolio_selected_photos SET room_id = 3284744 WHERE room_id = 17;
UPDATE render_canvases      SET room_id = 3284744 WHERE room_id = 17;
UPDATE render_sessions      SET room_id = 3284744 WHERE room_id = 17;
UPDATE mood_board_generations SET room_id = 3284744 WHERE room_id = 17;
UPDATE room_material_quotes SET room_id = 3284744 WHERE room_id = 17;
UPDATE vision_node_room_mappings SET room_id = 3284744
 WHERE room_id = 17
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284744);
DELETE FROM vision_node_room_mappings WHERE room_id = 17;
UPDATE checklist_room_mappings SET room_id = 3284744
 WHERE room_id = 17
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284744);
DELETE FROM checklist_room_mappings WHERE room_id = 17;
UPDATE supporting_document_room_mappings SET room_id = 3284744
 WHERE room_id = 17
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284744);
DELETE FROM supporting_document_room_mappings WHERE room_id = 17;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 17
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284744);
UPDATE inspirational_image_rooms SET room_id = 3284744 WHERE room_id = 17;
DELETE FROM room_ai_summaries
 WHERE room_id = 17
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284744);
UPDATE room_ai_summaries SET room_id = 3284744
 WHERE room_id = 17
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284744);
UPDATE rooms SET is_active = 0 WHERE id = 17 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U3: Merge upper-bedroom-2 (id=12) → jason-office (id=3284736)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284736 WHERE room_id = 12;
UPDATE listing_photos       SET room_id = 3284736 WHERE room_id = 12;
UPDATE planning_tasks       SET room_id = 3284736 WHERE room_id = 12;
UPDATE room_action_items    SET room_id = 3284736 WHERE room_id = 12;
UPDATE scenario_room_plans  SET room_id = 3284736 WHERE room_id = 12;
UPDATE budget_tracker_item_rooms SET room_id = 3284736 WHERE room_id = 12;
UPDATE standard_costs       SET room_id = 3284736 WHERE room_id = 12;
UPDATE estimate_room_mappings SET room_id = 3284736 WHERE room_id = 12;
UPDATE bid_portfolio_room_configs SET room_id = 3284736 WHERE room_id = 12;
UPDATE bid_portfolio_comments SET room_id = 3284736 WHERE room_id = 12;
UPDATE bid_portfolio_selected_photos SET room_id = 3284736 WHERE room_id = 12;
UPDATE render_canvases      SET room_id = 3284736 WHERE room_id = 12;
UPDATE render_sessions      SET room_id = 3284736 WHERE room_id = 12;
UPDATE mood_board_generations SET room_id = 3284736 WHERE room_id = 12;
UPDATE room_material_quotes SET room_id = 3284736 WHERE room_id = 12;
UPDATE vision_node_room_mappings SET room_id = 3284736
 WHERE room_id = 12
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284736);
DELETE FROM vision_node_room_mappings WHERE room_id = 12;
UPDATE checklist_room_mappings SET room_id = 3284736
 WHERE room_id = 12
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284736);
DELETE FROM checklist_room_mappings WHERE room_id = 12;
UPDATE supporting_document_room_mappings SET room_id = 3284736
 WHERE room_id = 12
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284736);
DELETE FROM supporting_document_room_mappings WHERE room_id = 12;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 12
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284736);
UPDATE inspirational_image_rooms SET room_id = 3284736 WHERE room_id = 12;
DELETE FROM room_ai_summaries
 WHERE room_id = 12
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284736);
UPDATE room_ai_summaries SET room_id = 3284736
 WHERE room_id = 12
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284736);
UPDATE rooms SET is_active = 0 WHERE id = 12 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U4: Merge upper-bedroom-3 (id=13) → justin-office (id=3284737)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284737 WHERE room_id = 13;
UPDATE listing_photos       SET room_id = 3284737 WHERE room_id = 13;
UPDATE planning_tasks       SET room_id = 3284737 WHERE room_id = 13;
UPDATE room_action_items    SET room_id = 3284737 WHERE room_id = 13;
UPDATE scenario_room_plans  SET room_id = 3284737 WHERE room_id = 13;
UPDATE budget_tracker_item_rooms SET room_id = 3284737 WHERE room_id = 13;
UPDATE standard_costs       SET room_id = 3284737 WHERE room_id = 13;
UPDATE estimate_room_mappings SET room_id = 3284737 WHERE room_id = 13;
UPDATE bid_portfolio_room_configs SET room_id = 3284737 WHERE room_id = 13;
UPDATE bid_portfolio_comments SET room_id = 3284737 WHERE room_id = 13;
UPDATE bid_portfolio_selected_photos SET room_id = 3284737 WHERE room_id = 13;
UPDATE render_canvases      SET room_id = 3284737 WHERE room_id = 13;
UPDATE render_sessions      SET room_id = 3284737 WHERE room_id = 13;
UPDATE mood_board_generations SET room_id = 3284737 WHERE room_id = 13;
UPDATE room_material_quotes SET room_id = 3284737 WHERE room_id = 13;
UPDATE vision_node_room_mappings SET room_id = 3284737
 WHERE room_id = 13
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284737);
DELETE FROM vision_node_room_mappings WHERE room_id = 13;
UPDATE checklist_room_mappings SET room_id = 3284737
 WHERE room_id = 13
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284737);
DELETE FROM checklist_room_mappings WHERE room_id = 13;
UPDATE supporting_document_room_mappings SET room_id = 3284737
 WHERE room_id = 13
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284737);
DELETE FROM supporting_document_room_mappings WHERE room_id = 13;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 13
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284737);
UPDATE inspirational_image_rooms SET room_id = 3284737 WHERE room_id = 13;
DELETE FROM room_ai_summaries
 WHERE room_id = 13
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284737);
UPDATE room_ai_summaries SET room_id = 3284737
 WHERE room_id = 13
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284737);
UPDATE rooms SET is_active = 0 WHERE id = 13 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U5: upper-living-dining (id=14) photo-split then merge into upper-living-room (3284738)
--
-- Photo split (listing images on room 14):
--   ce4f317d, 4ac13ec3 → upper-dining-room (3284739)
--   22cef674, a2a0d96c → upper-stair-landing (3284743)
--   All remaining listing images on room 14 → upper-living-room (3284738) via bulk merge
--
-- The split images must move first; then the bulk merge of room 14 into 3284738
-- will only find the residual images still on room 14.
-- ---------------------------------------------------------------------------

-- U5 photo split — dining room images from room 14 → upper-dining-room (3284739)
UPDATE images
   SET room_id = 3284739
 WHERE id IN (
     'ce4f317d-a95e-470c-81ba-a1838a75fb4d',
     '4ac13ec3-c491-4662-b87a-1b9d2fd77c63'
 )
   AND room_id = 14;  -- idempotent: only move if still on room 14

-- U5 photo split — stair-landing images from room 14 → upper-stair-landing (3284743)
UPDATE images
   SET room_id = 3284743
 WHERE id IN (
     '22cef674-571f-4416-b97e-d4b7dc3a4763',
     'a2a0d96c-5247-4406-9cc4-c70a857662f7'
 )
   AND room_id = 14;  -- idempotent: only move if still on room 14

-- U5 bulk merge: all remaining photos + all FK rows from room 14 → upper-living-room (3284738)
UPDATE images               SET room_id = 3284738 WHERE room_id = 14;
UPDATE listing_photos       SET room_id = 3284738 WHERE room_id = 14;
UPDATE planning_tasks       SET room_id = 3284738 WHERE room_id = 14;
UPDATE room_action_items    SET room_id = 3284738 WHERE room_id = 14;
UPDATE scenario_room_plans  SET room_id = 3284738 WHERE room_id = 14;
UPDATE budget_tracker_item_rooms SET room_id = 3284738 WHERE room_id = 14;
UPDATE standard_costs       SET room_id = 3284738 WHERE room_id = 14;
UPDATE estimate_room_mappings SET room_id = 3284738 WHERE room_id = 14;
UPDATE bid_portfolio_room_configs SET room_id = 3284738 WHERE room_id = 14;
UPDATE bid_portfolio_comments SET room_id = 3284738 WHERE room_id = 14;
UPDATE bid_portfolio_selected_photos SET room_id = 3284738 WHERE room_id = 14;
UPDATE render_canvases      SET room_id = 3284738 WHERE room_id = 14;
UPDATE render_sessions      SET room_id = 3284738 WHERE room_id = 14;
UPDATE mood_board_generations SET room_id = 3284738 WHERE room_id = 14;
UPDATE room_material_quotes SET room_id = 3284738 WHERE room_id = 14;
UPDATE vision_node_room_mappings SET room_id = 3284738
 WHERE room_id = 14
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284738);
DELETE FROM vision_node_room_mappings WHERE room_id = 14;
UPDATE checklist_room_mappings SET room_id = 3284738
 WHERE room_id = 14
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284738);
DELETE FROM checklist_room_mappings WHERE room_id = 14;
UPDATE supporting_document_room_mappings SET room_id = 3284738
 WHERE room_id = 14
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284738);
DELETE FROM supporting_document_room_mappings WHERE room_id = 14;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 14
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284738);
UPDATE inspirational_image_rooms SET room_id = 3284738 WHERE room_id = 14;
DELETE FROM room_ai_summaries
 WHERE room_id = 14
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284738);
UPDATE room_ai_summaries SET room_id = 3284738
 WHERE room_id = 14
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284738);
UPDATE rooms SET is_active = 0 WHERE id = 14 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U5c: Merge family_room ghost (id=2330300) → upper-living-room (id=3284738)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE listing_photos       SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE planning_tasks       SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE room_action_items    SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE scenario_room_plans  SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE budget_tracker_item_rooms SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE standard_costs       SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE estimate_room_mappings SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE bid_portfolio_room_configs SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE bid_portfolio_comments SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE bid_portfolio_selected_photos SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE render_canvases      SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE render_sessions      SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE mood_board_generations SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE room_material_quotes SET room_id = 3284738 WHERE room_id = 2330300;
UPDATE vision_node_room_mappings SET room_id = 3284738
 WHERE room_id = 2330300
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284738);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330300;
UPDATE checklist_room_mappings SET room_id = 3284738
 WHERE room_id = 2330300
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284738);
DELETE FROM checklist_room_mappings WHERE room_id = 2330300;
UPDATE supporting_document_room_mappings SET room_id = 3284738
 WHERE room_id = 2330300
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284738);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330300;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330300
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284738);
UPDATE inspirational_image_rooms SET room_id = 3284738 WHERE room_id = 2330300;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330300
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284738);
UPDATE room_ai_summaries SET room_id = 3284738
 WHERE room_id = 2330300
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284738);
UPDATE rooms SET is_active = 0 WHERE id = 2330300 AND is_active = 1;

-- U5d: Duplicate image hard-deletes — see file header for Worker API commands.
-- D1-only fallback (run ONLY if CF asset is already cleaned or orphaned):
-- DELETE FROM inspirational_image_rooms WHERE image_id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');
-- DELETE FROM images WHERE id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');

-- ---------------------------------------------------------------------------
-- U6: Merge upper-bath-1 (id=16) → upper-hall-bath (id=3284741)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284741 WHERE room_id = 16;
UPDATE listing_photos       SET room_id = 3284741 WHERE room_id = 16;
UPDATE planning_tasks       SET room_id = 3284741 WHERE room_id = 16;
UPDATE room_action_items    SET room_id = 3284741 WHERE room_id = 16;
UPDATE scenario_room_plans  SET room_id = 3284741 WHERE room_id = 16;
UPDATE budget_tracker_item_rooms SET room_id = 3284741 WHERE room_id = 16;
UPDATE standard_costs       SET room_id = 3284741 WHERE room_id = 16;
UPDATE estimate_room_mappings SET room_id = 3284741 WHERE room_id = 16;
UPDATE bid_portfolio_room_configs SET room_id = 3284741 WHERE room_id = 16;
UPDATE bid_portfolio_comments SET room_id = 3284741 WHERE room_id = 16;
UPDATE bid_portfolio_selected_photos SET room_id = 3284741 WHERE room_id = 16;
UPDATE render_canvases      SET room_id = 3284741 WHERE room_id = 16;
UPDATE render_sessions      SET room_id = 3284741 WHERE room_id = 16;
UPDATE mood_board_generations SET room_id = 3284741 WHERE room_id = 16;
UPDATE room_material_quotes SET room_id = 3284741 WHERE room_id = 16;
UPDATE vision_node_room_mappings SET room_id = 3284741
 WHERE room_id = 16
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284741);
DELETE FROM vision_node_room_mappings WHERE room_id = 16;
UPDATE checklist_room_mappings SET room_id = 3284741
 WHERE room_id = 16
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284741);
DELETE FROM checklist_room_mappings WHERE room_id = 16;
UPDATE supporting_document_room_mappings SET room_id = 3284741
 WHERE room_id = 16
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284741);
DELETE FROM supporting_document_room_mappings WHERE room_id = 16;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 16
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284741);
UPDATE inspirational_image_rooms SET room_id = 3284741 WHERE room_id = 16;
DELETE FROM room_ai_summaries
 WHERE room_id = 16
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284741);
UPDATE room_ai_summaries SET room_id = 3284741
 WHERE room_id = 16
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284741);
UPDATE rooms SET is_active = 0 WHERE id = 16 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U6b: Merge hall_bathroom ghost (id=2330297) → upper-hall-bath (id=3284741)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE listing_photos       SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE planning_tasks       SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE room_action_items    SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE scenario_room_plans  SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE budget_tracker_item_rooms SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE standard_costs       SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE estimate_room_mappings SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE bid_portfolio_room_configs SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE bid_portfolio_comments SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE bid_portfolio_selected_photos SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE render_canvases      SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE render_sessions      SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE mood_board_generations SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE room_material_quotes SET room_id = 3284741 WHERE room_id = 2330297;
UPDATE vision_node_room_mappings SET room_id = 3284741
 WHERE room_id = 2330297
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284741);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330297;
UPDATE checklist_room_mappings SET room_id = 3284741
 WHERE room_id = 2330297
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284741);
DELETE FROM checklist_room_mappings WHERE room_id = 2330297;
UPDATE supporting_document_room_mappings SET room_id = 3284741
 WHERE room_id = 2330297
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284741);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330297;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330297
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284741);
UPDATE inspirational_image_rooms SET room_id = 3284741 WHERE room_id = 2330297;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330297
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284741);
UPDATE room_ai_summaries SET room_id = 3284741
 WHERE room_id = 2330297
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284741);
UPDATE rooms SET is_active = 0 WHERE id = 2330297 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U7: Merge upper-kitchen-breakfast (id=15) → upper-kitchen (id=3284740)
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284740 WHERE room_id = 15;
UPDATE listing_photos       SET room_id = 3284740 WHERE room_id = 15;
UPDATE planning_tasks       SET room_id = 3284740 WHERE room_id = 15;
UPDATE room_action_items    SET room_id = 3284740 WHERE room_id = 15;
UPDATE scenario_room_plans  SET room_id = 3284740 WHERE room_id = 15;
UPDATE budget_tracker_item_rooms SET room_id = 3284740 WHERE room_id = 15;
UPDATE standard_costs       SET room_id = 3284740 WHERE room_id = 15;
UPDATE estimate_room_mappings SET room_id = 3284740 WHERE room_id = 15;
UPDATE bid_portfolio_room_configs SET room_id = 3284740 WHERE room_id = 15;
UPDATE bid_portfolio_comments SET room_id = 3284740 WHERE room_id = 15;
UPDATE bid_portfolio_selected_photos SET room_id = 3284740 WHERE room_id = 15;
UPDATE render_canvases      SET room_id = 3284740 WHERE room_id = 15;
UPDATE render_sessions      SET room_id = 3284740 WHERE room_id = 15;
UPDATE mood_board_generations SET room_id = 3284740 WHERE room_id = 15;
UPDATE room_material_quotes SET room_id = 3284740 WHERE room_id = 15;
UPDATE vision_node_room_mappings SET room_id = 3284740
 WHERE room_id = 15
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284740);
DELETE FROM vision_node_room_mappings WHERE room_id = 15;
UPDATE checklist_room_mappings SET room_id = 3284740
 WHERE room_id = 15
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284740);
DELETE FROM checklist_room_mappings WHERE room_id = 15;
UPDATE supporting_document_room_mappings SET room_id = 3284740
 WHERE room_id = 15
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284740);
DELETE FROM supporting_document_room_mappings WHERE room_id = 15;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 15
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284740);
UPDATE inspirational_image_rooms SET room_id = 3284740 WHERE room_id = 15;
DELETE FROM room_ai_summaries
 WHERE room_id = 15
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284740);
UPDATE room_ai_summaries SET room_id = 3284740
 WHERE room_id = 15
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284740);
UPDATE rooms SET is_active = 0 WHERE id = 15 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U7b: Merge kitchen ghost (id=2330295) → upper-kitchen (id=3284740)
--
-- This ghost holds 71 inspiration photos; the merge pattern handles all of them.
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE listing_photos       SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE planning_tasks       SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE room_action_items    SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE scenario_room_plans  SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE budget_tracker_item_rooms SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE standard_costs       SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE estimate_room_mappings SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE bid_portfolio_room_configs SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE bid_portfolio_comments SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE bid_portfolio_selected_photos SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE render_canvases      SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE render_sessions      SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE mood_board_generations SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE room_material_quotes SET room_id = 3284740 WHERE room_id = 2330295;
UPDATE vision_node_room_mappings SET room_id = 3284740
 WHERE room_id = 2330295
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284740);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330295;
UPDATE checklist_room_mappings SET room_id = 3284740
 WHERE room_id = 2330295
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284740);
DELETE FROM checklist_room_mappings WHERE room_id = 2330295;
UPDATE supporting_document_room_mappings SET room_id = 3284740
 WHERE room_id = 2330295
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284740);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330295;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330295
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284740);
UPDATE inspirational_image_rooms SET room_id = 3284740 WHERE room_id = 2330295;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330295
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284740);
UPDATE room_ai_summaries SET room_id = 3284740
 WHERE room_id = 2330295
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284740);
UPDATE rooms SET is_active = 0 WHERE id = 2330295 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U8: Set coords on kept upper-lightwell (id=18): upper_level (67, 39)
-- U9: Deactivate upper-deck (id=20) — no photos
-- ---------------------------------------------------------------------------
UPDATE rooms
   SET floorplan_floor_key = 'upper_level', floorplan_x_pct = 67, floorplan_y_pct = 39
 WHERE id = 18;

-- upper-deck (id=20): no photos; verify in VERIFY section before relying on this.
UPDATE rooms SET is_active = 0 WHERE id = 20 AND is_active = 1;

-- ---------------------------------------------------------------------------
-- U10: Merge upper-workshop (id=19) → upper-stair-landing (id=3284743)
--
-- Note: stair-landing images from room 14 (22cef674, a2a0d96c) were already
-- moved to 3284743 in the U5 photo-split above.  This merge handles any
-- photos/FKs that were natively on room 19 (upper-workshop).
-- ---------------------------------------------------------------------------
UPDATE images               SET room_id = 3284743 WHERE room_id = 19;
UPDATE listing_photos       SET room_id = 3284743 WHERE room_id = 19;
UPDATE planning_tasks       SET room_id = 3284743 WHERE room_id = 19;
UPDATE room_action_items    SET room_id = 3284743 WHERE room_id = 19;
UPDATE scenario_room_plans  SET room_id = 3284743 WHERE room_id = 19;
UPDATE budget_tracker_item_rooms SET room_id = 3284743 WHERE room_id = 19;
UPDATE standard_costs       SET room_id = 3284743 WHERE room_id = 19;
UPDATE estimate_room_mappings SET room_id = 3284743 WHERE room_id = 19;
UPDATE bid_portfolio_room_configs SET room_id = 3284743 WHERE room_id = 19;
UPDATE bid_portfolio_comments SET room_id = 3284743 WHERE room_id = 19;
UPDATE bid_portfolio_selected_photos SET room_id = 3284743 WHERE room_id = 19;
UPDATE render_canvases      SET room_id = 3284743 WHERE room_id = 19;
UPDATE render_sessions      SET room_id = 3284743 WHERE room_id = 19;
UPDATE mood_board_generations SET room_id = 3284743 WHERE room_id = 19;
UPDATE room_material_quotes SET room_id = 3284743 WHERE room_id = 19;
UPDATE vision_node_room_mappings SET room_id = 3284743
 WHERE room_id = 19
   AND vision_node_id NOT IN (SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3284743);
DELETE FROM vision_node_room_mappings WHERE room_id = 19;
UPDATE checklist_room_mappings SET room_id = 3284743
 WHERE room_id = 19
   AND question_id NOT IN (SELECT question_id FROM checklist_room_mappings WHERE room_id = 3284743);
DELETE FROM checklist_room_mappings WHERE room_id = 19;
UPDATE supporting_document_room_mappings SET room_id = 3284743
 WHERE room_id = 19
   AND supporting_document_id NOT IN (SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3284743);
DELETE FROM supporting_document_room_mappings WHERE room_id = 19;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 19
   AND image_id IN (SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3284743);
UPDATE inspirational_image_rooms SET room_id = 3284743 WHERE room_id = 19;
DELETE FROM room_ai_summaries
 WHERE room_id = 19
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284743);
UPDATE room_ai_summaries SET room_id = 3284743
 WHERE room_id = 19
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3284743);
UPDATE rooms SET is_active = 0 WHERE id = 19 AND is_active = 1;


-- =============================================================================
-- SECTION 3: COORDINATE SEED
-- Confirm / set floorplan positions on all active rooms.
-- These UPDATE statements are idempotent (safe to run repeatedly).
--
-- Active set after reconciliation:
--   15 final-code rooms + lower-family-room(2) + lower-laundry(4) +
--   lower-garage(6) + upper-lightwell(18) = ~19 active rooms
--
-- outside-backyard has NULL x/y intentionally (no dot on canvas).
-- =============================================================================

-- Lower level rooms
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=33,   floorplan_y_pct=28   WHERE room_code='lower-guest-bedroom'  AND is_active=1;
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=18,   floorplan_y_pct=34   WHERE room_code='lower-family-room'    AND is_active=1;
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=34,   floorplan_y_pct=43   WHERE room_code='lower-guest-bath'     AND is_active=1;
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=26,   floorplan_y_pct=49   WHERE room_code='lower-laundry'        AND is_active=1;
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=25,   floorplan_y_pct=77   WHERE room_code='lower-garage'         AND is_active=1;
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=7,    floorplan_y_pct=89   WHERE room_code='street-front-door'    AND is_active=1;
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=7,    floorplan_y_pct=52   WHERE room_code='lower-foyer'          AND is_active=1;
-- Outside rooms
UPDATE rooms SET floorplan_floor_key='outside',     floorplan_x_pct=27,   floorplan_y_pct=10   WHERE room_code='outside-patio'        AND is_active=1;
UPDATE rooms SET floorplan_floor_key='outside',     floorplan_x_pct=NULL, floorplan_y_pct=NULL WHERE room_code='outside-backyard'     AND is_active=1;
-- Upper level rooms
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=82,   floorplan_y_pct=21   WHERE room_code='primary-bedroom'      AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=66,   floorplan_y_pct=52   WHERE room_code='jason-office'         AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=64,   floorplan_y_pct=21   WHERE room_code='justin-office'        AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=84,   floorplan_y_pct=72   WHERE room_code='upper-living-room'    AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=84,   floorplan_y_pct=62   WHERE room_code='upper-dining-room'    AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=65,   floorplan_y_pct=76   WHERE room_code='upper-kitchen'        AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=64,   floorplan_y_pct=32   WHERE room_code='upper-hall-bath'      AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=67,   floorplan_y_pct=39   WHERE room_code='upper-lightwell'      AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=78,   floorplan_y_pct=49   WHERE room_code='upper-stair-landing'  AND is_active=1;
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=88,   floorplan_y_pct=39   WHERE room_code='primary-bathroom'     AND is_active=1;


-- =============================================================================
-- SECTION 4: INSPIRATION SCOPE CONVERSION
--
-- Runs AFTER all merges so "all active rooms" is the final canonical set.
-- Promotes historical fan-out inspiration per-room rows to level/home scope.
-- See .ts script (convertInspirationScope) for the authoritative implementation.
--
-- Active room counts after reconciliation (expected):
--   lower_level: 7 rooms (lower-guest-bedroom, lower-family-room, lower-guest-bath,
--                          lower-laundry, lower-garage, street-front-door, lower-foyer)
--   outside:     2 rooms (outside-patio, outside-backyard)
--   upper_level: 10 rooms (primary-bedroom, jason-office, justin-office,
--                           upper-living-room, upper-dining-room, upper-kitchen,
--                           upper-hall-bath, upper-lightwell, upper-stair-landing,
--                           primary-bathroom)
--   Total active: 19 rooms
--
-- S2: Promote to HOME scope — image mapped to all 19 active rooms
-- =============================================================================

UPDATE images
   SET inspiration_scope = 'home',
       scope_floor_id = NULL
 WHERE inspiration_scope = 'room'
   AND photo_category = 'inspirational'
   AND id IN (
       SELECT iir.image_id
         FROM inspirational_image_rooms iir
         JOIN rooms r ON r.id = iir.room_id AND r.is_active = 1
        GROUP BY iir.image_id
       HAVING COUNT(DISTINCT iir.room_id) = (SELECT COUNT(*) FROM rooms WHERE is_active = 1)
   );

-- S2b: Delete per-room rows for home-scoped images (no longer needed)
DELETE FROM inspirational_image_rooms
 WHERE image_id IN (SELECT id FROM images WHERE inspiration_scope = 'home');

-- S3a: Promote to LEVEL scope — lower_level coverage
UPDATE images
   SET inspiration_scope = 'level',
       scope_floor_id = (SELECT id FROM floors WHERE key = 'lower_level')
 WHERE inspiration_scope = 'room'
   AND photo_category = 'inspirational'
   AND id IN (
       SELECT iir.image_id
         FROM inspirational_image_rooms iir
         JOIN rooms r ON r.id = iir.room_id AND r.is_active = 1
                      AND r.floor_id = (SELECT id FROM floors WHERE key = 'lower_level')
        GROUP BY iir.image_id
       HAVING COUNT(DISTINCT iir.room_id) = (
              SELECT COUNT(*) FROM rooms r2
               WHERE r2.is_active = 1
                 AND r2.floor_id = (SELECT id FROM floors WHERE key = 'lower_level')
       )
   )
   AND id NOT IN (
       SELECT iir2.image_id
         FROM inspirational_image_rooms iir2
         JOIN rooms r3 ON r3.id = iir2.room_id AND r3.is_active = 1
        WHERE r3.floor_id != (SELECT id FROM floors WHERE key = 'lower_level')
   );

-- S3b: Promote to LEVEL scope — upper_level coverage
UPDATE images
   SET inspiration_scope = 'level',
       scope_floor_id = (SELECT id FROM floors WHERE key = 'upper_level')
 WHERE inspiration_scope = 'room'
   AND photo_category = 'inspirational'
   AND id IN (
       SELECT iir.image_id
         FROM inspirational_image_rooms iir
         JOIN rooms r ON r.id = iir.room_id AND r.is_active = 1
                      AND r.floor_id = (SELECT id FROM floors WHERE key = 'upper_level')
        GROUP BY iir.image_id
       HAVING COUNT(DISTINCT iir.room_id) = (
              SELECT COUNT(*) FROM rooms r2
               WHERE r2.is_active = 1
                 AND r2.floor_id = (SELECT id FROM floors WHERE key = 'upper_level')
       )
   )
   AND id NOT IN (
       SELECT iir2.image_id
         FROM inspirational_image_rooms iir2
         JOIN rooms r3 ON r3.id = iir2.room_id AND r3.is_active = 1
        WHERE r3.floor_id != (SELECT id FROM floors WHERE key = 'upper_level')
   );

-- S3c: Promote to LEVEL scope — outside coverage
UPDATE images
   SET inspiration_scope = 'level',
       scope_floor_id = (SELECT id FROM floors WHERE key = 'outside')
 WHERE inspiration_scope = 'room'
   AND photo_category = 'inspirational'
   AND id IN (
       SELECT iir.image_id
         FROM inspirational_image_rooms iir
         JOIN rooms r ON r.id = iir.room_id AND r.is_active = 1
                      AND r.floor_id = (SELECT id FROM floors WHERE key = 'outside')
        GROUP BY iir.image_id
       HAVING COUNT(DISTINCT iir.room_id) = (
              SELECT COUNT(*) FROM rooms r2
               WHERE r2.is_active = 1
                 AND r2.floor_id = (SELECT id FROM floors WHERE key = 'outside')
       )
   )
   AND id NOT IN (
       SELECT iir2.image_id
         FROM inspirational_image_rooms iir2
         JOIN rooms r3 ON r3.id = iir2.room_id AND r3.is_active = 1
        WHERE r3.floor_id != (SELECT id FROM floors WHERE key = 'outside')
   );

-- S3d: Delete per-room rows for level-scoped images (no longer needed)
DELETE FROM inspirational_image_rooms
 WHERE image_id IN (SELECT id FROM images WHERE inspiration_scope = 'level');


-- =============================================================================
-- SECTION 5: VERIFY
-- Run these SELECT statements after executing the script to confirm final state.
-- =============================================================================

-- V1: All source rooms must now be is_active=0
-- Expected: every row returned has is_active=0
SELECT id, room_code, is_active
  FROM rooms
 WHERE id IN (
       -- OLD rooms merged into final targets
       1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19,
       -- OLD rooms deactivated (no photos)
       5, 20,
       -- GHOST rooms merged away
       2330293, 2330294, 2330295, 2330296, 2330297, 2330298, 2330299, 2330300, 2330301
 )
 ORDER BY id;

-- V2: No photos must remain on any is_active=0 room
-- Expected: 0 rows returned
SELECT r.id, r.room_code,
       COUNT(DISTINCT i.id)   AS listing_images,
       COUNT(DISTINCT iir.id) AS inspiration_rows
  FROM rooms r
  LEFT JOIN images i ON i.room_id = r.id
  LEFT JOIN inspirational_image_rooms iir ON iir.room_id = r.id
 WHERE r.is_active = 0
 GROUP BY r.id, r.room_code
HAVING listing_images > 0 OR inspiration_rows > 0;

-- V3: Expected active room count
-- Expected: 19
--   15 final-code rooms + lower-family-room(2) + lower-laundry(4) + lower-garage(6) + upper-lightwell(18)
SELECT COUNT(*) AS active_room_count FROM rooms WHERE is_active = 1;

-- V4: All active rooms with their coordinates
SELECT room_code, floorplan_floor_key, floorplan_x_pct, floorplan_y_pct, is_active
  FROM rooms
 WHERE is_active = 1
 ORDER BY floorplan_floor_key, floorplan_y_pct;

-- V5: outside-backyard must have NULL x/y (intentionally unplaced)
SELECT room_code, floorplan_x_pct, floorplan_y_pct
  FROM rooms
 WHERE room_code = 'outside-backyard';

-- V6: Verify photo split — street-front-door must have only the 2 allowlisted images
SELECT r.room_code, COUNT(i.id) AS listing_count
  FROM rooms r
  LEFT JOIN images i ON i.room_id = r.id AND i.photo_category = 'listing'
 WHERE r.room_code IN ('street-front-door', 'lower-foyer')
 GROUP BY r.room_code;

-- V7: Confirm allowlisted images are on street-front-door (not foyer or elsewhere)
SELECT i.id, r.room_code
  FROM images i
  JOIN rooms r ON r.id = i.room_id
 WHERE i.id IN (
     'fd965547-fe96-4d7a-9a2e-321c0e05f852',
     '4ce41f86-905a-4efe-babd-98c0c47063d1'
 );

-- V8: Confirm dining/stair split images landed on the correct rooms
SELECT i.id, r.room_code
  FROM images i
  JOIN rooms r ON r.id = i.room_id
 WHERE i.id IN (
     'ce4f317d-a95e-470c-81ba-a1838a75fb4d',
     '4ac13ec3-c491-4662-b87a-1b9d2fd77c63',
     '22cef674-571f-4416-b97e-d4b7dc3a4763',
     'a2a0d96c-5247-4406-9cc4-c70a857662f7'
 );

-- V9: Scope conversion summary
-- Expected: home + level images have no per-room rows (S2b + S3d deleted them)
SELECT inspiration_scope, COUNT(*) AS image_count
  FROM images
 WHERE photo_category = 'inspirational'
 GROUP BY inspiration_scope
 ORDER BY inspiration_scope;

-- V10: No level-scoped image should have null scope_floor_id
-- Expected: 0 rows
SELECT id, inspiration_scope, scope_floor_id
  FROM images
 WHERE inspiration_scope = 'level'
   AND scope_floor_id IS NULL;

-- V11: No home/level-scoped image should still have per-room rows
-- Expected: 0 rows
SELECT i.id, i.inspiration_scope, COUNT(iir.id) AS orphan_rows
  FROM images i
  JOIN inspirational_image_rooms iir ON iir.image_id = i.id
 WHERE i.inspiration_scope IN ('home', 'level')
 GROUP BY i.id, i.inspiration_scope
HAVING orphan_rows > 0;

-- V12: Photo counts per final active room
SELECT r.room_code, r.id, r.is_active,
       COUNT(DISTINCT i.id)   AS listing_count,
       COUNT(DISTINCT iir.id) AS room_scoped_insp_count
  FROM rooms r
  LEFT JOIN images i ON i.room_id = r.id AND i.photo_category = 'listing'
  LEFT JOIN inspirational_image_rooms iir ON iir.room_id = r.id
 WHERE r.is_active = 1
 GROUP BY r.id, r.room_code
 ORDER BY r.room_code;

-- V13: Kept-old rooms have coords (id=2,4,6,18)
SELECT id, room_code, floorplan_floor_key, floorplan_x_pct, floorplan_y_pct, is_active
  FROM rooms
 WHERE id IN (2, 4, 6, 18);
