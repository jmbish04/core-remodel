-- budget_tracker_item_rooms seed
-- Maps budget_tracker_items → rooms based on the item titles.
-- Run: npx wrangler d1 execute DB --remote --file=seed-budget-room-mappings.sql

-- ── Backyard items (1-4, 7, 27, 28) → outside-backyard (id=3284734) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (1, 3284734);  -- French drains across backyard
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (2, 3284734);  -- Side-yard foundation drain
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (3, 3284734);  -- Sump pump relocation
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (4, 3284734);  -- Sewer lateral extension
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (7, 3284734);  -- Optional backyard utility rough-ins
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (27, 3284734); -- Landscape reserve
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (28, 3284734); -- Backyard hardscape + planter

-- ── Patio items (5, 6) → outside-patio (id=3284733) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (5, 3284733);  -- Patio cinder-block wall removal
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (6, 3284733);  -- Patio roof support post

-- ── Whole-house structural / architectural (8, 9, 10) → lower-family-room (id=2) as the center wall ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (8, 2);        -- Structural engineer study (center wall)
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (10, 2);       -- Structural feasibility center wall (downstairs)

-- Item 9 (Architectural planning + permit strategy) is whole-house — map to multiple rooms
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 3284740);  -- arch planning → Kitchen
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 3284744);  -- arch planning → Primary Bathroom
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (9, 2);        -- arch planning → Family Room (center wall)

-- ── Kitchen items (11-16, 18) → upper-kitchen (id=3284740) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (11, 3284740); -- Kitchen decision gate
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (12, 3284740); -- Kitchen option A
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (13, 3284740); -- Kitchen option B
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (14, 3284740); -- Kitchen option C
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (15, 3284740); -- Kitchen option D
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (16, 3284740); -- Kitchen option E
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (18, 3284740); -- Demo existing upstairs kitchen

-- Kitchen option B also maps to guest bedroom (downstairs north-side)
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (13, 3284726); -- Kitchen option B → Guest Bedroom

-- ── Upstairs hardwood (17) → Living Room + Dining Room + Stair Landing ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (17, 3284738); -- Hardwood → Living Room
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (17, 3284739); -- Hardwood → Dining Room
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (17, 3284743); -- Hardwood → Stair Landing

-- ── Primary bathroom (19) → primary-bathroom (id=3284744) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (19, 3284744); -- Primary suite bathroom remodel

-- ── Hall bathroom (20) → upper-hall-bath (id=3284741) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (20, 3284741); -- Hall bathroom remodel

-- ── Guest bathroom (21) → lower-guest-bath (id=3284728) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (21, 3284728); -- Guest bathroom downstairs

-- ── Laundry (22) → lower-laundry (id=4) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (22, 4);       -- Laundry relocation

-- ── Downstairs openings (23) → lower-family-room (id=2) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (23, 2);       -- Slider expansion + serving window

-- ── Windows (24) — whole-house, map to key rooms ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (24, 3284738); -- Windows → Living Room
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (24, 3284735); -- Windows → Primary Bedroom
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (24, 2);       -- Windows → Family Room

-- ── Skylight / lightwell (25) → upper-lightwell (id=18) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (25, 18);      -- Skylight code compliance

-- ── Front door (26) → street-front-door (id=3284731) + lower-foyer (id=3284732) ──
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (26, 3284731); -- Front-door push-out → Front Door
INSERT INTO budget_tracker_item_rooms (budget_tracker_item_id, room_id) VALUES (26, 3284732); -- Front-door push-out → Foyer
