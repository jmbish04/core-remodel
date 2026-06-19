-- =============================================================================
-- 0005-reconcile-rooms.sql
-- Feature 0005 — Room Data Reconciliation (SQL equivalent of .ts script)
-- =============================================================================
-- Idempotent SQL data-fix encoding IMPLEMENTATION_PLAN §4.1 (L1–L8, U1–U10)
-- and §4.2 (coordinate seed).  Every statement is guarded so re-runs are safe.
--
-- Usage (orchestrator-gated, after backup + dry-run on local):
--   1.  wrangler d1 export DB --remote --output=backup-pre-0005.sql
--   2.  wrangler d1 execute DB --local --file=scripts/0005-reconcile-rooms.sql  (test)
--   3.  wrangler d1 execute DB --remote --file=scripts/0005-reconcile-rooms.sql  (prod)
--
-- NOTE: The 2 duplicate image hard-deletes (4a06d3af, 1343677a) are NOT in
-- this SQL file because they also require deleting the Cloudflare Images asset.
-- Those must be handled via the Worker API:
--   curl -X DELETE https://<worker>/api/images/4a06d3af-d8ac-4577-87bb-32a228175898 -H "Authorization: Bearer <token>"
--   curl -X DELETE https://<worker>/api/images/1343677a-db36-4252-85d6-e965dd9c2779 -H "Authorization: Bearer <token>"
-- After the API calls succeed, the D1 rows will already be gone (the API deletes them).
-- If you need to remove D1 rows only (CF asset already cleaned):
--   DELETE FROM inspirational_image_rooms WHERE image_id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');
--   DELETE FROM images WHERE id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');
-- =============================================================================

-- Helper: verified live IDs
-- Canonical rooms: 1–20
-- Drift rooms: 2330293–2330301
-- Outside floor: id=233121, key='outside'
-- Upper floor:   key='upper_level'
-- Lower floor:   key='lower_level'

-- =============================================================================
-- SECTION 1: LOWER LEVEL
-- =============================================================================

-- L1: Rename lower-bedroom-1 (id=1) → lower-guest-bedroom / "Guest Bedroom"
UPDATE rooms
   SET room_code = 'lower-guest-bedroom',
       room_name = 'Guest Bedroom'
 WHERE id = 1
   AND room_code != 'lower-guest-bedroom';  -- idempotent guard

-- L1b: Merge guest_bedroom (id=2330298) → lower-guest-bedroom (id=1)
-- (0 photos on drift room; just repoint and delete)
UPDATE images               SET room_id = 1 WHERE room_id = 2330298;
UPDATE listing_photos       SET room_id = 1 WHERE room_id = 2330298;
UPDATE planning_tasks       SET room_id = 1 WHERE room_id = 2330298;
UPDATE room_action_items    SET room_id = 1 WHERE room_id = 2330298;
UPDATE scenario_room_plans  SET room_id = 1 WHERE room_id = 2330298;
UPDATE budget_tracker_item_rooms SET room_id = 1 WHERE room_id = 2330298;
UPDATE standard_costs       SET room_id = 1 WHERE room_id = 2330298;
UPDATE estimate_room_mappings SET room_id = 1 WHERE room_id = 2330298;
UPDATE bid_portfolio_room_configs SET room_id = 1 WHERE room_id = 2330298;
UPDATE bid_portfolio_comments SET room_id = 1 WHERE room_id = 2330298;
UPDATE bid_portfolio_selected_photos SET room_id = 1 WHERE room_id = 2330298;
UPDATE render_canvases      SET room_id = 1 WHERE room_id = 2330298;
UPDATE render_sessions      SET room_id = 1 WHERE room_id = 2330298;
UPDATE mood_board_generations SET room_id = 1 WHERE room_id = 2330298;
UPDATE room_material_quotes SET room_id = 1 WHERE room_id = 2330298;
UPDATE vision_node_room_mappings SET room_id = 1
 WHERE room_id = 2330298
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 1);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330298;
UPDATE checklist_room_mappings SET room_id = 1
 WHERE room_id = 2330298
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 1);
DELETE FROM checklist_room_mappings WHERE room_id = 2330298;
UPDATE supporting_document_room_mappings SET room_id = 1
 WHERE room_id = 2330298
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 1);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330298;
-- inspirational_image_rooms: skip conflicts, delete dupes, repoint rest
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330298
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 1);
UPDATE inspirational_image_rooms SET room_id = 1 WHERE room_id = 2330298;
-- room_ai_summaries: keep target's row (or most recent)
DELETE FROM room_ai_summaries
 WHERE room_id = 2330298
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 1);
UPDATE room_ai_summaries SET room_id = 1
 WHERE room_id = 2330298
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 1);
-- Delete source room
DELETE FROM rooms WHERE id = 2330298;

-- L2: Merge living_room (id=2330299) → lower-family-room (id=2)
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
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 2);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330299;
UPDATE checklist_room_mappings SET room_id = 2
 WHERE room_id = 2330299
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 2);
DELETE FROM checklist_room_mappings WHERE room_id = 2330299;
UPDATE supporting_document_room_mappings SET room_id = 2
 WHERE room_id = 2330299
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 2);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330299;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330299
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 2);
UPDATE inspirational_image_rooms SET room_id = 2 WHERE room_id = 2330299;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330299
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 2);
UPDATE room_ai_summaries SET room_id = 2
 WHERE room_id = 2330299
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 2);
DELETE FROM rooms WHERE id = 2330299;

-- L3: Rename lower-bath-1 (id=3) → lower-guest-bath / "Guest Bath"
UPDATE rooms
   SET room_code = 'lower-guest-bath',
       room_name = 'Guest Bath'
 WHERE id = 3
   AND room_code != 'lower-guest-bath';

-- L3b: Merge guest_bathroom (id=2330296) → lower-guest-bath (id=3)
UPDATE images               SET room_id = 3 WHERE room_id = 2330296;
UPDATE listing_photos       SET room_id = 3 WHERE room_id = 2330296;
UPDATE planning_tasks       SET room_id = 3 WHERE room_id = 2330296;
UPDATE room_action_items    SET room_id = 3 WHERE room_id = 2330296;
UPDATE scenario_room_plans  SET room_id = 3 WHERE room_id = 2330296;
UPDATE budget_tracker_item_rooms SET room_id = 3 WHERE room_id = 2330296;
UPDATE standard_costs       SET room_id = 3 WHERE room_id = 2330296;
UPDATE estimate_room_mappings SET room_id = 3 WHERE room_id = 2330296;
UPDATE bid_portfolio_room_configs SET room_id = 3 WHERE room_id = 2330296;
UPDATE bid_portfolio_comments SET room_id = 3 WHERE room_id = 2330296;
UPDATE bid_portfolio_selected_photos SET room_id = 3 WHERE room_id = 2330296;
UPDATE render_canvases      SET room_id = 3 WHERE room_id = 2330296;
UPDATE render_sessions      SET room_id = 3 WHERE room_id = 2330296;
UPDATE mood_board_generations SET room_id = 3 WHERE room_id = 2330296;
UPDATE room_material_quotes SET room_id = 3 WHERE room_id = 2330296;
UPDATE vision_node_room_mappings SET room_id = 3
 WHERE room_id = 2330296
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 3);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330296;
UPDATE checklist_room_mappings SET room_id = 3
 WHERE room_id = 2330296
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 3);
DELETE FROM checklist_room_mappings WHERE room_id = 2330296;
UPDATE supporting_document_room_mappings SET room_id = 3
 WHERE room_id = 2330296
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 3);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330296;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330296
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 3);
UPDATE inspirational_image_rooms SET room_id = 3 WHERE room_id = 2330296;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330296
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3);
UPDATE room_ai_summaries SET room_id = 3
 WHERE room_id = 2330296
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 3);
DELETE FROM rooms WHERE id = 2330296;

-- L4: Rename lower-patio (id=8) → outside-patio / "Patio", move floor → outside (233121)
UPDATE rooms
   SET room_code = 'outside-patio',
       room_name = 'Patio',
       floor_id = 233121,
       floorplan_floor_key = 'outside'
 WHERE id = 8
   AND room_code != 'outside-patio';

-- L4b: Merge lower-rear-patio (id=9) → outside-patio (id=8)
UPDATE images               SET room_id = 8 WHERE room_id = 9;
UPDATE listing_photos       SET room_id = 8 WHERE room_id = 9;
UPDATE planning_tasks       SET room_id = 8 WHERE room_id = 9;
UPDATE room_action_items    SET room_id = 8 WHERE room_id = 9;
UPDATE scenario_room_plans  SET room_id = 8 WHERE room_id = 9;
UPDATE budget_tracker_item_rooms SET room_id = 8 WHERE room_id = 9;
UPDATE standard_costs       SET room_id = 8 WHERE room_id = 9;
UPDATE estimate_room_mappings SET room_id = 8 WHERE room_id = 9;
UPDATE bid_portfolio_room_configs SET room_id = 8 WHERE room_id = 9;
UPDATE bid_portfolio_comments SET room_id = 8 WHERE room_id = 9;
UPDATE bid_portfolio_selected_photos SET room_id = 8 WHERE room_id = 9;
UPDATE render_canvases      SET room_id = 8 WHERE room_id = 9;
UPDATE render_sessions      SET room_id = 8 WHERE room_id = 9;
UPDATE mood_board_generations SET room_id = 8 WHERE room_id = 9;
UPDATE room_material_quotes SET room_id = 8 WHERE room_id = 9;
UPDATE vision_node_room_mappings SET room_id = 8
 WHERE room_id = 9
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 8);
DELETE FROM vision_node_room_mappings WHERE room_id = 9;
UPDATE checklist_room_mappings SET room_id = 8
 WHERE room_id = 9
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 8);
DELETE FROM checklist_room_mappings WHERE room_id = 9;
UPDATE supporting_document_room_mappings SET room_id = 8
 WHERE room_id = 9
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 8);
DELETE FROM supporting_document_room_mappings WHERE room_id = 9;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 9
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 8);
UPDATE inspirational_image_rooms SET room_id = 8 WHERE room_id = 9;
DELETE FROM room_ai_summaries
 WHERE room_id = 9
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 8);
UPDATE room_ai_summaries SET room_id = 8
 WHERE room_id = 9
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 8);
DELETE FROM rooms WHERE id = 9;

-- L5: Rename lower-backyard (id=10) → outside-backyard / "Backyard", floor → outside
UPDATE rooms
   SET room_code = 'outside-backyard',
       room_name = 'Backyard',
       floor_id = 233121,
       floorplan_floor_key = 'outside'
 WHERE id = 10
   AND room_code != 'outside-backyard';

-- L5b: Merge drift backyard (id=2330301) → outside-backyard (id=10)
UPDATE images               SET room_id = 10 WHERE room_id = 2330301;
UPDATE listing_photos       SET room_id = 10 WHERE room_id = 2330301;
UPDATE planning_tasks       SET room_id = 10 WHERE room_id = 2330301;
UPDATE room_action_items    SET room_id = 10 WHERE room_id = 2330301;
UPDATE scenario_room_plans  SET room_id = 10 WHERE room_id = 2330301;
UPDATE budget_tracker_item_rooms SET room_id = 10 WHERE room_id = 2330301;
UPDATE standard_costs       SET room_id = 10 WHERE room_id = 2330301;
UPDATE estimate_room_mappings SET room_id = 10 WHERE room_id = 2330301;
UPDATE bid_portfolio_room_configs SET room_id = 10 WHERE room_id = 2330301;
UPDATE bid_portfolio_comments SET room_id = 10 WHERE room_id = 2330301;
UPDATE bid_portfolio_selected_photos SET room_id = 10 WHERE room_id = 2330301;
UPDATE render_canvases      SET room_id = 10 WHERE room_id = 2330301;
UPDATE render_sessions      SET room_id = 10 WHERE room_id = 2330301;
UPDATE mood_board_generations SET room_id = 10 WHERE room_id = 2330301;
UPDATE room_material_quotes SET room_id = 10 WHERE room_id = 2330301;
UPDATE vision_node_room_mappings SET room_id = 10
 WHERE room_id = 2330301
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 10);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330301;
UPDATE checklist_room_mappings SET room_id = 10
 WHERE room_id = 2330301
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 10);
DELETE FROM checklist_room_mappings WHERE room_id = 2330301;
UPDATE supporting_document_room_mappings SET room_id = 10
 WHERE room_id = 2330301
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 10);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330301;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330301
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 10);
UPDATE inspirational_image_rooms SET room_id = 10 WHERE room_id = 2330301;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330301
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 10);
UPDATE room_ai_summaries SET room_id = 10
 WHERE room_id = 2330301
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 10);
DELETE FROM rooms WHERE id = 2330301;

-- L7 (before L6): Rename entry_foyer (id=2330294) → lower-foyer / "Foyer"
-- Must happen before L6 photo split so lower-foyer exists as the target.
UPDATE rooms
   SET room_code = 'lower-foyer',
       room_name = 'Foyer'
 WHERE id = 2330294
   AND room_code != 'lower-foyer';

-- L6: Rename lower-entryway (id=7) → street-front-door / "Front Door / Street"
UPDATE rooms
   SET room_code = 'street-front-door',
       room_name = 'Front Door / Street'
 WHERE id = 7
   AND room_code != 'street-front-door';

-- L6 photo split (listing images): move all of room 7's listing photos to lower-foyer
-- EXCEPT the 2 allowlisted exterior images.
UPDATE images
   SET room_id = 2330294
 WHERE room_id = 7
   AND id NOT IN (
       'fd965547-fe96-4d7a-9a2e-321c0e05f852',
       '4ce41f86-905a-4efe-babd-98c0c47063d1'
   );

-- L6 photo split (inspiration mappings): move non-allowlisted insp from room 7 → lower-foyer
-- Step 1: add to lower-foyer (skip conflicts)
INSERT OR IGNORE INTO inspirational_image_rooms (image_id, room_id)
SELECT image_id, 2330294
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

-- L8: Delete lower-storage (id=5, no photos)
DELETE FROM rooms WHERE id = 5;

-- =============================================================================
-- SECTION 2: UPPER LEVEL
-- =============================================================================

-- U1: Rename upper-primary-bedroom (id=11) → primary-bedroom / "Primary Bedroom"
UPDATE rooms
   SET room_code = 'primary-bedroom',
       room_name = 'Primary Bedroom'
 WHERE id = 11
   AND room_code != 'primary-bedroom';

-- U2: Rename drift primary_bathroom (id=2330293) → primary-bathroom / "Primary Bathroom"
UPDATE rooms
   SET room_code = 'primary-bathroom',
       room_name = 'Primary Bathroom'
 WHERE id = 2330293
   AND room_code != 'primary-bathroom';

-- U2b: Merge upper-bath-2 (id=17, coord donor) → primary-bathroom (id=2330293)
UPDATE images               SET room_id = 2330293 WHERE room_id = 17;
UPDATE listing_photos       SET room_id = 2330293 WHERE room_id = 17;
UPDATE planning_tasks       SET room_id = 2330293 WHERE room_id = 17;
UPDATE room_action_items    SET room_id = 2330293 WHERE room_id = 17;
UPDATE scenario_room_plans  SET room_id = 2330293 WHERE room_id = 17;
UPDATE budget_tracker_item_rooms SET room_id = 2330293 WHERE room_id = 17;
UPDATE standard_costs       SET room_id = 2330293 WHERE room_id = 17;
UPDATE estimate_room_mappings SET room_id = 2330293 WHERE room_id = 17;
UPDATE bid_portfolio_room_configs SET room_id = 2330293 WHERE room_id = 17;
UPDATE bid_portfolio_comments SET room_id = 2330293 WHERE room_id = 17;
UPDATE bid_portfolio_selected_photos SET room_id = 2330293 WHERE room_id = 17;
UPDATE render_canvases      SET room_id = 2330293 WHERE room_id = 17;
UPDATE render_sessions      SET room_id = 2330293 WHERE room_id = 17;
UPDATE mood_board_generations SET room_id = 2330293 WHERE room_id = 17;
UPDATE room_material_quotes SET room_id = 2330293 WHERE room_id = 17;
UPDATE vision_node_room_mappings SET room_id = 2330293
 WHERE room_id = 17
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 2330293);
DELETE FROM vision_node_room_mappings WHERE room_id = 17;
UPDATE checklist_room_mappings SET room_id = 2330293
 WHERE room_id = 17
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 2330293);
DELETE FROM checklist_room_mappings WHERE room_id = 17;
UPDATE supporting_document_room_mappings SET room_id = 2330293
 WHERE room_id = 17
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 2330293);
DELETE FROM supporting_document_room_mappings WHERE room_id = 17;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 17
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 2330293);
UPDATE inspirational_image_rooms SET room_id = 2330293 WHERE room_id = 17;
DELETE FROM room_ai_summaries
 WHERE room_id = 17
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 2330293);
UPDATE room_ai_summaries SET room_id = 2330293
 WHERE room_id = 17
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 2330293);
DELETE FROM rooms WHERE id = 17;

-- U3: Rename upper-bedroom-2 (id=12) → jason-office / "Jason's Office"
UPDATE rooms
   SET room_code = 'jason-office',
       room_name = 'Jason''s Office'
 WHERE id = 12
   AND room_code != 'jason-office';

-- U4: Rename upper-bedroom-3 (id=13) → justin-office / "Justin's Office"
UPDATE rooms
   SET room_code = 'justin-office',
       room_name = 'Justin''s Office'
 WHERE id = 13
   AND room_code != 'justin-office';

-- U5: Rename upper-living-dining (id=14) → upper-living-room / "Living Room"
UPDATE rooms
   SET room_code = 'upper-living-room',
       room_name = 'Living Room'
 WHERE id = 14
   AND room_code != 'upper-living-room';

-- U5b: Create upper-dining-room (new room, upper_level floor)
-- onConflict guard: only insert if room_code doesn't already exist.
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, as_is_use, is_living_space,
                              floorplan_floor_key, floorplan_x_pct, floorplan_y_pct)
SELECT f.id, 'upper-dining-room', 'Dining Room', 'Dining Room', 1,
       'upper_level', 84.0, 62.0
  FROM floors f
 WHERE f.key = 'upper_level'
   AND NOT EXISTS (SELECT 1 FROM rooms WHERE room_code = 'upper-dining-room');

-- U5b: Move listing images ce4f317d + 4ac13ec3 from room 14 → upper-dining-room
UPDATE images
   SET room_id = (SELECT id FROM rooms WHERE room_code = 'upper-dining-room')
 WHERE id IN (
     'ce4f317d-a95e-470c-81ba-a1838a75fb4d',
     '4ac13ec3-c491-4662-b87a-1b9d2fd77c63'
 )
   AND room_id = 14;  -- idempotent: only move if still on room 14

-- U5c: Merge family_room (id=2330300) → upper-living-room (id=14)
UPDATE images               SET room_id = 14 WHERE room_id = 2330300;
UPDATE listing_photos       SET room_id = 14 WHERE room_id = 2330300;
UPDATE planning_tasks       SET room_id = 14 WHERE room_id = 2330300;
UPDATE room_action_items    SET room_id = 14 WHERE room_id = 2330300;
UPDATE scenario_room_plans  SET room_id = 14 WHERE room_id = 2330300;
UPDATE budget_tracker_item_rooms SET room_id = 14 WHERE room_id = 2330300;
UPDATE standard_costs       SET room_id = 14 WHERE room_id = 2330300;
UPDATE estimate_room_mappings SET room_id = 14 WHERE room_id = 2330300;
UPDATE bid_portfolio_room_configs SET room_id = 14 WHERE room_id = 2330300;
UPDATE bid_portfolio_comments SET room_id = 14 WHERE room_id = 2330300;
UPDATE bid_portfolio_selected_photos SET room_id = 14 WHERE room_id = 2330300;
UPDATE render_canvases      SET room_id = 14 WHERE room_id = 2330300;
UPDATE render_sessions      SET room_id = 14 WHERE room_id = 2330300;
UPDATE mood_board_generations SET room_id = 14 WHERE room_id = 2330300;
UPDATE room_material_quotes SET room_id = 14 WHERE room_id = 2330300;
UPDATE vision_node_room_mappings SET room_id = 14
 WHERE room_id = 2330300
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 14);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330300;
UPDATE checklist_room_mappings SET room_id = 14
 WHERE room_id = 2330300
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 14);
DELETE FROM checklist_room_mappings WHERE room_id = 2330300;
UPDATE supporting_document_room_mappings SET room_id = 14
 WHERE room_id = 2330300
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 14);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330300;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330300
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 14);
UPDATE inspirational_image_rooms SET room_id = 14 WHERE room_id = 2330300;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330300
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 14);
UPDATE room_ai_summaries SET room_id = 14
 WHERE room_id = 2330300
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 14);
DELETE FROM rooms WHERE id = 2330300;

-- U5d: Hard-delete duplicates — SEE FILE HEADER for Worker API command.
-- D1-only fallback (if CF asset already cleaned or orphaned):
-- DELETE FROM inspirational_image_rooms WHERE image_id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');
-- DELETE FROM images WHERE id IN ('4a06d3af-d8ac-4577-87bb-32a228175898','1343677a-db36-4252-85d6-e965dd9c2779');

-- U10 (before U6): Rename upper-workshop (id=19) → upper-stair-landing
UPDATE rooms
   SET room_code = 'upper-stair-landing',
       room_name = 'Stair Landing'
 WHERE id = 19
   AND room_code != 'upper-stair-landing';

-- U10: Move images 22cef674 + a2a0d96c from upper-living-room (14) → upper-stair-landing (19)
UPDATE images
   SET room_id = 19
 WHERE id IN (
     '22cef674-571f-4416-b97e-d4b7dc3a4763',
     'a2a0d96c-5247-4406-9cc4-c70a857662f7'
 )
   AND room_id = 14;  -- idempotent guard

-- U6: Rename upper-bath-1 (id=16) → upper-hall-bath / "Hall Bath"
UPDATE rooms
   SET room_code = 'upper-hall-bath',
       room_name = 'Hall Bath'
 WHERE id = 16
   AND room_code != 'upper-hall-bath';

-- U6b: Merge hall_bathroom (id=2330297) → upper-hall-bath (id=16)
UPDATE images               SET room_id = 16 WHERE room_id = 2330297;
UPDATE listing_photos       SET room_id = 16 WHERE room_id = 2330297;
UPDATE planning_tasks       SET room_id = 16 WHERE room_id = 2330297;
UPDATE room_action_items    SET room_id = 16 WHERE room_id = 2330297;
UPDATE scenario_room_plans  SET room_id = 16 WHERE room_id = 2330297;
UPDATE budget_tracker_item_rooms SET room_id = 16 WHERE room_id = 2330297;
UPDATE standard_costs       SET room_id = 16 WHERE room_id = 2330297;
UPDATE estimate_room_mappings SET room_id = 16 WHERE room_id = 2330297;
UPDATE bid_portfolio_room_configs SET room_id = 16 WHERE room_id = 2330297;
UPDATE bid_portfolio_comments SET room_id = 16 WHERE room_id = 2330297;
UPDATE bid_portfolio_selected_photos SET room_id = 16 WHERE room_id = 2330297;
UPDATE render_canvases      SET room_id = 16 WHERE room_id = 2330297;
UPDATE render_sessions      SET room_id = 16 WHERE room_id = 2330297;
UPDATE mood_board_generations SET room_id = 16 WHERE room_id = 2330297;
UPDATE room_material_quotes SET room_id = 16 WHERE room_id = 2330297;
UPDATE vision_node_room_mappings SET room_id = 16
 WHERE room_id = 2330297
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 16);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330297;
UPDATE checklist_room_mappings SET room_id = 16
 WHERE room_id = 2330297
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 16);
DELETE FROM checklist_room_mappings WHERE room_id = 2330297;
UPDATE supporting_document_room_mappings SET room_id = 16
 WHERE room_id = 2330297
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 16);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330297;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330297
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 16);
UPDATE inspirational_image_rooms SET room_id = 16 WHERE room_id = 2330297;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330297
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 16);
UPDATE room_ai_summaries SET room_id = 16
 WHERE room_id = 2330297
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 16);
DELETE FROM rooms WHERE id = 2330297;

-- U7: Rename upper-kitchen-breakfast (id=15) → upper-kitchen / "Kitchen"
UPDATE rooms
   SET room_code = 'upper-kitchen',
       room_name = 'Kitchen'
 WHERE id = 15
   AND room_code != 'upper-kitchen';

-- U7b: Merge drift kitchen (id=2330295) → upper-kitchen (id=15)  [71 insp photos]
UPDATE images               SET room_id = 15 WHERE room_id = 2330295;
UPDATE listing_photos       SET room_id = 15 WHERE room_id = 2330295;
UPDATE planning_tasks       SET room_id = 15 WHERE room_id = 2330295;
UPDATE room_action_items    SET room_id = 15 WHERE room_id = 2330295;
UPDATE scenario_room_plans  SET room_id = 15 WHERE room_id = 2330295;
UPDATE budget_tracker_item_rooms SET room_id = 15 WHERE room_id = 2330295;
UPDATE standard_costs       SET room_id = 15 WHERE room_id = 2330295;
UPDATE estimate_room_mappings SET room_id = 15 WHERE room_id = 2330295;
UPDATE bid_portfolio_room_configs SET room_id = 15 WHERE room_id = 2330295;
UPDATE bid_portfolio_comments SET room_id = 15 WHERE room_id = 2330295;
UPDATE bid_portfolio_selected_photos SET room_id = 15 WHERE room_id = 2330295;
UPDATE render_canvases      SET room_id = 15 WHERE room_id = 2330295;
UPDATE render_sessions      SET room_id = 15 WHERE room_id = 2330295;
UPDATE mood_board_generations SET room_id = 15 WHERE room_id = 2330295;
UPDATE room_material_quotes SET room_id = 15 WHERE room_id = 2330295;
UPDATE vision_node_room_mappings SET room_id = 15
 WHERE room_id = 2330295
   AND vision_node_id NOT IN (
       SELECT vision_node_id FROM vision_node_room_mappings WHERE room_id = 15);
DELETE FROM vision_node_room_mappings WHERE room_id = 2330295;
UPDATE checklist_room_mappings SET room_id = 15
 WHERE room_id = 2330295
   AND question_id NOT IN (
       SELECT question_id FROM checklist_room_mappings WHERE room_id = 15);
DELETE FROM checklist_room_mappings WHERE room_id = 2330295;
UPDATE supporting_document_room_mappings SET room_id = 15
 WHERE room_id = 2330295
   AND supporting_document_id NOT IN (
       SELECT supporting_document_id FROM supporting_document_room_mappings WHERE room_id = 2330295);
DELETE FROM supporting_document_room_mappings WHERE room_id = 2330295;
DELETE FROM inspirational_image_rooms
 WHERE room_id = 2330295
   AND image_id IN (
       SELECT image_id FROM inspirational_image_rooms WHERE room_id = 15);
UPDATE inspirational_image_rooms SET room_id = 15 WHERE room_id = 2330295;
DELETE FROM room_ai_summaries
 WHERE room_id = 2330295
   AND EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 15);
UPDATE room_ai_summaries SET room_id = 15
 WHERE room_id = 2330295
   AND NOT EXISTS (SELECT 1 FROM room_ai_summaries WHERE room_id = 15);
DELETE FROM rooms WHERE id = 2330295;

-- U9: Delete upper-deck (id=20, no photos)
DELETE FROM rooms WHERE id = 20;

-- =============================================================================
-- SECTION 3: COORDINATE SEED (§4.2)
-- Set floorplan_floor_key / floorplan_x_pct / floorplan_y_pct on all rooms.
-- =============================================================================

UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=33,   floorplan_y_pct=28   WHERE room_code='lower-guest-bedroom';
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=18,   floorplan_y_pct=34   WHERE room_code='lower-family-room';
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=34,   floorplan_y_pct=43   WHERE room_code='lower-guest-bath';
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=26,   floorplan_y_pct=49   WHERE room_code='lower-laundry';
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=25,   floorplan_y_pct=77   WHERE room_code='lower-garage';
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=7,    floorplan_y_pct=89   WHERE room_code='street-front-door';
UPDATE rooms SET floorplan_floor_key='lower_level', floorplan_x_pct=7,    floorplan_y_pct=52   WHERE room_code='lower-foyer';
UPDATE rooms SET floorplan_floor_key='outside',     floorplan_x_pct=27,   floorplan_y_pct=10   WHERE room_code='outside-patio';
UPDATE rooms SET floorplan_floor_key='outside',     floorplan_x_pct=NULL, floorplan_y_pct=NULL WHERE room_code='outside-backyard';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=82,   floorplan_y_pct=21   WHERE room_code='primary-bedroom';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=66,   floorplan_y_pct=52   WHERE room_code='jason-office';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=64,   floorplan_y_pct=21   WHERE room_code='justin-office';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=84,   floorplan_y_pct=72   WHERE room_code='upper-living-room';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=84,   floorplan_y_pct=62   WHERE room_code='upper-dining-room';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=65,   floorplan_y_pct=76   WHERE room_code='upper-kitchen';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=64,   floorplan_y_pct=32   WHERE room_code='upper-hall-bath';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=67,   floorplan_y_pct=39   WHERE room_code='upper-lightwell';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=78,   floorplan_y_pct=49   WHERE room_code='upper-stair-landing';
UPDATE rooms SET floorplan_floor_key='upper_level', floorplan_x_pct=88,   floorplan_y_pct=39   WHERE room_code='primary-bathroom';

-- =============================================================================
-- SECTION 4: VERIFY (run after script; expected outputs listed as comments)
-- =============================================================================
-- Run these SELECT statements after executing the script to confirm the final state.

-- Expected: 0 rows (all drift rooms gone)
SELECT id, room_code FROM rooms
 WHERE id IN (2330293, 2330294, 2330295, 2330296, 2330297, 2330298, 2330299, 2330300, 2330301);

-- Expected: 0 rows (deleted canonical rooms gone)
SELECT id, room_code FROM rooms WHERE id IN (5, 17, 20);

-- Expected: exactly 19 rooms in the final set (18 placed + outside-backyard unplaced)
SELECT room_code, floorplan_floor_key, floorplan_x_pct, floorplan_y_pct
  FROM rooms
 ORDER BY floorplan_floor_key, floorplan_y_pct;

-- Expected: outside-backyard has NULL x/y
SELECT room_code, floorplan_x_pct, floorplan_y_pct
  FROM rooms
 WHERE room_code = 'outside-backyard';

-- Expected: upper-dining-room at (84,62) upper_level
SELECT room_code, floorplan_x_pct, floorplan_y_pct, floorplan_floor_key
  FROM rooms
 WHERE room_code = 'upper-dining-room';

-- Count images per final room to verify photos landed correctly:
SELECT r.room_code, COUNT(i.id) AS listing_count
  FROM rooms r
  LEFT JOIN images i ON i.room_id = r.id AND i.photo_category = 'listing'
 GROUP BY r.id, r.room_code
 ORDER BY r.room_code;

SELECT r.room_code, COUNT(ir.id) AS inspiration_count
  FROM rooms r
  LEFT JOIN inspirational_image_rooms ir ON ir.room_id = r.id
 GROUP BY r.id, r.room_code
 ORDER BY r.room_code;
