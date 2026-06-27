-- Budget tracker corrections: permit strategy, kitchen options, new scenarios
-- Run: npx wrangler d1 execute DB --remote --file=seed-budget-corrections.sql

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. FIX item 9 "Architectural planning + permit strategy"
--    Bathrooms are OTC, most of the house is OTC.
--    Remove Primary Bathroom mapping. Add rooms that MAY need permits.
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM budget_tracker_item_rooms
WHERE budget_tracker_item_id = 9 AND room_id = 3284744;

INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 18);
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 4);
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 3284731);
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 3284738);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SIMPLIFY kitchen options to 2 real paths
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE budget_tracker_items SET is_active = 0, datetime_updated = unixepoch() WHERE id IN (11, 12, 13, 16);

UPDATE budget_tracker_items SET
  title = 'Kitchen option A: keep in-place, move sink to window side + resize/replace window',
  description = 'Keep kitchen in its current upstairs location. Move the kitchen sink over to the window wall, resize and replace the window for better light and counter space. OTC-friendly scope unless structural header work is needed for window resize.',
  option_key = 'keep_in_place_sink_window',
  datetime_updated = unixepoch()
WHERE id = 14;

UPDATE budget_tracker_items SET
  title = 'Kitchen option B: swap kitchen into living room, living room into kitchen space',
  description = 'Full room swap. Relocate kitchen into the current living room space and convert the existing kitchen area into the living room. Requires architectural planning, permits, plumbing relocation, electrical rough-in, and likely structural engineering for the wall between the two spaces.',
  option_key = 'swap_kitchen_living_room',
  datetime_updated = unixepoch()
WHERE id = 15;

INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (15, 3284738);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. NEW: Door between back two bedrooms (50/50 likelihood)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO budget_tracker_items (
  track_id, revision_number, is_active, is_draft,
  item_type, execution_class, option_group, option_key,
  title, description, status, risk_level,
  estimated_low_cents, estimated_high_cents,
  change_source, datetime_created, datetime_updated
) VALUES (
  '6f3a91c2-bd10-4e8f-a3c7-door-bedrooms',
  1, 1, 1,
  'project', 'option', 'bedroom_connectivity', 'door_between_back_bedrooms',
  'Add doorway between back two bedrooms (Jason + Justin offices)',
  '50/50 likelihood of proceeding. If we do it, 50/50 whether we need an architect. Depends on whether the wall is load-bearing. Would connect the two back bedrooms with a passage door.',
  'open', 'low',
  150000, 500000,
  'manual', unixepoch(), unixepoch()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. UPDATE descriptions for laundry, front door, lightwell
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE budget_tracker_items SET
  description = 'Relocate laundry from downstairs to upstairs with 220V refeed. Includes removing the laundry wall downstairs. TBD if structural engineer is needed for the wall removal depending on load-bearing assessment.',
  datetime_updated = unixepoch()
WHERE id = 22;

UPDATE budget_tracker_items SET
  description = 'Push the front door outward into the existing porch area to gain more floor space in the downstairs foyer/entry. TBD whether structural engineer and/or architect are required. Depends on porch roof integration and foundation scope.',
  datetime_updated = unixepoch()
WHERE id = 26;

UPDATE budget_tracker_items SET
  execution_class = 'option',
  description = 'Skylight code compliance study and possible light-well enclosure modifications. Very low likelihood of proceeding. Only if code requires changes or an opportunity presents itself during other work.',
  datetime_updated = unixepoch()
WHERE id = 25;
