-- Auto-generated seed-budget.sql
-- Run: npx wrangler d1 execute DB --local --file=seed-budget.sql
-- Run Remote: npx wrangler d1 execute DB --remote --file=seed-budget.sql

-- Clear new tables to prevent duplicate seed conflicts
DELETE FROM trade_data;
DELETE FROM standard_costs;
DELETE FROM static_budget_items;
DELETE FROM budget_variance_line_items;
DELETE FROM budget_variance_scenarios;
DELETE FROM assumption_line_items;
DELETE FROM assumption_micro_variances;
DELETE FROM project_system_variables;
DELETE FROM work_item_types;

-- Seed work_item_types
INSERT INTO work_item_types (key, name, description) VALUES ('baseboard', 'Baseboard', 'Renovation trade category for Baseboard');
INSERT INTO work_item_types (key, name, description) VALUES ('cabinetry', 'Cabinetry', 'Renovation trade category for Cabinetry');
INSERT INTO work_item_types (key, name, description) VALUES ('cleaning', 'Cleaning', 'Renovation trade category for Cleaning');
INSERT INTO work_item_types (key, name, description) VALUES ('contents', 'Contents', 'Renovation trade category for Contents');
INSERT INTO work_item_types (key, name, description) VALUES ('countertop', 'Countertop', 'Renovation trade category for Countertop');
INSERT INTO work_item_types (key, name, description) VALUES ('debris_removal', 'Debris Removal', 'Renovation trade category for Debris Removal');
INSERT INTO work_item_types (key, name, description) VALUES ('demolition', 'Demolition', 'Renovation trade category for Demolition');
INSERT INTO work_item_types (key, name, description) VALUES ('drywall', 'Drywall', 'Renovation trade category for Drywall');
INSERT INTO work_item_types (key, name, description) VALUES ('electrical', 'Electrical', 'Renovation trade category for Electrical');
INSERT INTO work_item_types (key, name, description) VALUES ('flooring', 'Flooring', 'Renovation trade category for Flooring');
INSERT INTO work_item_types (key, name, description) VALUES ('general', 'General', 'Renovation trade category for General');
INSERT INTO work_item_types (key, name, description) VALUES ('general_laborer', 'General Laborer', 'Renovation trade category for General Laborer');
INSERT INTO work_item_types (key, name, description) VALUES ('hvac', 'HVAC', 'Renovation trade category for HVAC');
INSERT INTO work_item_types (key, name, description) VALUES ('insulation', 'Insulation', 'Renovation trade category for Insulation');
INSERT INTO work_item_types (key, name, description) VALUES ('mitigation_remediation', 'Mitigation/Remediation', 'Renovation trade category for Mitigation/Remediation');
INSERT INTO work_item_types (key, name, description) VALUES ('paint', 'Paint', 'Renovation trade category for Paint');
INSERT INTO work_item_types (key, name, description) VALUES ('plumbing_bath', 'Plumbing/Bath', 'Renovation trade category for Plumbing/Bath');
INSERT INTO work_item_types (key, name, description) VALUES ('roofing', 'Roofing', 'Renovation trade category for Roofing');
INSERT INTO work_item_types (key, name, description) VALUES ('testing_consulting', 'Testing/Consulting', 'Renovation trade category for Testing/Consulting');
INSERT INTO work_item_types (key, name, description) VALUES ('windows_doors', 'Windows & Doors', 'Renovation trade category for Windows & Doors');

-- Seed/Ensure Floors & Rooms
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('lower_level', 'Lower Level', 1, 1000);
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('upper_level', 'Upper Level', 2, 1200);
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('outside', 'Outside', 3, 0);
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('all_levels', 'All Levels', 4, 2200);

INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'primary_bathroom', 'Primary Bathroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'entry_foyer', 'Entry/Foyer', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'kitchen', 'Kitchen', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'guest_bathroom', 'Guest Bathroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'hall_bathroom', 'Hall Bathroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'guest_bedroom', 'Guest Bedroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'living_room', 'Living Room', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'family_room', 'Family Room', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'outside'), 'backyard', 'Backyard', 0);

-- Seed trade_data (Truth Table)
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_c0a52d1896e3469cb2', '5/8" drywall - hung, taped, floated, ready for paint', 'Hanging, taping, and finishing 5/8 inch drywall.', 'Drywall',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'SF',
      3.98, 5.97, 1.5, 'Drywall hanging and finishing commands a premium in SF.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_0950c82963f24c75b7', '5/8" drywall - hung, taped, with smooth wall finish', 'Hanging, taping, and finishing 5/8 inch drywall.', 'Drywall',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'SF',
      5.51, 8.27, 1.5, 'Drywall hanging and finishing commands a premium in SF.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_e21e53c79a3d4c0bba', 'add for glued down application over concrete substrate', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      3.7, 5.37, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_dde72efa8bb0449bb4', 'baseboard - 3 1/4"', 'Material and labor for installing 3 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      5.1, 7.39, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_5e49774db98341658c', 'baseboard - 4 1/4"', 'Material and labor for installing 4 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      5.97, 8.66, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_6531fba4f0ba45cca3', 'baseboard - 4 1/4" mdf - flat profile', 'Material and labor for installing 4 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      4.99, 7.24, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_9afa3c29c5ae414080', 'batt insulation - 4" - r11- unfaced batt', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      0.9, 1.3, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_7f0c8eb39ac54f9294', 'bid item - sevice master', 'Lump sum bid from ServiceMaster for water mitigation or restoration.', 'Mitigation/Remediation',
      (SELECT id FROM work_item_types WHERE key = 'mitigation_remediation'), 'EA',
      3109.36, 4042.17, 1.3, 'Emergency mitigation companies already charge high rates; SF premium is moderate on top of this.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_42f73f559c7d472bab', 'bluecoast environmental consultants', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      1550, 2247.5, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_382bf54f98364279bd', 'casing - 2 1/4"', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      3.13, 4.54, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_2f1a577f94b6410f86', 'content manipulation charge - per hour', 'Labor charge for moving personal property out of the way for repairs.', 'Contents',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'HR',
      72.32, 115.71, 1.6, 'General labor and moving costs in San Francisco are approximately 60% higher than the national average.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_20e547b0114c456d85', 'contents - move out then reset', 'Moving contents out of a room for construction and resetting them.', 'Contents',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'EA',
      106.14, 169.82, 1.6, 'Movers and general labor rates in SF are inflated.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_b23cede125a94c649b', 'contents - move out then reset - extra large room', 'Moving contents out of a room for construction and resetting them.', 'Contents',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'EA',
      318.41, 509.46, 1.6, 'Movers and general labor rates in SF are inflated.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_532483a594c948a2a9', 'contents - move out then reset - large room', 'Moving contents out of a room for construction and resetting them.', 'Contents',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'EA',
      159.21, 254.74, 1.6, 'Movers and general labor rates in SF are inflated.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_60a31c322ade4950a8', 'detach & reset backsplash - solid surface - unattached', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      6.41, 9.29, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_2c48eb6baac4415fb5', 'detach & reset baseboard - 2 1/4"', 'Material and labor for installing 2 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      4.61, 6.68, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_607edea1787a45fe97', 'detach & reset baseboard - 3 1/4"', 'Material and labor for installing 3 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      4.61, 6.68, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_aa9680e7137a4a9396', 'detach & reset bathroom mirror - w/metal frame - surface mtd. - std grd', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      13.74, 19.92, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_83186e10d59d4b3db2', 'detach & reset bathtub', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      929.63, 1347.96, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_45fa402fd20949e6bf', 'detach & reset bypass (sliding) door set - colonist', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      52.04, 75.46, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_8e4e43d4582141fab5', 'detach & reset cabinetry - full height unit - high grade', 'Detach and reset, or remove and replace cabinetry.', 'Cabinetry',
      (SELECT id FROM work_item_types WHERE key = 'cabinetry'), 'LF',
      112.03, 168.05, 1.5, 'Cabinetry work requires specialized carpenters charging higher SF rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_560e3dcfc69f4768b6', 'detach & reset cabinetry - lower (base) units - high grade', 'Detach and reset, or remove and replace cabinetry.', 'Cabinetry',
      (SELECT id FROM work_item_types WHERE key = 'cabinetry'), 'LF',
      112.51, 168.77, 1.5, 'Cabinetry work requires specialized carpenters charging higher SF rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_7aaed9a0a4554368ad', 'detach & reset cabinetry - upper (wall) units - high grade', 'Detach and reset, or remove and replace cabinetry.', 'Cabinetry',
      (SELECT id FROM work_item_types WHERE key = 'cabinetry'), 'LF',
      96.22, 144.33, 1.5, 'Cabinetry work requires specialized carpenters charging higher SF rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_2bcb08e7998841fd99', 'detach & reset countertop - granite or marble - high grade', 'Granite, marble, or solid surface countertop work.', 'Countertop',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'SF',
      56.06, 81.29, 1.45, 'High weight logistics in SF properties and high fabricator rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_bfa89fc6319a46b095', 'detach & reset countertop - solid surface - premium grade', 'Granite, marble, or solid surface countertop work.', 'Countertop',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'LF',
      56.06, 81.29, 1.45, 'High weight logistics in SF properties and high fabricator rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_fb79f3d93b6749a18c', 'detach & reset custom family room cabinets - base units - high grade', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      112.51, 163.14, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ab5eb30392a24531a3', 'detach & reset custom cabinets - base units - high grade', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      112.51, 163.14, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_5da1663dcb60416fbe', 'detach & reset custom cabinets - full height units', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      112.03, 162.44, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d950ea7f78d04b9f86', 'detach & reset dishwasher', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      379.95, 550.93, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_60d37ac0cabe4baab7', 'detach & reset door bell/chime', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      94.44, 136.94, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_f42993fb1264415da2', 'detach & reset dryer - electric', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      58.19, 84.38, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_46778f9e05d54b4cbf', 'detach & reset exhaust fan', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      361.98, 524.87, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_401266f1976e4dc1bd', 'detach & reset garbage disposal', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      260.46, 377.67, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d9c05946c7964ce899', 'detach & reset handrail - round / oval - softwood - wall mounted', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      10.37, 15.04, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ffe4982cd4ab45beb1', 'detach & reset interior door - birch - slab only', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      36.86, 53.45, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d3337d3654614545a5', 'detach & reset light bar - 3 lights', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      99.88, 144.83, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_28dc521968064e9abe', 'detach & reset light fixture', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      99.88, 144.83, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_158d3a43e6f7492e8d', 'detach & reset p-trap assembly - abs (plastic)', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      97.15, 140.87, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_81f3e8e6323b43aeaf', 'detach & reset range hood', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      173.13, 251.04, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_15e16d31985448108a', 'detach & reset range hood - high grade', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      173.13, 251.04, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_956a8f4ab2cc443abd', 'detach & reset refrigerator - side by side - 16 to 22 cf', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      77.58, 112.49, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_fe8d9fb3188a494eab', 'detach & reset shower door', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      312.9, 453.7, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_5dde7f7e66d64e87bf', 'detach & reset sink faucet - bathroom', 'Detach and reset sink or tub faucet.', 'Plumbing/Bath',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'EA',
      194.95, 331.41, 1.7, 'Plumbing-related fixtures incur a higher labor multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_caa07209706a41fca6', 'detach & reset sink faucet - kitchen - high grade', 'Detach and reset sink or tub faucet.', 'Plumbing/Bath',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'EA',
      194.95, 331.41, 1.7, 'Plumbing-related fixtures incur a higher labor multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_11385b82d7234d87b6', 'detach & reset smoke detector', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      96.73, 140.26, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d882b8012ab54a3ba2', 'detach & reset solar electric panel - up to 150 watt', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      476.3, 690.63, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_8a6937e41faa4be3b4', 'detach & reset tv brackets - wall mounted', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      70.84, 102.72, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_e431cbac10c546e799', 'detach & reset thermostat', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      81.85, 118.68, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_33f8b2273bae431c89', 'detach & reset toilet', 'Detach and reset toilet.', 'Plumbing/Bath',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'EA',
      393.41, 668.8, 1.7, 'Plumbing-related fixtures incur a higher labor multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ce442264faf2482a84', 'detach & reset tub/shower faucet', 'Detach and reset sink or tub faucet.', 'Plumbing/Bath',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'EA',
      149.08, 253.44, 1.7, 'Plumbing-related fixtures incur a higher labor multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_1f5ce5b80ce3400886', 'detach & reset vanity - high grade', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      96.22, 139.52, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_90b934494b51471aa4', 'detach & reset washer/washing machine - front-loading', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      75.48, 109.45, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_070612ac0d844455a0', 'detach & reset window drapery - hardware', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      50.63, 73.41, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_25baf3fcd9a947c087', 'drywall patch / small repair, ready for paint', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      128.98, 187.02, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_0acc5348b010471090', 'drywall tape joint / repair - per lf', 'Repairing and taping drywall joints per linear foot.', 'Drywall',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'LF',
      13.17, 19.75, 1.5, 'Patchwork and taping commands high hourly minimums in SF.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_109022572f77410381', 'dumpster load - approximate 20 yds, 4 tons of debris', 'Rental and disposal fee for a dumpster.', 'Debris Removal',
      (SELECT id FROM work_item_types WHERE key = 'debris_removal'), 'EA',
      904.52, 1628.14, 1.8, 'Recology and local municipal dump fees are among the highest in the country.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ae7402203c9f4991a7', 'electrical labor minimum', 'Minimum charge for an electrician to arrive and perform minor work.', 'Electrical',
      (SELECT id FROM work_item_types WHERE key = 'electrical'), 'EA',
      395.65, 712.17, 1.8, 'Electricians are in extremely high demand; minimum roll-out fees in SF often exceed $300-$400.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_1fa492b8affb46a2b3', 'engineered wood floor - specs from independent analysis', 'Installation of engineered hardwood flooring.', 'Flooring',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'SF',
      18.65, 25.18, 1.35, 'Material costs are higher, combined with elevated specialty floor installer rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_f50256229a604d85b2', 'final cleaning - construction - residential', 'Post-construction final residential cleaning.', 'Cleaning',
      (SELECT id FROM work_item_types WHERE key = 'cleaning'), 'SF',
      0.47, 0.7, 1.5, 'Cleaning services command a higher living wage locally.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_c2e74bbbe17b4e0bba', 'floor protection - plastic and tape - 10 mil', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      0.46, 0.67, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_fff7825bb30c41dca2', 'general laborer - per hour', 'Hourly rate for a general construction laborer.', 'General Laborer',
      (SELECT id FROM work_item_types WHERE key = 'general_laborer'), 'HR',
      72.32, 115.71, 1.6, 'Minimum wage laws and high cost of living heavily impact basic labor rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_f06e319d14b243f48f', 'handyman services', 'General minor repairs and maintenance performed by a handyman.', 'General Laborer',
      (SELECT id FROM work_item_types WHERE key = 'general_laborer'), 'EA',
      366.45, 586.32, 1.6, 'Independent contractor living costs in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_3f606a2f48e047ffbf', 'haul debris - per pickup truck load - including dump fees', 'Loading, hauling, and disposing of construction debris.', 'Debris Removal',
      (SELECT id FROM work_item_types WHERE key = 'debris_removal'), 'EA',
      257.65, 463.77, 1.8, 'Dump fees and waste management in San Francisco/San Mateo counties are exceptionally high.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_82e9f03a5f494408a9', 'healthy building science, inc.', 'Environmental consulting, typically for mold, asbestos, or lead testing.', 'Testing/Consulting',
      (SELECT id FROM work_item_types WHERE key = 'testing_consulting'), 'EA',
      2295, 3442.5, 1.5, 'Environmental hygienists and lab fees have a steep premium in Northern California.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_eb8baa88486844a695', 'heat, vent, & air cond. labor minimum', 'Minimum labor charge for HVAC trades.', 'HVAC',
      (SELECT id FROM work_item_types WHERE key = 'hvac'), 'EA',
      245.64, 417.59, 1.7, 'HVAC specialists carry high hourly rates in SF.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_91b6e4d00a8844cc97', 'honey truck monthly pump out', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'MOS',
      242.04, 350.96, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_df3357539aef44c899', 'install flue cap hallway', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      37.97, 55.06, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_03fc42765beb4d4191', 'install surveillance camera - color', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      370.98, 537.92, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ba8edd2a288c46beb9', 'install triple wall or insulated high temperature flue', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      59.55, 86.35, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_72718d8f18b5458b92', 'light fixture', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      103.98, 150.77, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_5d65606b85c1431c86', 'modified bitumen roof', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      44050, 63872.5, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_897dc5390fff45fdba', 'paint baseboard - one coat', 'Applying a single coat of paint to baseboards.', 'Paint',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'LF',
      1.67, 2.34, 1.4, 'Painting labor markup for the SF region.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_6a1ed3107eff432ab6', 'paint baseboard - two coats', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      2.51, 3.64, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_def7d2122edb49e890', 'paint ceiling - one coat', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      1.13, 1.64, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_4c6b5734556a478dbc', 'paint door or opening - 1 coat (per side)', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      36.38, 52.75, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_3b1978ba4cdf4ba0bc', 'paint door or window closet (1) opening - 1 coat (per side)', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      36.38, 52.75, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_a19257d956e0461cbd', 'paint door or window opening - 1 coat (per side)', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      36.38, 52.75, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_30f3031c4abe4f8894', 'paint door or window opening - 2 coats (per side)', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      54.14, 78.5, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d56524662e574c11b8', 'paint door or window opening - large - 1 coat (per side)', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      42.8, 62.06, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_83f8d0a7b6dd4597a1', 'paint stair skirt / apron', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      10.31, 14.95, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_7d78b318c0c5467296', 'paint the ceiling - one coat', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      1.13, 1.64, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_c480e4e46c3a41dda0', 'paint the surface area - one coat', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      1.13, 1.64, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_a009de9a6e5b41d1b8', 'paint the walls - one coat', 'Applying a single coat of paint to wall surfaces.', 'Paint',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'SF',
      1.13, 1.58, 1.4, 'Standard Bay Area painting cost index multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_80fc7e5cdeac4ccca1', 'r&r 1/2" drywall - hung, taped, floated, ready for paint', 'Remove and replace 1/2 inch drywall, including hanging, taping, and floating.', 'Drywall',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'LF',
      4.49, 6.74, 1.5, 'Drywall hanging and finishing is highly specialized; union and non-union rates are high.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_6bb1ee46bb1c40c48e', 'r&r 5/8" drywall - hung, taped, with smooth wall finish', 'Hanging, taping, and finishing 5/8 inch drywall.', 'Drywall',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'SF',
      6.17, 9.25, 1.5, 'Drywall hanging and finishing commands a premium in SF.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_24c2b2ac353b4e85be', 'r&r backsplash - solid surface - unattached', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      18.99, 27.54, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_178881597ada43a592', 'r&r baseboard', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      6.69, 9.7, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_cf73fede85c04e7fb9', 'r&r baseboard - 2 1/4"', 'Material and labor for installing 2 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      5.05, 7.32, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_9b005d3b79184177a9', 'r&r baseboard - 3 1/4"', 'Material and labor for installing 3 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      5.82, 8.44, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_75ecdb2c80314bf691', 'r&r baseboard - 4 1/4"', 'Material and labor for installing 4 1/4 inch baseboards.', 'Baseboard',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'LF',
      6.69, 9.7, 1.45, 'Finish carpentry labor carries a premium in the Bay Area.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_e9c60be5741942ed8e', 'r&r batt insulation - 4" - r11- unfaced batt', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      1.28, 1.86, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_56cced29a26e419aaf', 'r&r batt insulation - 6" - r19 - unfaced batt', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      1.82, 2.64, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_e337bd38616b471784', 'r&r ceramic/porcelain tile - high grade', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      29.06, 42.14, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_14b6742cc4c545eca3', 'r&r countertop - granite or marble - high grade', 'Granite, marble, or solid surface countertop work.', 'Countertop',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'SF',
      110.73, 160.56, 1.45, 'High weight logistics in SF properties and high fabricator rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_fca8cc4ad360406e8c', 'r&r engineered wood floor - specs from independent analysis', 'Installation of engineered hardwood flooring.', 'Flooring',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'SF',
      22.38, 30.21, 1.35, 'Material costs are higher, combined with elevated specialty floor installer rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_8fb1fa7dfeb1408e94', 'r&r engineered wood flooring - premium grade', 'Installation of engineered hardwood flooring.', 'Flooring',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'SF',
      21.99, 29.69, 1.35, 'Material costs are higher, combined with elevated specialty floor installer rates.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_6f3c6f4cb6094b26a8', 'r&r fireplace box zero clnce - 36" wood burning', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      1966.6, 2851.57, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_5eb1ec6a5d39411989', 'r&r flashing - pipe jack', 'Remove and replace roof or pipe flashing.', 'Roofing',
      (SELECT id FROM work_item_types WHERE key = 'roofing'), 'EA',
      85.06, 127.59, 1.5, 'Standard roofing component SF multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_7da3f93feda5436395', 'r&r floor drain - tub/shower - metal/plastic', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      75.32, 109.21, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_aaf0f36e48de45af8b', 'r&r marble or granite floor tile', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      42.27, 61.29, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_362a6984c4cf49a19b', 'r&r marble or granite tile', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      43.97, 63.76, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_5425157bace9481390', 'r&r mortar bed for tile floors', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      10.49, 15.21, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_bd7f08eda3c64dbaab', 'r&r mosaic - ceramic/porcelain tile', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      32.57, 47.23, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_a6703bcd29df400c92', 'r&r plumbing fixture supply line', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      36.89, 53.49, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d47b2ed148d64c74bc', 'r&r underlayment - 5/8" osb', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      6.46, 9.37, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_1acca65cf35b48b98c', 'regasgroup environmental consultants', 'Asbestos and lead testing consulting.', 'Testing/Consulting',
      (SELECT id FROM work_item_types WHERE key = 'testing_consulting'), 'EA',
      790, 1185, 1.5, 'Hazardous materials testing in SF requires strict compliance, raising costs.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_2b96e481b2d245eea4', 'remove flue cap', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      26.52, 38.45, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_589e6c02189a42a699', 'remove surveillance camera - color', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      79.57, 115.38, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_77ea49fc552e42c7b9', 'remove triple wall or insulated high temperature flue', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      9.18, 13.31, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_3a581b38f0fe45cca2', 'roofing (bid item) - tarp bid for michael behan construction emergency tarp', 'Emergency roof tarping bid.', 'Roofing',
      (SELECT id FROM work_item_types WHERE key = 'roofing'), 'EA',
      5000, 7000, 1.4, 'Emergency exterior contractor rates in SF.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_7a1a4929a8414dd18b', 'roofing labor minimum', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      863.71, 1252.38, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_b6c630c5f53649b090', 'seal & paint baseboard - two coats', 'Applying sealant and two coats of paint to baseboards.', 'Paint',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'LF',
      2.62, 3.67, 1.4, 'Painting labor and high-VOC compliant paints slightly increase costs in California.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_d7c1352cda424e9bab', 'seal & paint casing - two coats', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      2.63, 3.81, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_508dafbce0c9467e9f', 'seal and paint window', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      4.48, 6.5, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_6dd1126ecda641e9a3', 'seal grout on tile wall', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      3.25, 4.71, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_0e532aa642e64b789f', 'seal/prime then paint the surface area (2 coats)', 'Priming and painting wall or ceiling surface areas with two coats.', 'Paint',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'SF',
      1.63, 2.28, 1.4, 'Standard Bay Area painting cost index multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_411b67cf312941af93', 'shower pan - hot mop - 17 to 30 sf', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      686.7, 995.72, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_f9bcca005ece4b2c99', 'silicone roof coating - flat roof', 'Applying a silicone-based waterproof coating to a flat roof.', 'Roofing',
      (SELECT id FROM work_item_types WHERE key = 'roofing'), 'SF',
      4.12, 6.18, 1.5, 'Flat roofing is common in SF, but material logistics and high liability insurance drive up prices.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_a2af5e8e10f74e9096', 'silicone roof primer', 'Primer application prior to silicone roof coating.', 'Roofing',
      (SELECT id FROM work_item_types WHERE key = 'roofing'), 'SF',
      0.9, 1.35, 1.5, 'Matches the roofing application multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_950d7307df9f4a34af', 'sink - undermount - detach & reset', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      403.01, 584.36, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_2b6048d4230e4951be', 'strike check report', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'EA',
      4004.16, 5806.03, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_cc063f7e49dd4f4880', 'tape joint for new to existing drywall - lf', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      14.24, 20.65, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ff8d0f30b100498f8c', 'tape joint for new to existing drywall - per lf', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'LF',
      14.24, 20.65, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_ed3cb3ffef6942eda6', 'temporary toilet per month', 'Detach and reset toilet.', 'Plumbing/Bath',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'MOS',
      240, 408, 1.7, 'Plumbing-related fixtures incur a higher labor multiplier.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_cc021c762651477182', 'texture drywall - smooth / skim coat', 'Standard construction and repair activity.', 'General',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'SF',
      2.3, 3.33, 1.45, 'A blended average representing general San Francisco construction cost inflation.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_a8baaaf7e4b940fcb3', 'toilet & bath accessory labor minimum', 'Minimum labor charge to install bathroom accessories.', 'Plumbing/Bath',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'EA',
      178.19, 285.1, 1.6, 'Plumber/handyman minimum site visit costs.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_6bddd2ca377c4f9e83', 'vinyl floor covering labor minimum', 'Minimum labor charge for flooring installation.', 'Flooring',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'EA',
      256.1, 384.15, 1.5, 'Flooring contractor minimums.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_38806757ce1b49c1a8', 'water extraction & remediation (bid item) - serv pro', 'Lump sum bid from ServPro for water extraction.', 'Mitigation/Remediation',
      (SELECT id FROM work_item_types WHERE key = 'mitigation_remediation'), 'EA',
      996.78, 1295.81, 1.3, 'Franchise emergency services have structured pricing, with standard regional bumps.'
    );
INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      'td_f3403bb0c79142caa9', 'water mitigation completed by policy holder', 'Reimbursement to the policyholder for performing their own water mitigation.', 'Mitigation/Remediation',
      (SELECT id FROM work_item_types WHERE key = 'mitigation_remediation'), 'EA',
      660, 660, 1, 'Policyholder reimbursements for self-performed work usually do not scale with contractor geographic multipliers.'
    );

-- Seed standard_costs
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_68194926e338456493', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'r&r marble or granite tile',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_362a6984c4cf49a19b', 201.62, 'SF',
      43.97, 63.76, 177.9, 1808.62, 10851.75, 8865.2314, 12855.2912, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_cd0ab2348d4b4e289e', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'baseboard - 4 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_5e49774db98341658c', 55.17, 'LF',
      5.97, 8.66, 12.09, 0, 341.45, 329.3649, 477.7722, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2768f4ccd2e94b98bf', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 123.78, 'SF',
      22.38, 25.18, 138.15, 489.34, 2935.99, 2308.497, 3116.7804, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_df2b3622c20741eebb', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'final cleaning - construction - residential',
      (SELECT id FROM work_item_types WHERE key = 'cleaning'), 'td_f50256229a604d85b2', 123.78, 'SF',
      0.47, 0.7, 0, 11.64, 69.82, 58.1766, 86.646, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_eaf98ba7862c416299', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'paint baseboard - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_897dc5390fff45fdba', 55.17, 'LF',
      1.67, 2.34, 0.52, 0, 92.65, 92.1339, 129.0978, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_864e79aa26cd4a4da6', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'r&r mortar bed for tile floors',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_5425157bace9481390', 119.64, 'SF',
      10.49, 15.21, 23.63, 255.72, 1534.38, 1255.0236, 1819.7244, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6e5ff71e8b0644baa3', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r fireplace box zero clnce - 36" wood burning',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_6f3c6f4cb6094b26a8', 1, 'EA',
      1966.6, 2851.57, 142.83, 421.88, 2531.31, 1966.6, 2851.57, 'Troy padding - keep if we are going to modify the fireplace'
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_49a0b28831fc49e199', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 55.17, 'LF',
      2.62, 3.67, 0.67, 27.1, 162.65, 144.5454, 202.47390000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_df7b22743bf44ae194', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'seal/prime then paint the surface area (2 coats)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_0e532aa642e64b789f', 46.5, 'SF',
      1.63, 2.28, 0.96, 15.36, 92.12, 75.795, 106.02, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2188fd4f4f1e41faa4', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 516.51, 'SF',
      1.13, 1.64, 8.02, 118.34, 710.02, 583.6563, 847.0763999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_7bf2e999a985486295', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'r&r marble or granite floor tile',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_aaf0f36e48de45af8b', 12.92, 'SF',
      42.27, 61.29, 11.4, 111.5, 669.03, 546.1284, 791.8668, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e569b11cf739487291', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', '5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_0950c82963f24c75b7', 66.14, 'SF',
      5.51, 8.27, 4.45, 73.78, 442.66, 364.4314, 546.9778, 'dupe?'
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c903650630ec4ed8ae', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'baseboard - 4 1/4" mdf - flat profile',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_6531fba4f0ba45cca3', 15.92, 'LF',
      4.99, 7.24, 2.14, 16.3, 97.88, 79.44080000000001, 115.2608, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_cb80da4d5de142a29b', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'contents - move out then reset - extra large room',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'td_b23cede125a94c649b', 1, 'EA',
      318.41, 509.46, 0, 63.68, 382.09, 318.41, 509.46, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_ef1600c08d1f464cb4', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 933.83, 'SF',
      1.13, 1.64, 14.5, 213.94, 1283.67, 1055.2278999999999, 1531.4812, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_41866f42e6324e9098', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_607edea1787a45fe97', 79.58, 'LF',
      4.61, 6.68, 0.14, 73.4, 440.4, 366.8638, 531.5944, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4f5eed5e9614465993', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset custom family room cabinets - base units - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_fb79f3d93b6749a18c', 6, 'LF',
      112.51, 163.14, 0, 135.02, 810.08, 675.0600000000001, 978.8399999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b38eb3e65b9142b3a3', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'add for glued down application over concrete substrate',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e21e53c79a3d4c0bba', 259.8, 'SF',
      3.7, 5.37, 21.51, 196.54, 1179.31, 961.2600000000001, 1395.126, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9389d45d37264a0ca2', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'r&r batt insulation - 4" - r11- unfaced batt',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e9c60be5741942ed8e', 408, 'SF',
      1.28, 1.86, 15.48, 107.54, 645.26, 522.24, 758.88, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2fc569ed3a9246dfab', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset bathtub',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_83186e10d59d4b3db2', 1, 'EA',
      929.63, 1347.96, 0, 185.92, 1115.55, 929.63, 1347.96, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_01fb7a6dcb1a41dc88', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset tub/shower faucet',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'td_ce442264faf2482a84', 1, 'EA',
      149.08, 253.44, 0, 29.82, 178.9, 149.08, 253.44, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_dda41444ace24f9a97', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset custom cabinets - base units - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ab5eb30392a24531a3', 6, 'LF',
      112.51, 163.14, 0, 135.02, 810.08, 675.0600000000001, 978.8399999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_beed810dcc194eae85', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_c480e4e46c3a41dda0', 455.34, 'SF',
      1.13, 1.64, 7.07, 104.32, 625.92, 514.5341999999999, 746.7575999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f69ba31196e54d4893', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 595.32, 'SF',
      1.13, 1.64, 9.24, 136.38, 818.33, 672.7116, 976.3248, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d7ff102596184a1da9', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 534.67, 'LF',
      1.13, 1.64, 8.3, 122.5, 734.98, 604.1770999999999, 876.8587999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_253080d396f34e5db4', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'r&r baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_9b005d3b79184177a9', 66.83, 'LF',
      5.82, 8.44, 10.49, 79.88, 479.32, 388.9506, 564.0451999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d4ec30345bb9456693', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint baseboard - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_897dc5390fff45fdba', 79.58, 'LF',
      1.67, 2.34, 0.75, 26.74, 160.39, 132.8986, 186.2172, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_46c0f70883ad4def89', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 533.78, 'SF',
      1.13, 1.64, 8.29, 122.3, 733.76, 603.1714, 875.3992, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1f91545faf4e45fab1', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset custom cabinets - base units - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ab5eb30392a24531a3', 5, 'LF',
      112.51, 163.14, 0, 112.52, 675.07, 562.5500000000001, 815.6999999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_33d60f9208bf4a8991', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint the walls - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_a009de9a6e5b41d1b8', 942.67, 'SF',
      1.13, 1.58, 14.63, 215.96, 1295.81, 1065.2170999999998, 1489.4186, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_3eafd3e734234e59b1', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r 5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_6bb1ee46bb1c40c48e', 22.75, 'SF',
      6.17, 9.25, 1.53, 28.38, 170.28, 140.3675, 210.4375, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c8e5ee3704c24560bd', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'texture drywall - smooth / skim coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_cc021c762651477182', 236.13, 'SF',
      2.3, 3.33, 2.65, 109.16, 654.91, 543.0989999999999, 786.3129, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_ec156e7230dd42b6a3', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_9b005d3b79184177a9', 46.83, 'LF',
      5.82, 8.44, 7.35, 55.98, 335.88, 272.55060000000003, 395.24519999999995, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a2182306fb78413aba', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'add for glued down application over concrete substrate',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e21e53c79a3d4c0bba', 142.48, 'SF',
      3.7, 5.37, 11.8, 107.8, 646.78, 527.1759999999999, 765.1175999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9997fda718474b13bb', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r countertop - granite or marble - high grade',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'td_14b6742cc4c545eca3', 5, 'SF',
      110.73, 160.56, 18.32, 114.4, 686.37, 553.65, 802.8, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c1616048db764059ad', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_fca8cc4ad360406e8c', 495.92, 'SF',
      22.38, 30.21, 553.48, 2330.44, 13982.61, 11098.6896, 14981.7432, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5d4bc6a122454d58a4', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'r&r mosaic - ceramic/porcelain tile',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_bd7f08eda3c64dbaab', 15, 'SF',
      32.57, 47.23, 12.07, 100.14, 600.76, 488.55, 708.4499999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_17eb20462b6c4736a4', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 412, 'SF',
      1.13, 1.64, 6.4, 94.4, 566.36, 465.55999999999995, 675.68, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d057d889389f4dcdb6', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 15.92, 'LF',
      2.62, 3.67, 0.19, 8.38, 50.28, 41.7104, 58.4264, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_bb0cde540d454510a7', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'add for glued down application over concrete substrate',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e21e53c79a3d4c0bba', 123.78, 'SF',
      3.7, 5.37, 10.25, 34.5, 206.9, 457.98600000000005, 664.6986, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e010c5019e0f4a82bb', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 378.31, 'SF',
      1.13, 1.64, 5.87, 86.68, 520.04, 427.4903, 620.4284, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_56203e48e3b04e7ca4', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'seal grout on tile wall',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_6dd1126ecda641e9a3', 128.64, 'SF',
      3.25, 4.71, 1.78, 83.98, 503.84, 418.0799999999999, 605.8943999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5bd715cb0f294d68b3', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset shower door',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_fe8d9fb3188a494eab', 1, 'EA',
      312.9, 453.7, 0, 62.58, 375.48, 312.9, 453.7, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_97d6c0223dcb4a4792', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset shower door',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_fe8d9fb3188a494eab', 1, 'EA',
      312.9, 453.7, 0, 62.58, 375.48, 312.9, 453.7, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_cf23b713a79e463182', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'baseboard - 4 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_5e49774db98341658c', 27, 'LF',
      5.97, 8.66, 167.11, 0, 167.11, 161.19, 233.82, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f511c5977aaa4636b8', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'sink - undermount - detach & reset',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_950d7307df9f4a34af', 1, 'EA',
      403.01, 584.36, 0.14, 80.62, 483.77, 403.01, 584.36, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c095019edfec4145bb', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'content manipulation charge - per hour',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'td_2f1a577f94b6410f86', 1, 'HR',
      72.32, 115.71, 0, 0, 72.32, 72.32, 115.71, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b20ce8a84d684c8391', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'seal/prime then paint the surface area (2 coats)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_0e532aa642e64b789f', 442.13, 'SF',
      1.63, 2.28, 9.15, 145.98, 875.8, 720.6718999999999, 1008.0563999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1c98ba62b3e74c5993', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset countertop - solid surface - premium grade',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'td_bfa89fc6319a46b095', 3, 'LF',
      56.06, 81.29, 0.02, 33.64, 201.84, 168.18, 243.87, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_02842dfecbd1458aaf', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'tape joint for new to existing drywall - per lf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ff8d0f30b100498f8c', 28, 'LF',
      14.24, 20.65, 0.82, 79.9, 479.44, 398.72, 578.1999999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a1887a6639334faa8d', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset sink faucet - bathroom',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'td_5dde7f7e66d64e87bf', 1, 'EA',
      194.95, 331.41, 0, 39, 233.95, 194.95, 331.41, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_fd3ea59915724a8aab', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset dishwasher',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_d950ea7f78d04b9f86', 1, 'EA',
      379.95, 550.93, 0, 76, 455.95, 379.95, 550.93, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_465cfb40ea98433eb7', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset toilet',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'td_33f8b2273bae431c89', 1, 'EA',
      393.41, 668.8, 0.71, 78.82, 472.94, 393.41, 668.8, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_3f53742562214bc78a', (SELECT id FROM rooms WHERE room_code = 'hall_bathroom'), 'Hall Bathroom', 'upper level', 'detach & reset exhaust fan',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_46778f9e05d54b4cbf', 1, 'EA',
      361.98, 524.87, 0, 72.4, 434.38, 361.98, 524.87, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c2f0bcdafb2a474b84', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'paint the ceiling - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_7d78b318c0c5467296', 324.22, 'SF',
      1.13, 1.64, 0, 0, 0, 366.3686, 531.7208, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e6839484a6e54b4da4', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'detach & reset custom cabinets - base units - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ab5eb30392a24531a3', 3, 'LF',
      112.51, 163.14, 0, 67.5, 405.03, 337.53000000000003, 489.41999999999996, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f011f61c1b264d98a8', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset vanity - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_1f5ce5b80ce3400886', 3, 'LF',
      96.22, 139.52, 0, 57.74, 346.4, 288.65999999999997, 418.56000000000006, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_bc408299cfc840cdaf', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'r&r 1/2" drywall - hung, taped, floated, ready for paint',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_80fc7e5cdeac4ccca1', 30, 'LF',
      4.49, 6.74, 1.81, 0, 136.51, 134.70000000000002, 202.20000000000002, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_3b94fcbc23f24bffb1', (SELECT id FROM rooms WHERE room_code = 'hall_bathroom'), 'Hall Bathroom', 'upper level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 253.88, 'SF',
      1.13, 1.64, 3.94, 58.16, 348.98, 286.88439999999997, 416.36319999999995, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_508210c38c3f4dc6a5', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'r&r 5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_6bb1ee46bb1c40c48e', 25.9, 'SF',
      6.17, 9.25, 1.74, 32.3, 193.84, 159.803, 239.575, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b4ce80e3612b42ce87', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset vanity - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_1f5ce5b80ce3400886', 3, 'LF',
      96.22, 139.52, 0, 57.74, 346.4, 288.65999999999997, 418.56000000000006, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_58c7a1ecde594c3e9e', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'detach & reset handrail - round / oval - softwood - wall mounted',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_d9c05946c7964ce899', 27.75, 'LF',
      10.37, 15.04, 0, 57.56, 345.33, 287.7675, 417.35999999999996, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5b549dc20aa0460d99', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 245.9, 'SF',
      1.13, 1.64, 3.82, 56.34, 338.03, 277.86699999999996, 403.276, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6551dcd021e84f9997', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset garbage disposal',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_401266f1976e4dc1bd', 1, 'EA',
      260.46, 377.67, 0, 52.1, 312.56, 260.46, 377.67, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1ee7f73b5f5c4b9cac', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset cabinetry - upper (wall) units - high grade',
      (SELECT id FROM work_item_types WHERE key = 'cabinetry'), 'td_7aaed9a0a4554368ad', 9, 'LF',
      96.22, 144.33, 0, 173.2, 1039.18, 865.98, 1298.97, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c40c445eb8ab4cf4a0', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', '5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_0950c82963f24c75b7', 408, 'SF',
      5.51, 8.27, 27.45, 455.12, 2730.65, 2248.08, 3374.16, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b53e80b6aa5c48f88c', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset thermostat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e431cbac10c546e799', 1, 'EA',
      81.85, 118.68, 0, 16.38, 98.23, 81.85, 118.68, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2955c1af8b9948b38d', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'baseboard - 4 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_5e49774db98341658c', 52.08, 'LF',
      5.97, 8.66, 11.41, 0, 322.33, 310.9176, 451.01279999999997, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_49a6a95c75a64b74a2', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'tape joint for new to existing drywall - per lf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ff8d0f30b100498f8c', 17.67, 'LF',
      14.24, 20.65, 0.52, 50.42, 302.56, 251.62080000000003, 364.88550000000004, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_ed621cfc1c6843ceab', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'paint the surface area - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c480e4e46c3a41dda0', 217.33, 'SF',
      1.13, 1.64, 3.37, 49.8, 298.75, 245.5829, 356.4212, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4a9bf785bae6438ea2', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 19.98, 'SF',
      0.46, 0.67, 0.21, 1.88, 11.28, 9.190800000000001, 13.386600000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_fabb5a3817654562ba', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'r&r underlayment - 5/8" osb',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_d47b2ed148d64c74bc', 32, 'SF',
      6.46, 9.37, 4.33, 42.2, 253.25, 206.72, 299.84, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f297ce0329434dac85', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'final cleaning - construction - residential',
      (SELECT id FROM work_item_types WHERE key = 'cleaning'), 'td_f50256229a604d85b2', 142.48, 'SF',
      0.47, 0.7, 0, 13.4, 80.37, 66.9656, 99.73599999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4b0389268c2a4d2580', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'r&r ceramic/porcelain tile - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e337bd38616b471784', 8.01, 'SF',
      29.06, 42.14, 5.25, 47.62, 285.64, 232.77059999999997, 337.5414, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4525a5eab8f9449f85', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'texture drywall - smooth / skim coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_cc021c762651477182', 78, 'SF',
      2.3, 3.33, 0.87, 36.06, 216.33, 179.39999999999998, 259.74, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_bbf8d41025754c5dbc', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'add for glued down application over concrete substrate',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e21e53c79a3d4c0bba', 47.76, 'SF',
      3.7, 5.37, 3.95, 13.32, 79.84, 176.712, 256.4712, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_ee2fb5cc153944ebba', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'paint the walls - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_a009de9a6e5b41d1b8', 425.44, 'SF',
      1.13, 1.58, 6.61, 74.28, 487.36, 480.74719999999996, 672.1952, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_bfc72eb601da48d089', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset p-trap assembly - abs (plastic)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_158d3a43e6f7492e8d', 1, 'EA',
      97.15, 140.87, 0, 19.44, 116.59, 97.15, 140.87, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_7ad67a6298d84f618f', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'r&r engineered wood flooring - premium grade',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_8fb1fa7dfeb1408e94', 142.48, 'SF',
      22.38, 29.69, 154.23, 657.48, 3944.84, 3133.1351999999997, 4230.2312, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_61b05a06f6934a0eb9', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 52.08, 'LF',
      2.62, 3.67, 0.63, 24.74, 148.45, 136.4496, 191.1336, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_88091e9a6ec14e56a8', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'seal/prime then paint the surface area (2 coats)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_0e532aa642e64b789f', 408, 'SF',
      1.63, 2.28, 8.45, 134.7, 808.19, 665.04, 930.2399999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_fadf22d9381240aab3', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset range hood - high grade',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_15e16d31985448108a', 1, 'EA',
      173.13, 251.04, 0, 34.62, 207.75, 173.13, 251.04, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c70b917d041e403089', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'baseboard - 4 1/4" mdf - flat profile',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_6531fba4f0ba45cca3', 12.83, 'LF',
      4.99, 7.24, 1.73, 13.14, 78.89, 64.02170000000001, 92.8892, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_271630b76b214599bc', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint the ceiling - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_7d78b318c0c5467296', 507.42, 'SF',
      1.13, 1.64, 7.88, 116.26, 697.52, 573.3846, 832.1688, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d4a3657d27704f3884', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 339.13, 'SF',
      0.46, 0.67, 3.51, 31.9, 191.41, 155.9998, 227.21710000000002, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e83262a98fda4d7e87', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint door or window opening - 1 coat (per side)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_a19257d956e0461cbd', 4, 'EA',
      36.38, 52.75, 1.53, 29.4, 176.45, 145.52, 211, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_7a419940e2da4a939a', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', '5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_0950c82963f24c75b7', 3, 'SF',
      5.51, 8.27, 0.2, 3.34, 20.07, 16.53, 24.81, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_10396e51fd43400b8c', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_dde72efa8bb0449bb4', 31, 'LF',
      5.1, 7.39, 4.87, 32.6, 195.57, 158.1, 229.09, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1bf15032c3224b99aa', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'paint the walls - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_a009de9a6e5b41d1b8', 452.44, 'SF',
      1.13, 1.58, 7.02, 103.66, 621.94, 511.25719999999995, 714.8552000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9f65f05bed274fbe85', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r backsplash - solid surface - unattached',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_24c2b2ac353b4e85be', 7, 'LF',
      18.99, 27.54, 6.41, 27.86, 167.2, 132.92999999999998, 192.78, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_178c093db0d84c65a1', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'drywall patch / small repair, ready for paint',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_25baf3fcd9a947c087', 1, 'EA',
      128.98, 187.02, 0.33, 25.86, 155.17, 128.98, 187.02, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a8f5f2f5980b416796', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 137.14, 'SF',
      22.38, 25.18, 153.06, 542.16, 3252.88, 2557.6609999999996, 3453.1851999999994, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d2a153dc5ad74f91a9', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'texture drywall - smooth / skim coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_cc021c762651477182', 52.81, 'SF',
      2.3, 3.33, 0.59, 24.42, 146.47, 121.463, 175.8573, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6eafb453b6744c5bb6', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 259.8, 'SF',
      0.46, 0.67, 2.69, 24.44, 146.64, 119.50800000000001, 174.06600000000003, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_900a78b3e5f3402a98', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'tape joint for new to existing drywall - per lf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ff8d0f30b100498f8c', 8, 'LF',
      14.24, 20.65, 0.23, 22.82, 136.97, 113.92, 165.2, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_774ec16cf56c4f9a88', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'r&r plumbing fixture supply line',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_a6703bcd29df400c92', 3, 'EA',
      36.89, 53.49, 1.77, 22.5, 134.94, 110.67, 160.47, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_3390949c537640b3be', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 31, 'LF',
      2.62, 3.67, 0.37, 16.32, 97.91, 81.22, 113.77, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_014d2c38ef2e4ddd9a', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'seal/prime then paint the surface area (2 coats)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_0e532aa642e64b789f', 78, 'SF',
      1.63, 2.28, 1.61, 25.74, 154.49, 127.13999999999999, 177.83999999999997, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_7920beb2393d4e8f99', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'texture drywall - smooth / skim coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_cc021c762651477182', 47.76, 'SF',
      2.3, 3.33, 0.54, 22.08, 132.47, 109.84799999999998, 159.0408, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a69313a4ff614a2aac', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_dde72efa8bb0449bb4', 43.67, 'LF',
      5.1, 7.39, 6.86, 45.92, 275.5, 222.71699999999998, 322.7213, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b559c9a483ab4df3b8', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'paint door or window opening - 2 coats (per side)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_30f3031c4abe4f8894', 2, 'EA',
      54.14, 78.5, 1.07, 21.88, 131.23, 108.28, 157, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b519e40e65084dc498', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 124, 'SF',
      22.38, 25.18, 138.39, 490.2, 2941.19, 2312.6, 3122.32, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_bd8ded4b91514fdd96', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'paint door or window opening - 2 coats (per side)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_30f3031c4abe4f8894', 2, 'EA',
      54.14, 78.5, 1.107, 21.88, 131.23, 108.28, 157, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6eeae3b8ba1541029c', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'light fixture',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_72718d8f18b5458b92', 1, 'EA',
      103.98, 150.77, 2.85, 21.38, 128.21, 103.98, 150.77, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a791ad3e8d1c4aee9e', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'texture drywall - smooth / skim coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_cc021c762651477182', 46.5, 'SF',
      2.3, 3.33, 0.52, 21.5, 128.97, 106.94999999999999, 154.845, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_34b2ff5578754402be', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'tape joint for new to existing drywall - per lf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ff8d0f30b100498f8c', 28, 'LF',
      14.24, 20.65, 0.82, 79.9, 479.44, 398.72, 578.1999999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_0c70797686e7447f9d', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 43.67, 'LF',
      2.62, 3.67, 0.53, 22.98, 137.93, 114.4154, 160.2689, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_beca15aab76c456793', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_607edea1787a45fe97', 54.17, 'LF',
      4.61, 6.68, 0.09, 49.96, 299.77, 249.72370000000004, 361.8556, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_aadb609a30904381b4', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset cabinetry - lower (base) units - high grade',
      (SELECT id FROM work_item_types WHERE key = 'cabinetry'), 'td_560e3dcfc69f4768b6', 9, 'LF',
      112.51, 168.77, 0, 202.52, 1215.11, 1012.59, 1518.93, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e4a1637f4fd34d7caf', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset light bar - 3 lights',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_d3337d3654614545a5', 1, 'EA',
      99.88, 144.83, 0, 19.98, 119.86, 99.88, 144.83, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_ee9f2eb1b417458185', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset light fixture',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_28dc521968064e9abe', 1, 'EA',
      99.88, 144.83, 0, 19.98, 119.86, 99.88, 144.83, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_cc71637aabb943b797', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset p-trap assembly - abs (plastic)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_158d3a43e6f7492e8d', 1, 'EA',
      97.15, 140.87, 0, 19.44, 116.59, 97.15, 140.87, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1516c4dfe04b4afa9b', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'r&r floor drain - tub/shower - metal/plastic',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_7da3f93feda5436395', 1, 'EA',
      75.32, 109.21, 0.9, 15.24, 91.46, 75.32, 109.21, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9312efa617cc406cb0', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'detach & reset light fixture',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_28dc521968064e9abe', 1, 'EA',
      99.88, 144.83, 0, 19.98, 119.86, 99.88, 144.83, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5e1f531f9e45412ca6', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset smoke detector',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_11385b82d7234d87b6', 1, 'EA',
      96.73, 140.26, 0, 19.34, 116.07, 96.73, 140.26, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_20059d003ed441bc91', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'baseboard - 4 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_5e49774db98341658c', 40, 'LF',
      5.97, 8.66, 8.76, 0, 247.56, 238.79999999999998, 346.4, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_47907fd1631544db8c', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'detach & reset smoke detector',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_11385b82d7234d87b6', 1, 'EA',
      96.73, 140.26, 0, 19.34, 116.07, 96.73, 140.26, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e4c272f8d7314af1b9', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'shower pan - hot mop - 17 to 30 sf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_411b67cf312941af93', 1, 'EA',
      686.7, 995.72, 2.1, 137.76, 826.56, 686.7, 995.72, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5972453d047c442780', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'detach & reset washer/washing machine - front-loading',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_90b934494b51471aa4', 1, 'EA',
      75.48, 109.45, 0, 15.1, 90.58, 75.48, 109.45, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_171ab216e05245088b', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset door bell/chime',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_60d37ac0cabe4baab7', 1, 'EA',
      94.44, 136.94, 0, 18.88, 113.32, 94.44, 136.94, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b568fdcff44a4bdcb6', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'paint baseboard - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_897dc5390fff45fdba', 54.17, 'LF',
      1.67, 2.34, 0.51, 18.2, 109.17, 90.4639, 126.7578, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_745d7b904d224969a8', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'add for glued down application over concrete substrate',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e21e53c79a3d4c0bba', 25.42, 'SF',
      3.7, 5.37, 2.1, 19.24, 115.39, 94.05400000000002, 136.5054, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5253626904374190ba', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'texture drywall - smooth / skim coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_cc021c762651477182', 40, 'SF',
      2.3, 3.33, 0.45, 18.5, 110.95, 92, 133.2, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_48d1ab21f9ac49f6b4', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'r&r engineered wood flooring - premium grade',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_8fb1fa7dfeb1408e94', 161.99, 'SF',
      22.38, 29.69, 175.34, 747.48, 4484.98, 3562.1601, 4809.4831, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1547420b0f114afa98', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset thermostat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_e431cbac10c546e799', 1, 'EA',
      81.85, 118.68, 0, 16.38, 98.23, 81.85, 118.68, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1c343b5b77a340e5a8', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'r&r countertop - granite or marble - high grade',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'td_14b6742cc4c545eca3', 112.03, 'SF',
      110.73, 160.56, 410.37, 2563.1, 15378.55, 12405.081900000001, 17987.5368, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_04544e0e72cc4b4eba', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 54.17, 'LF',
      2.62, 3.67, 0.65, 28.52, 171.1, 141.9254, 198.8039, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_41148d8069dc4fa395', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'detach & reset refrigerator - side by side - 16 to 22 cf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_956a8f4ab2cc443abd', 1, 'EA',
      77.58, 112.49, 0, 15.52, 93.1, 77.58, 112.49, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5d1f474e83db4c2487', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'r&r baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_9b005d3b79184177a9', 54.17, 'LF',
      5.82, 8.44, 8.5, 64.76, 388.53, 315.2694, 457.1948, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6243f3918d234167a5', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 25.42, 'SF',
      0.46, 0.67, 0.26, 2.4, 14.35, 11.693200000000001, 17.0314, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_dc0c6abd60714ec0bb', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'baseboard - 4 1/4" mdf - flat profile',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_6531fba4f0ba45cca3', 17.25, 'LF',
      4.99, 7.24, 2.32, 17.68, 106.08, 86.0775, 124.89, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_0a2e80f9ba0f44aa91', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 161.99, 'SF',
      0.46, 0.67, 1.68, 15.24, 91.44, 74.51540000000001, 108.53330000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_fc85c208fe1c4b3fb9', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'r&r plumbing fixture supply line',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_a6703bcd29df400c92', 2, 'EA',
      36.89, 53.49, 1.18, 15, 89.96, 73.78, 106.98, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6973163015d042159a', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 47.76, 'SF',
      22.38, 25.18, 49.68, 175.96, 1055.75, 890.7239999999999, 1202.5968, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c971beff43064477a8', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'r&r 5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_6bb1ee46bb1c40c48e', 47.76, 'SF',
      6.17, 9.25, 3.21, 59.58, 357.47, 294.6792, 441.78, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e5d8309cc9ca4fb099', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint door or opening - 1 coat (per side)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_4c6b5734556a478dbc', 2, 'EA',
      36.38, 52.75, 0.77, 14.72, 88.25, 72.76, 105.5, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_44348d6c64a346d89d', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset tv brackets - wall mounted',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_8a6937e41faa4be3b4', 1, 'EA',
      70.84, 102.72, 0, 14.16, 85, 70.84, 102.72, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_600fce0d576f45f697', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'detach & reset tv brackets - wall mounted',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_8a6937e41faa4be3b4', 1, 'EA',
      70.84, 102.72, 0, 14.16, 85, 70.84, 102.72, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_297c8e8ce3614b3584', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_6a1ed3107eff432ab6', 27.5, 'LF',
      2.51, 3.64, 0.4, 13.88, 83.31, 69.02499999999999, 100.10000000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_fdb84ed08a3a41f9a3', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 157.78, 'SF',
      0.46, 0.67, 1.63, 14.84, 89.05, 72.5788, 105.71260000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_cd9a9d7531a14c34aa', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 40, 'LF',
      2.62, 3.67, 0.48, 14.3, 105.28, 104.80000000000001, 146.8, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f1676e480f4c45bfb9', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 142.48, 'SF',
      0.46, 0.67, 1.47, 13.4, 80.41, 65.5408, 95.4616, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d099f05dfa144c41b8', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'detach & reset dryer - electric',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_f42993fb1264415da2', 1, 'EA',
      58.19, 84.38, 0, 11.64, 69.83, 58.19, 84.38, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2afbfe9d253247eb99', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 124, 'SF',
      0.46, 0.67, 1.28, 11.66, 69.98, 57.04, 83.08, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_53e340cb4e5d4a26be', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 118.55, 'SF',
      0.46, 0.67, 1.23, 11.14, 66.9, 54.533, 79.4285, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_08f325be226241d980', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'contents - move out then reset - large room',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'td_532483a594c948a2a9', 1, 'EA',
      159.21, 254.74, 0, 31.84, 191.05, 159.21, 254.74, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b6192344edd645bf96', (SELECT id FROM rooms WHERE room_code = 'entry_foyer'), 'Entry/Foyer', 'lower level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 123.78, 'SF',
      0.46, 0.67, 1.28, 11.64, 69.86, 56.9388, 82.93260000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_172b765d75224cd4a6', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'content manipulation charge - per hour',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'td_2f1a577f94b6410f86', 3, 'HR',
      72.32, 115.71, 0, 0, 216.96, 216.95999999999998, 347.13, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_212723ba890d402c9b', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 259.8, 'SF',
      22.38, 25.18, 289.26, 1027.06, 6162.29, 4845.2699999999995, 6541.764, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9c3f854d52e74a5e8b', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'paint door or window opening - 2 coats (per side)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_30f3031c4abe4f8894', 1, 'EA',
      54.14, 78.5, 0.54, 10.92, 65.6, 54.14, 78.5, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4d605a45dcb14199bf', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'paint door or window opening - 2 coats (per side)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_30f3031c4abe4f8894', 1, 'EA',
      54.14, 78.5, 0.54, 10.92, 65.6, 54.14, 78.5, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_211bd233c8904a889a', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'detach & reset countertop - granite or marble - high grade',
      (SELECT id FROM work_item_types WHERE key = 'countertop'), 'td_2bcb08e7998841fd99', 10, 'SF',
      56.06, 81.29, 0.06, 112.14, 672.8, 560.6, 812.9000000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_53348a78369c49a884', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'contents - move out then reset',
      (SELECT id FROM work_item_types WHERE key = 'contents'), 'td_20e547b0114c456d85', 1, 'EA',
      106.14, 169.82, 0, 21.22, 127.36, 106.14, 169.82, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2bc500c6e6324590ab', (SELECT id FROM rooms WHERE room_code = 'living_room'), 'Living Room', 'lower level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 66.83, 'LF',
      2.62, 3.67, 0.81, 35.18, 211.08, 175.0946, 245.2661, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a63123b7fe17420e99', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset baseboard - 2 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_2c48eb6baac4415fb5', 38.17, 'LF',
      4.61, 6.68, 0.07, 35.22, 211.25, 175.96370000000002, 254.97560000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4be0e57245514937b7', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_607edea1787a45fe97', 38.17, 'LF',
      4.61, 6.68, 0.07, 35.22, 211.25, 175.96370000000002, 254.97560000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_571d58baec7f4cc5a6', (SELECT id FROM rooms WHERE room_code = 'jason_s_office'), 'Jason''s Office', 'upper level', 'detach & reset bypass (sliding) door set - colonist',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_45fa402fd20949e6bf', 1, 'EA',
      52.04, 75.46, 0, 10.4, 62.44, 52.04, 75.46, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b4f41693d6d649e995', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'detach & reset bypass (sliding) door set - colonist',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_45fa402fd20949e6bf', 1, 'EA',
      52.04, 75.46, 0, 10.4, 62.44, 52.04, 75.46, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_852f26d163b14adc9a', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'paint stair skirt / apron',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_83f8d0a7b6dd4597a1', 5, 'LF',
      10.31, 14.95, 0.17, 10.36, 62.08, 51.550000000000004, 74.75, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4304c09d2a15481cb2', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'casing - 2 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_382bf54f98364279bd', 16.25, 'LF',
      3.13, 4.54, 1.99, 10.58, 63.43, 50.8625, 73.775, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_0320d6648ae74301a0', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'detach & reset window drapery - hardware',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_070612ac0d844455a0', 1, 'EA',
      50.63, 73.41, 0, 1012, 60.75, 50.63, 73.41, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_a62006745ee74deaaa', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'paint the ceiling - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_7d78b318c0c5467296', 44.51, 'SF',
      1.13, 1.64, 0.69, 10.2, 61.19, 50.296299999999995, 72.9964, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_38176a2e43614484a0', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset toilet',
      (SELECT id FROM work_item_types WHERE key = 'plumbing_bath'), 'td_33f8b2273bae431c89', 1, 'EA',
      393.41, 668.8, 0.71, 78.82, 472.94, 393.41, 668.8, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_90ffbf8b790745718d', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'final cleaning - construction - residential',
      (SELECT id FROM work_item_types WHERE key = 'cleaning'), 'td_f50256229a604d85b2', 85.9, 'SF',
      0.47, 0.7, 0, 8.08, 48.45, 40.373, 60.13, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f998d18cf4284c908f', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'paint baseboard - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_897dc5390fff45fdba', 38.17, 'LF',
      1.67, 2.34, 0.36, 12.82, 76.92, 63.743900000000004, 89.3178, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_de0d54f15fe6456a8a', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'paint ceiling - one coat',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_def7d2122edb49e890', 43.06, 'SF',
      1.13, 1.64, 49.33, 0, 49.33, 48.657799999999995, 70.6184, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_8de0fe593f88494b94', (SELECT id FROM rooms WHERE room_code = 'primary_bathroom'), 'Primary Bathroom', 'upper level', 'detach & reset custom cabinets - full height units',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_5da1663dcb60416fbe', 6, 'LF',
      112.03, 162.44, 0, 134.44, 806.62, 672.1800000000001, 974.64, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_53a7ef28e8114f6992', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'paint door or window opening - large - 1 coat (per side)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_d56524662e574c11b8', 1, 'EA',
      42.8, 62.06, 0.45, 8.66, 51.91, 42.8, 62.06, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_12d337b975584314a3', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'seal & paint casing - two coats',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_d7c1352cda424e9bab', 16.25, 'LF',
      2.63, 3.81, 0.21, 8.58, 51.53, 42.7375, 61.9125, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_484c9492307c4c76b2', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'install flue cap hallway',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_df3357539aef44c899', 1, 'EA',
      37.97, 55.06, 0, 7.6, 45.57, 37.97, 55.06, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_3823373dde724f7a95', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset interior door - birch - slab only',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ffe4982cd4ab45beb1', 1, 'EA',
      36.86, 53.45, 0, 7.38, 44.24, 36.86, 53.45, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_c89a799b02b34371a7', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'detach & reset interior door - birch - slab only',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ffe4982cd4ab45beb1', 1, 'EA',
      36.86, 53.45, 0, 7.38, 44.24, 36.86, 53.45, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_1c7aef595b594331bc', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'detach & reset baseboard - 2 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_2c48eb6baac4415fb5', 50.33, 'LF',
      4.61, 6.68, 0.09, 46.42, 278.53, 232.0213, 336.20439999999996, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_d69b333116374aeda7', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'detach & reset baseboard - 3 1/4"',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_607edea1787a45fe97', 50.33, 'LF',
      4.61, 6.68, 0.09, 46.42, 278.53, 232.0213, 336.20439999999996, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_5bb1712c4b6a4a4fb1', (SELECT id FROM rooms WHERE room_code = 'justin_s_office'), 'Justin''s Office', 'upper level', 'detach & reset interior door - birch - slab only',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ffe4982cd4ab45beb1', 1, 'EA',
      36.86, 53.45, 0, 7.38, 44.24, 36.86, 53.45, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_388b4dee69c848d1be', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'detach & reset interior door - birch - slab only',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ffe4982cd4ab45beb1', 1, 'EA',
      36.86, 53.45, 0, 7.38, 44.24, 36.86, 53.45, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f0d7cfd739d347cc9c', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'detach & reset interior door - birch - slab only',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ffe4982cd4ab45beb1', 1, 'EA',
      36.86, 53.45, 0, 7.38, 44.24, 36.86, 53.45, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6f58c69a89e24617ba', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 191, 'SF',
      22.38, 25.18, 176.09, 623.74, 3742.43, 3562.1499999999996, 4809.38, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_17cb43eb4d0c4e109d', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'final cleaning - construction - residential',
      (SELECT id FROM work_item_types WHERE key = 'cleaning'), 'td_f50256229a604d85b2', 157.78, 'SF',
      0.47, 0.7, 0, 14.84, 89, 74.1566, 110.446, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_6035895c223c441bb3', (SELECT id FROM rooms WHERE room_code = 'hall_bathroom'), 'Hall Bathroom', 'upper level', 'paint door or window closet (1) opening - 1 coat (per side)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_3b1978ba4cdf4ba0bc', 1, 'EA',
      36.38, 52.75, 0.38, 7.36, 44.12, 36.38, 52.75, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_497b1966d5874fd9b7', (SELECT id FROM rooms WHERE room_code = 'primary_bedroom'), 'Primary Bedroom', 'upper level', 'paint baseboard - one coat',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_897dc5390fff45fdba', 50.33, 'LF',
      1.67, 2.34, 0.48, 16.92, 101.45, 84.05109999999999, 117.77219999999998, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_3fa7b87db89a4b8e84', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'paint door or window opening - 1 coat (per side)',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_a19257d956e0461cbd', 3, 'EA',
      36.38, 52.75, 1.15, 22.06, 132.35, 109.14000000000001, 158.25, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_847381b0992c4a44bb', (SELECT id FROM rooms WHERE room_code = 'guest_bathroom'), 'Guest Bathroom', 'lower level', 'detach & reset bathroom mirror - w/metal frame - surface mtd. - std grd',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_aa9680e7137a4a9396', 2.5, 'SF',
      13.74, 19.92, 0, 6.88, 41.23, 34.35, 49.800000000000004, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_8bcdb06be30644febc', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'final cleaning - construction - residential',
      (SELECT id FROM work_item_types WHERE key = 'cleaning'), 'td_f50256229a604d85b2', 82.89, 'SF',
      0.47, 0.7, 0, 7.8, 46.76, 38.9583, 58.022999999999996, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_36bec1359e284bb99f', (SELECT id FROM rooms WHERE room_code = 'guest_bedroom'), 'Guest Bedroom', 'lower level', 'tape joint for new to existing drywall - per lf',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_ff8d0f30b100498f8c', 48.58, 'LF',
      14.24, 20.65, 1.42, 138.64, 831.84, 691.7792, 1003.1769999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9ce91c08adf94cfda2', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'detach & reset bypass (sliding) door set - colonist',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_45fa402fd20949e6bf', 0.5, 'EA',
      52.04, 75.46, 0, 5.2, 31.22, 26.02, 37.73, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_f72af521045b4c5bac', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'r&r engineered wood flooring - premium grade',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_8fb1fa7dfeb1408e94', 19.98, 'SF',
      22.38, 29.69, 21.63, 92.18, 553.17, 439.36019999999996, 593.2062000000001, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_e1187039fa6a49f89c', (SELECT id FROM rooms WHERE room_code = 'stairs'), 'Stairs', 'upper level', 'seal/prime then paint the surface area (2 coats)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_0e532aa642e64b789f', 52.81, 'SF',
      1.63, 2.28, 1.09, 17.44, 104.61, 86.0803, 120.40679999999999, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_38bcc68b14244a5794', (SELECT id FROM rooms WHERE room_code = 'family_room'), 'Family Room', 'upper level', 'r&r batt insulation - 6" - r19 - unfaced batt',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_56cced29a26e419aaf', 13.5, 'SF',
      1.82, 2.64, 0.88, 5.1, 30.55, 24.57, 35.64, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_ce7dd86f345c4ddc89', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'baseboard - 4 1/4" mdf - flat profile',
      (SELECT id FROM work_item_types WHERE key = 'baseboard'), 'td_6531fba4f0ba45cca3', 32.92, 'LF',
      4.99, 7.24, 4.43, 33.74, 202.44, 164.2708, 238.34080000000003, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_2c41dfba1f744b1bb3', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'engineered wood floor - specs from independent analysis',
      (SELECT id FROM work_item_types WHERE key = 'flooring'), 'td_1fa492b8affb46a2b3', 53.64, 'SF',
      22.38, 25.18, 59.87, 212.06, 1272.32, 1000.386, 1350.6552, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_4324dd18f8a64ca3ac', (SELECT id FROM rooms WHERE room_code = 'kitchen'), 'Kitchen', 'upper level', 'seal and paint window',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_508dafbce0c9467e9f', 5, 'LF',
      4.48, 6.5, 0.14, 4.5, 27.04, 22.400000000000002, 32.5, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_b7b11f84515d4c35ab', (SELECT id FROM rooms WHERE room_code = 'laundry'), 'Laundry', 'lower level', 'floor protection - plastic and tape - 10 mil',
      (SELECT id FROM work_item_types WHERE key = 'general'), 'td_c2e74bbbe17b4e0bba', 47.76, 'SF',
      0.46, 0.67, 0.49, 4.5, 26.96, 21.9696, 31.999200000000002, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_9a75b3d9d9ef41409c', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'r&r 5/8" drywall - hung, taped, with smooth wall finish',
      (SELECT id FROM work_item_types WHERE key = 'drywall'), 'td_6bb1ee46bb1c40c48e', 181.42, 'SF',
      6.17, 9.25, 12.21, 226.3, 1357.87, 1119.3614, 1678.135, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_0c1f47c0e0d64a42bf', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'seal & paint baseboard - two coats',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_b6c630c5f53649b090', 32.92, 'LF',
      2.62, 3.67, 0.4, 17.34, 103.99, 86.25040000000001, 120.8164, ''
    );
INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      'sc_85110d128f944bfdbb', (SELECT id FROM rooms WHERE room_code = 'storage'), 'Storage', 'lower level', 'seal/prime then paint the surface area (2 coats)',
      (SELECT id FROM work_item_types WHERE key = 'paint'), 'td_0e532aa642e64b789f', 217.33, 'SF',
      1.63, 2.28, 3.76, 59.9, 359.37, 295.71459999999996, 495.5124, ''
    );

-- Seed static_budget_items
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_d46dc2668f154667ba', 'Windows & Doors', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Living Room (Upstairs)',
      '', 'Pella Impervia Box Bay (3-Wide Casement)', 1, 'EA',
      NULL, NULL, 9500, 10250, 11000,
      NULL, 'Black interior/exterior, inset blinds.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_20d75fd4edb748f7b0', 'Windows & Doors', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Kitchen (Upstairs)',
      '', 'Pella Casement Window', 1, 'EA',
      NULL, NULL, 2200, 2500, 2800,
      NULL, 'Adjusted height for sink clearance.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_3f4348b6b74a41a784', 'Windows & Doors', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary bedroom and Justin''s office (back bedrooms)',
      '', 'Pella Casement Windows', 2, 'EA',
      NULL, NULL, 4800, 5150, 5500,
      NULL, 'Black interior/exterior, inset blinds.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_c4b1dc8c7c5649909f', 'Windows & Doors', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Lower Level Living',
      '', 'Multi-Panel Stackable Glass Sliding Door', 1, 'EA',
      NULL, NULL, 20000, 22000, 24000,
      NULL, 'Includes structural framing alteration.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_ad78f91358d54e5d9a', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Upper Level (Total)',
      '', 'Hardwood Flooring - Material (Min/Mid/Max grades)', 900, 'SF',
      NULL, NULL, 7200, 13500, 19800,
      NULL, 'Material only. Min: $8/SF. Mid: $14/SF. Max: $22/SF.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_237dcb96667048b893', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bedroom',
      '', 'Hardwood - Installation & Prep', 160, 'SF',
      NULL, NULL, NULL, NULL, NULL,
      NULL, 'Installation labor.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_bcbb4d468f2947d897', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Bedroom 2 / Library',
      '', 'Hardwood - Installation & Prep', 130, 'SF',
      NULL, NULL, NULL, NULL, NULL,
      NULL, 'Installation labor.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_9633792d3a4846a781', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Hallway',
      '', 'Hardwood - Installation & Prep', 80, 'SF',
      NULL, NULL, NULL, NULL, NULL,
      NULL, 'Installation labor.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_2188fde12ab84f1a80', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Kitchen',
      '', 'Hardwood - Installation & Prep', 120, 'SF',
      NULL, NULL, NULL, NULL, NULL,
      NULL, 'Installation labor.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_05f064efc403475eb0', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Living / Dining',
      '', 'Hardwood - Installation & Prep', 350, 'SF',
      NULL, NULL, NULL, NULL, NULL,
      NULL, 'Installation labor.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_8121de32e44f4286b6', 'Flooring', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Stairs',
      '', 'Hardwood - Stair Tread Installation', 60, 'SF',
      NULL, NULL, 800, 1150, 1500,
      NULL, 'Stairs carry higher labor premiums.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_64aeffde62794eefbf', 'Flooring', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Entire ground floor',
      '', 'Concrete Slab Micro-Polishing', 1, 'LS',
      NULL, NULL, 12000, 13250, 14500,
      NULL, 'Grind to matte finish.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_4d43dd06da06407f8c', 'Flooring', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Entire ground floor',
      '', 'Epoxy Vapor Barrier / Waterproof Sealant', 1, 'LS',
      NULL, NULL, 3500, 4250, 5000,
      NULL, 'Mitigates subsurface water vapor.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_1ef194712c0d45ddaa', 'Plumbing', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bath',
      '', 'Toilet Plumbing Relocation (Original Footprint)', 1, 'LS',
      NULL, NULL, 1500, 2000, 2500,
      NULL, 'Reversing the flipper modification; avoids the $6k cross-room quote.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_cfc5079832764d51bf', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bath',
      'Primary shower installation', 'Shower Option A: Custom Center Wall (Dual Rain Heads)', 1, 'LS',
      NULL, NULL, 15000, 18500, 22000,
      NULL, 'Dream layout under skylight.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_9f20028bf48340ec85', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bath',
      'Primary shower installation', 'Shower Option B: In-Kind Footprint Refinish', 1, 'LS',
      NULL, NULL, 8000, 10000, 12000,
      NULL, 'Tucked to the side; new tile and pan.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_ffe29ac9f59944d28b', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bath',
      '', 'Double Vanity & Sinks', 1, 'LS',
      NULL, NULL, 1800, 2400, 3000,
      NULL, 'High-end finishes or remnants.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_3eef8c67524a416687', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bath',
      '', 'New Toilet (Hardware)', 1, 'EA',
      NULL, NULL, 450, 625, 800,
      NULL, 'Hardware only.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_f0b3aaa1c667401cb5', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Primary Bath',
      '', 'Laundry Relocation (Electrical & Venting)', 1, 'LS',
      NULL, NULL, 3000, 3750, 4500,
      NULL, 'Route 240V ~30ft; tie into existing wall vent.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_280a578eadf8447185', 'Bathrooms', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Guest Bath',
      '', 'Shower Retile & Pan Install', 1, 'LS',
      NULL, NULL, 4000, 5250, 6500,
      NULL, 'Retaining existing glass enclosure.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_3362bda2f02f4e3689', 'Bathrooms', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Guest Bath',
      '', 'Single Vanity & Sink', 1, 'LS',
      NULL, NULL, 600, 900, 1200,
      NULL, 'Hardware and installation.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_3eec09a928c94e2b8b', 'Bathrooms', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Guest Bath',
      '', 'New Toilet (Hardware)', 1, 'EA',
      NULL, NULL, 450, 625, 800,
      NULL, 'Hardware only.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_61daa01b2ff34b28a1', 'Bathrooms', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Guest Bath',
      '', 'Copper Plumbing Verification & Preventative Fixes', 1, 'LS',
      NULL, NULL, 600, 800, 1000,
      NULL, 'Leak prevention check.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_b0ccff47fe924260a4', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Hall Bath',
      '', 'Shower Retile & Pan Install', 1, 'LS',
      NULL, NULL, 4000, 5250, 6500,
      NULL, 'Retaining existing glass enclosure.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_69e73d489bf24d83ad', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Hall Bath',
      '', 'Single Vanity & Sink', 1, 'LS',
      NULL, NULL, 600, 900, 1200,
      NULL, 'Hardware and installation.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_9c48ad6d3218451a92', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Hall Bath',
      '', 'New Toilet (Hardware)', 1, 'EA',
      NULL, NULL, 450, 625, 800,
      NULL, 'Hardware only.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_3848547398e74adcbc', 'Bathrooms', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Hall Bath',
      '', 'Copper Plumbing Verification & Preventative Fixes', 1, 'LS',
      NULL, NULL, 600, 800, 1000,
      NULL, 'Leak prevention check.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_fa7c2990de88463691', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Cabinetry',
      'Kitchen Upstairs w/ new layout
Kitchen Downstairs in guest bedroom', '[Option A: U-Shape (Lowers Only + Island)]
Natural walnut custom wood cabinets', 1, 'LS',
      NULL, NULL, 22000, 25000, 28000,
      NULL, 'Greater lower footprint offsets lack of uppers.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_4396bae0c9174d13a7', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Cabinetry',
      'Kitchen Upstairs in-kind
Kitchen Downstairs in living room', '[Option B: L-Shape (Lowers + Uppers)]
Natural walnut custom wood cabinets', 1, 'LS',
      NULL, NULL, 22000, 25000, 28000,
      NULL, 'Standard footprint.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_39c7842ff382482fb1', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Countertops',
      'Kitchen Upstairs w/ new layout
Kitchen Downstairs in guest bedroom', '[Option A: U-Shape (Lowers Only + Island)]
Natural Stone with Half-Backsplash & Shelf', 1, 'LS',
      NULL, NULL, 15000, 20000, 25000,
      NULL, 'Includes island slab.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_13ae509ec5e74e15a3', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Countertops',
      'Kitchen Upstairs in-kind
Kitchen Downstairs in living room', '[Option B: L-Shape (Lowers + Uppers)]
Natural stone with Backsplash between uppers and lowers', 1, 'LS',
      NULL, NULL, 10000, 15000, 20000,
      NULL, NULL, 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_1174d2b8b3604c8e89', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Kitchen',
      'Appliances', 'Appliances: Keep Existing', 1, 'LS',
      NULL, NULL, NULL, NULL, NULL,
      NULL, 'Retain Wolf range, Bosch fridge/DW.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_b3bbacd98a9442bdad', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Kitchen',
      'Appliances', 'Appliances: Buy New (Induction, Sub-Zero, Wall Oven)', 1, 'LS',
      NULL, NULL, 16000, 19000, 22000,
      NULL, 'Hidden induction, panel-ready cooling/washing.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_191bbc9673b04d2fae', 'Kitchen', (SELECT id FROM floors WHERE key = 'lower_level'), 'upper or lower level', 'Kitchen',
      'Appliances', 'Appliances: Sell Existing Wolf/Bosch Appliances', 1, 'LS',
      NULL, NULL, -4500, -5750, -7000,
      NULL, 'Estimated secondary market recovery.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_124b6812e4224bc892', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Rear Yard',
      '', 'B2R French Drain & Piping', 125, 'LF',
      NULL, NULL, 10500, 11250, 12000,
      NULL, 'Perimeter routing to basin.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_fea8113345964d0cb3', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Rear Yard',
      '', 'B2R Corner Foundation Excavation & Waterproofing', 1, 'LS',
      NULL, NULL, 3000, 3250, 3500,
      NULL, 'Targeted defect repair.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_f89162d195ca42b796', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Rear Yard',
      '', 'New Sump Pump Installation & Connection', 1, 'LS',
      NULL, NULL, 2000, 2750, 3500,
      NULL, 'Ties into existing/new drain paths.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_832e19d34ae54336ad', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Patio',
      '', 'Decking Tile Matrix (Aluminum Frame + Tile)', 225, 'SF',
      NULL, NULL, 3800, 4650, 5500,
      NULL, 'Assumes 9x25 footprint.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_0222b16122c9456c95', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Patio',
      '', 'Concrete Pony Wall Demolition', 1, 'LS',
      NULL, NULL, 1200, 1500, 1800,
      NULL, 'Removes the 4ft purple cinderblock wall.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_885ef504575945848a', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Yard',
      '', 'Utility Trenching (Irrigation & 120V to Retaining Walls)', 1, 'LS',
      NULL, NULL, 2000, 2750, 3500,
      NULL, 'Prep for future landscaping.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_a276b1cd99934205a5', 'Drainage', (SELECT id FROM floors WHERE key = 'outside'), 'outside', 'Yard',
      '', 'Landscaping & Planting Allocation', 1, 'LS',
      NULL, NULL, 8000, 11500, 15000,
      NULL, 'Post-construction terrain recovery.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_9a53c0f1dc734effb5', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Interior doors', 'Interior Doors (Standard)', 6, 'EA',
      NULL, NULL, 1300, 1975, 2650,
      NULL, 'Solid core, hardware included.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_737a35eecb7e42f783', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Interior doors', 'Interior Doors (Premium)', 6, 'EA',
      NULL, NULL, 2400, 3000, 3600,
      NULL, 'Solid core, hardware included.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_34bcb06c62f745cda8', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      '', 'Drywall Float & Tape (Total Estimated)', 3500, 'SF',
      NULL, NULL, 7000, 8750, 10500,
      NULL, 'Smooth finish, comprehensive patching.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_98fe0cc768b24d4aba', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      '', 'Paint (Total Estimated)', 3500, 'SF',
      NULL, NULL, 5500, 7000, 8500,
      NULL, 'Includes ceiling, trim, and walls.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_cfe47b558d6249ec9a', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Baseboard finish', 'Baseboards - Traditional Style', 400, 'LF',
      NULL, NULL, 2400, 2800, 3200,
      NULL, 'Standard 4-inch profile.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_098809ba78124a4e9e', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Baseboard finish', 'Baseboards - Flush / Architectural / Recessed', 400, 'LF',
      NULL, NULL, 6000, 7250, 8500,
      NULL, 'Requires precise drywall finishing.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_0f367be453054008b0', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Ligting options', 'Lighting - Recessed Decommissioning & Minimalist Install', 1, 'LS',
      NULL, NULL, 4500, 6000, 7500,
      NULL, 'Capping old cans; installing strategic pendants/flush mounts.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_8a3fc01401c749d29a', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Ligting options', 'Lighting - Standard Recessed (Canless LED)', NULL, 'EA',
      220, 460, NULL, NULL, NULL,
      NULL, 'Traditional downlighting; functional but creates ceiling clutter and high overhead glare.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_57a4e63351ac4af0b3', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Ligting options', 'Lighting - Flush Mounted (Minimalist Surface)', 6, 'EA',
      200, 600, 1200, 2400, 3600,
      NULL, 'Low-profile surface fixtures; simple junction box installation with minimal drywall disruption.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_8b29348c35734c1a9b', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Ligting options', 'Lighting - Trimless Recessed Track (Hidden Magnetic)', 5, 'LF',
      150, 350, 750, 1250, 1750,
      NULL, 'Mud-in low-voltage slots. High labor for precise drywall framing and finishing directly to the track flange.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_7cbca081e36a481f8e', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Ligting options', 'Lighting - Bespoke Modern Spotlights (Monopoint)', 10, 'EA',
      300, 750, 3000, 5250, 7500,
      NULL, 'Premium adjustable directional fixtures used to create high-contrast, dramatic pools of targeted light.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_7f29c1a89397440c90', 'all levels', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      'Ligting options', 'Lighting - Modern Wall Fixtures (Sconces)', 6, 'EA',
      400, 1050, 2400, 4350, 6300,
      NULL, 'High-end vertical/indirect lighting; requires cutting drywall and routing new in-wall electrical lines.', 'Static Budget Items'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_8933938c3b57429aaa', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'SF DBI Permit & Plan Check Fees', 1, 'LS',
      NULL, NULL, 4000, NULL, 8000,
      'Phase 1: Critical Path', 'Calculated on total project valuation. Required prior to open-stud framing close-up inspection.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_5263992840734519ad', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'Structural Engineering Fees', 1, 'LS',
      NULL, NULL, 3500, NULL, 6000,
      'Phase 1: Critical Path', 'Wet-stamped calculations required for load-bearing wall removal, engineered headers, and 7ft deep ceiling step-up framing.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_1e45367e94274f42bd', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'General Electrical Rough-In Wiring (Whole-House)', 1, 'LS',
      NULL, NULL, 12000, NULL, 20000,
      'Phase 1: Critical Path', 'Rough-in labor and materials for outlets, switches, and dedicated appliance circuits (Induction cooktop, wall ovens, mini-split condenser).', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_dbff1fedf4eb484eb4', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'Title 24 Energy Compliance & HERS Field Testing', 1, 'LS',
      NULL, NULL, 1500, NULL, 2500,
      'Phase 1: Critical Path', 'Mandatory CA energy documentation and independent third-party testing for altered lighting and mini-split refrigerant lines.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_f1a5c7371fd24e3c95', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'Commercial Inline Scale Inhibition System', 1, 'LS',
      NULL, NULL, 500, NULL, 800,
      'Phase 2: Deferrable', 'Protects the high-end 6kW-9kW steam shower generator from SF water mineral calcification; extends equipment lifespan.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_f9fbdc05c80c4b3fa0', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'Drywall Float & Tape (Surface Area Adjustment)', 1, 'LS',
      NULL, NULL, 14000, NULL, 22000,
      'Phase 1: Critical Path', 'Correction for actual 6,500-7,500 SF wall/ceiling surface area across both levels based on base unit pricing index.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_3ea9d387575d40f1a9', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'Level 5 Drywall Smooth Finish Skim Coat Premium', 1, 'LS',
      NULL, NULL, 3500, NULL, 5500,
      'Phase 1: Critical Path', 'Incremental labor cost to achieve premium smooth wall finish BEFORE painting; eliminates the Phase 2 rework structural fallacy.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_aa2028ad4b3540e98d', 'Infrastructure', (SELECT id FROM floors WHERE key = 'all_levels'), 'all levels', 'House-wide',
      NULL, 'Primary Bath Add-On: Smart Shower 120V GFCI & Data Cable Rough-In', 1, 'LS',
      NULL, NULL, 450, NULL, 850,
      'Phase 1: Critical Infrastructure', 'Wiring a dedicated 120V GFCI outlet in an accessible vanity or closet pocket; routing low-voltage data conduit from the shower control pad location to the valve box.', 'Sheet6'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_4d38cc96a3a94694a3', 'Kitchen Infrastructure', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Living Room (South Wall)',
      'Kitchen Downstairs in living room', 'Concrete Slab Trenching & Dedicated Drain (Slab Cuts)', 1, 'LS',
      16000, 21000, 16000, 18500, 21000,
      NULL, 'Jackhammer slab to lay dedicated drain connecting to main sewer lateral. High complexity.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_08f81f2acee843bd80', 'Kitchen Infrastructure', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Living Room (South Wall)',
      'Kitchen Downstairs in living room', 'Venting Vertical Stack & High-Amperage Runs', 1, 'LS',
      20000, 28000, 20000, 24000, 28000,
      NULL, 'Running electrical across open slab and punching new vent stack through roof.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_37ca46cef4344b1fa4', 'Kitchen Infrastructure', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Guest Bedroom (North Wall)',
      'Kitchen Downstairs in guest bedroom', 'Plumbing Tap (Shared Bathroom Wall)', 1, 'LS',
      3000, 6000, 3000, 4500, 6000,
      NULL, 'Tapping directly into the existing wet wall of the downstairs bathroom. Avoids massive slab trenching.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_46c2b84ed3834b77ad', 'Kitchen Infrastructure', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Guest Bedroom (North Wall)',
      'Kitchen Downstairs in guest bedroom', 'Localized Electrical & Venting Runs', 1, 'LS',
      4000, 7000, 4000, 5500, 7000,
      NULL, 'Shorter, less invasive utility runs utilizing the existing structural cavities nearby.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_973c7d0de1e44c4e89', 'Structural Modifications', (SELECT id FROM floors WHERE key = 'lower_level'), 'lower level', 'Wall between Living & Guest Bed',
      'All Downstairs Kitchen Scenarios', 'Load-Bearing Wall Removal & Engineered Headers', 1, 'LS',
      45000, 59000, 45000, 52000, 59000,
      NULL, 'Requires shoring and insertion of triple 2x12 engineered headers to support the 6-foot upper cantilever.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_ea90e13ae6fb48d9ac', 'Structural Modifications', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Wall between Kitchen & Living',
      'Kitchen Upstairs w/ new layout', 'Non-Structural Partition Removal', 1, 'LS',
      2500, 5500, 2500, 4000, 5500,
      NULL, 'Demolish non-load-bearing wall to create open concept. Includes drywall patching and debris haul-away.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_b46656d59ac4436b9d', 'Windows & Doors', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Kitchen (Upstairs)',
      'Kitchen Upstairs w/ new layout', 'Window Modification & Framing Alteration', 1, 'LS',
      1800, 3200, 1800, 2500, 3200,
      NULL, 'Cost to reframe the exterior wall, raise the sill plate to accommodate countertop height, and patch exterior siding.', 'Kitchen Additions'
    );
INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      'sbi_960f8d8433ad44dda0', 'Windows & Doors', (SELECT id FROM floors WHERE key = 'upper_level'), 'upper level', 'Kitchen (Upstairs)',
      'Kitchen Upstairs w/ new layout', 'Pella Casement Window (Hardware)', 1, 'EA',
      2200, 2800, 2200, 2500, 2800,
      NULL, 'Hardware cost for the smaller, sink-height window. Black interior/exterior.', 'Kitchen Additions'
    );

-- Seed budget_variance_scenarios
INSERT INTO budget_variance_scenarios (id, scenario_key, label, kitchen_location, sub_location, layout_type, plumbing_strategy, deviation_total, notes) VALUES (
      1, 'a', 'Scenario A', 'Kitchen Downstairs', 'Living Room (South Wall)', 'Galley w/ island', 'Cut through slab for plumbing', 177284, '4-Scenario kitchen architectural layout options'
    );
INSERT INTO budget_variance_scenarios (id, scenario_key, label, kitchen_location, sub_location, layout_type, plumbing_strategy, deviation_total, notes) VALUES (
      2, 'b', 'Scenario B', 'Kitchen Downstairs', 'Guest Bedroom (North Wall)', 'U-shape', 'tap into bathroom plumbing', 80000, '4-Scenario kitchen architectural layout options'
    );
INSERT INTO budget_variance_scenarios (id, scenario_key, label, kitchen_location, sub_location, layout_type, plumbing_strategy, deviation_total, notes) VALUES (
      3, 'c', 'Scenario C', 'Kitchen Upstairs', 'New Layout', 'U-Shape', 'Move sink to window', 117304, '4-Scenario kitchen architectural layout options'
    );
INSERT INTO budget_variance_scenarios (id, scenario_key, label, kitchen_location, sub_location, layout_type, plumbing_strategy, deviation_total, notes) VALUES (
      4, 'd', 'Scenario D', 'Kitchen Upstairs', 'In Kind', 'L-Shape', 'Nothing special', 40000, '4-Scenario kitchen architectural layout options'
    );

-- Seed budget_variance_line_items
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_d1d5802223554380a0', 1, 'Shared Baseline: Kitchen Cabinets & Countertops', 4, 40000, 'Material costs remain relatively static across both options.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_13a872e1bac944cf9d', 2, 'Shared Baseline: Kitchen Cabinets & Countertops', 4, 55000, 'Material costs remain relatively static across both options.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_f3257c7adaa44e82a0', 3, 'Shared Baseline: Kitchen Cabinets & Countertops', 4, 55000, 'Material costs remain relatively static across both options.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_2bcf9bb571484950b0', 4, 'Shared Baseline: Kitchen Cabinets & Countertops', 4, 40000, 'Material costs remain relatively static across both options.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_21556e1267ea4723b3', 1, 'Wall Removal & Support Engineering', 5, 52000, 'Downstairs requires engineered headers and shoring for the upper cantilever. Upstairs is largely non-structural partition removal.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_c8000c50c5d749de94', 3, 'Wall Removal & Support Engineering', 5, 5000, 'Downstairs requires engineered headers and shoring for the upper cantilever. Upstairs is largely non-structural partition removal.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_251923f4569f454cbb', 4, 'Wall Removal & Support Engineering', 5, 0, 'Downstairs requires engineered headers and shoring for the upper cantilever. Upstairs is largely non-structural partition removal.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_3c3ed1eb5dcf4b6e8a', 1, 'Plumbing, Trenching & Electrical Core Runs', 6, 42500, 'Downstairs requires slab trenching, new vent stacks, and high-voltage runs. Upstairs utilizes existing wet walls.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_0172e9e1ecb84c7383', 2, 'Plumbing, Trenching & Electrical Core Runs', 6, 25000, 'Downstairs requires slab trenching, new vent stacks, and high-voltage runs. Upstairs utilizes existing wet walls.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_138e7e97776048fa83', 3, 'Plumbing, Trenching & Electrical Core Runs', 6, 3500, 'Downstairs requires slab trenching, new vent stacks, and high-voltage runs. Upstairs utilizes existing wet walls.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_c1b6100e0ecb42509d', 1, 'Old Kitchen to Bedroom/Library Flip', 7, 5000, 'Dismantling the upper kitchen framing to safeguard residential room valuations. Only triggered in Scenario A.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_2d0c2d1b49684d3eb5', 3, 'Old Kitchen to Bedroom/Library Flip', 7, 0, 'Dismantling the upper kitchen framing to safeguard residential room valuations. Only triggered in Scenario A.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_337d2431f9a34a1abe', 1, 'Hall Bath Relocation (Jack-and-Jill Conversion)', 8, 31084, 'Moving the hall bath into the old kitchen footprint. Only triggered in Scenario A.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_cbb49cffaf5146d4a9', 3, 'Hall Bath Relocation (Jack-and-Jill Conversion)', 8, 31804, 'Moving the hall bath into the old kitchen footprint. Only triggered in Scenario A.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_46a89fdaaea3449d94', 1, 'Hall Bath In-Place Remodel (Static Footprint)', 9, 0, 'If the kitchen stays upstairs, the hall bath remains in place and receives a standard aesthetic overhaul.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_672868ec7bc241f6b2', 2, 'Hall Bath In-Place Remodel (Static Footprint)', 9, 0, 'If the kitchen stays upstairs, the hall bath remains in place and receives a standard aesthetic overhaul.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_86b5b49d1cd747589f', 3, 'Hall Bath In-Place Remodel (Static Footprint)', 9, 15000, 'If the kitchen stays upstairs, the hall bath remains in place and receives a standard aesthetic overhaul.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_e5a9213f0bd1413db2', 1, 'Laundry Room Conversion & Relocation', 10, 5500, 'Scenario A converts old hall bath into laundry room. Scenario B routes 240V (~30ft) and venting to Primary Bath footprint.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_c95d6e06cf164362b2', 3, 'Laundry Room Conversion & Relocation', 10, 4500, 'Scenario A converts old hall bath into laundry room. Scenario B routes 240V (~30ft) and venting to Primary Bath footprint.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_1234a0c386e241d5b1', 1, 'Hallway Privacy Partition Assembly', 11, 1200, 'Constructing an interior partition frame to secure the back bedroom zone. Only triggered in Scenario A.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_2f0b2b8999fb4b5fae', 3, 'Hallway Privacy Partition Assembly', 11, 0, 'Constructing an interior partition frame to secure the back bedroom zone. Only triggered in Scenario A.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_5a86220684224c93bf', 1, 'Kitchen Window Alteration for Sink Clearance', 12, 0, 'Scenario B requires raising the current kitchen window height to clear the new sink placement.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_ed5302d59e424641a0', 2, 'Kitchen Window Alteration for Sink Clearance', 12, 0, 'Scenario B requires raising the current kitchen window height to clear the new sink placement.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_3ed59999faf94e6db9', 3, 'Kitchen Window Alteration for Sink Clearance', 12, 2500, 'Scenario B requires raising the current kitchen window height to clear the new sink placement.');
INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('bvli_27313c07ec88401f96', 4, 'Kitchen Window Alteration for Sink Clearance', 12, 0, 'Scenario B requires raising the current kitchen window height to clear the new sink placement.');

-- Seed project_system_variables
INSERT INTO project_system_variables (variable_key, value_text, unit, category, description, mapping_ref_key) VALUES (
      'SYS_BUDGET_CAP', '$300,000', 'USD', 'Financial', 'Target absolute max phase 1 ceiling', 'SYS_BUDGET_CAP'
    );
INSERT INTO project_system_variables (variable_key, value_text, unit, category, description, mapping_ref_key) VALUES (
      'ACTIVE_KITCHEN_SCENARIO', 'Scenario C', 'String', 'Architectural', 'Selected kitchen scenario layout choice', 'ACTIVE_KITCHEN_SCENARIO'
    );
INSERT INTO project_system_variables (variable_key, value_text, unit, category, description, mapping_ref_key) VALUES (
      'OPEN_FRAMING_CREDIT', '20.0%', 'Percentage', 'HVAC / Labor', 'Credit applied to mechanical installation labor hours', 'OPEN_FRAMING_CREDIT'
    );
INSERT INTO project_system_variables (variable_key, value_text, unit, category, description, mapping_ref_key) VALUES (
      'SLO_TRIGGER_VAL', '$100,000', 'USD', 'Infrastructure', 'Monetary threshold triggering lateral compliance', 'SLO_TRIGGER_VAL'
    );

-- Seed assumption_line_items & micro-variances
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_e1534e73fdfb4202b1', 'Backyard', 'Exterior French Drain Perimeter Matrix', 10500, 11250, 12000,
        'Phase 1: Critical Path', 'Water mitigation target 1. Intercept rear yard runoff to protect lower slab', 0, 19
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_f935265b6ea04c13b8', 'Backyard', 'Corner Foundation Excavation & Subsurface Proofing', 3000, 3250, 3500,
        'Phase 1: Critical Path', 'Targeted exterior envelope structural waterproofing at pony wall intersection', 1, 20
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_22853dd0cc494d2388', 'Backyard', 'Primary Upgraded Sump Core Relocation & Ejector Basin', 2000, 2750, 3500,
        'Phase 1: Critical Path', 'Mechanically lift collected structural water to storm main sewer line', 2, 21
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_77b911ee25684456b2', 'Backyard', 'Concrete Pony Wall Demolition', 1200, 1500, 1800,
        'Phase 1: Critical Path', 'Removes the 4ft purple block wall to grant waterproofing access', 3, 22
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_9101034dee034beeb2', 'Backyard', 'Aluminum Sub-Deck Grid Matrix & Porcelain Finishes', 3800, 4650, 5500,
        'Phase 1: Critical Path', 'Above-ground hardscape finish line. Over existing patio layout', 4, 23
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_7b2bb116bce349c88d', 'Backyard', 'Cosmetic Landscaping & Post-Remodel Terrain Recovery', 8000, 11500, 15000,
        'Phase 1: Critical Path', 'Aesthetic planting recovery vector including European Olive anchor tree', 5, 24
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d2158de2d015477f99', 'Backyard', 'Utility Trenching (120V & Irrigation to Rear Walls)', 2000, 2750, 3500,
        'Phase 1: Critical Path', 'Rear retaining framework preparation for future landscape lighting runs', 6, 25
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_e1e91052b90e4be4b4', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Living Room: Multi-Panel Stackable Glass Sliding Door', 20000, 22000, 24000,
        'Phase 2: Deferrable', 'Includes comprehensive structural framing alterations to expand the rear masonry/wood opening directly to the patio matrix.', 7, 28
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_9c825be3ad8a4861a2', 'Lower Level - Flooring, Windows, & Finishing', 'Path 4A: Lower Level Living door Rear 7-Foot Frame Strip & 9''1" Ceiling Reclaim', 1800, 2450, 3100,
        'TBD', 'Tearing back the existing 8ft dropped framing from the rear wall moving inward exactly 7 feet to expose the native 9''1" ceiling joists over the door envelope.', 8, 29
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_1cc6308c55054dff94', 'Lower Level - Flooring, Windows, & Finishing', 'Path 4B Lower Level Living door Soffit Termination Face & Drywall Framing Step', 1200, 1650, 2100,
        'TBD', 'Framing a crisp, perpendicular 13-inch vertical drywall step at the 7ft mark (aligned with the first row of recessed lights) where the horizontal plumbing run begins.', 9, 30
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_f8416f0135a4477985', 'Lower Level - Flooring, Windows, & Finishing', 'Path 4C: Lower Level Living door Premium 8''0" Multi-Panel Stackable Glass Wall Hardware', 12000, 14500, 17000,
        'TBD', 'Procurement of high-performance, Title 24-compliant 8ft tall stackable glass door system. Leverages native 4x12 header pocket; saves $5,500 over custom 9ft sizes.', 10, 31
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_6916fa7291bc424c9a', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Floor Slab Micro-Polishing', 12000, 13250, 14500,
        'Phase 1: Critical Path', 'Grind concrete substrate to premium low-gloss matte finish', 11, 32
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_17487fddbbb148039b', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Epoxy Vapor Sub-Slab Waterproof Sealant Barrier', 3500, 4250, 5000,
        'Phase 1: Critical Path', 'Mitigates subterranean water vapor transmission', 12, 33
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_b2c2b9c6f8f24ed997', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Level: Full Studs-Out Demolition & Debris Haul', 3200, 4800, 6500,
        'Phase 1: Critical Path', 'Complete tear down of existing lower level walls/ceilings to studs; includes local commercial Recology dump fees', 13, 34
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d3e9d16d668440e392', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Level: New 5/8" Drywall Full-Hang & Level 4 Finish Taping', 9100, 11400, 14000,
        'Phase 1: Critical Path', 'Hanging fresh 5/8" fire-rated or moisture boards across lower level; taped, floated, and sanded to a smooth Level 4 paint-ready finish', 14, 35
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_9757563c015048baab', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Level: New 5/8" Drywall Full-Hang & Level 5 Smooth Finish', 12500, 15800, 19200,
        'TBD', 'Hanging fresh 5/8" fire-rated or moisture boards across all lower spaces; multi-pass premium smooth wall mudding', 15, 36
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_8111548edb374720b8', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Level: Comprehensive R11/R19 Thermal & Sound Batt Insulation', 1800, 2450, 3100,
        'Phase 1: Critical Path', 'Full interlocking insulation replacement across exposed joist/stud cavities before closing walls', 16, 37
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_f7ace59b48294c87ac', 'Lower Level - Flooring, Windows, & Finishing', 'Downstairs Level Lighting: Recessed Decommissioning & Minimalist Surface Junction Box Box Prep', 800, 1200, 1500,
        'Phase 1: Critical Path', 'Cans will be removed as part of complete tear down', 17, 38
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_480ef0f94154461f81', 'Lower Level - Flooring, Windows, & Finishing', 'Lighting: Flush Mounted Minimalist Surface Fixtures (6-Head Array)', 1200, 2400, 3000,
        'Phase 1: Critical Path', '6 total: 2 lights in bathroom, 2 in bedroom, 2 above laundry', 18, 39
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_f0710b4557104833b6', 'Lower Level - Flooring, Windows, & Finishing', 'Lighting: Bespoke Modern Monopoint Adjustable Spotlights (10-Head Array)', 2000, 3000, 5250,
        'Phase 1: Critical Path', '8 total; 1 light in bathroom, 1 light against back living room wall, 2 lights in stair hallway, 2 lights above wet bar now, 2 lights above couch', 19, 40
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_afa5a5bd318b4607a2', 'Lower Level - Flooring, Windows, & Finishing', 'Lighting: Modern Wall Sconces & Indirect Fixtures (6-Head Array)', 2400, 3500, 4350,
        'Phase 1: Critical Path', '6 total; 2 in entry by frontdoor, 1 in bathroom, 2 in living room', 20, 41
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_b0a76d0a209d486cb3', 'Lower Level - Flooring, Windows, & Finishing', 'Lighting: Trimless Recessed Hidden Magnetic Track (5 Linear Feet)', 750, 1250, 1750,
        'Phase 1: Critical Path', '1 strip in living room ceiling', 21, 42
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_5a315c376bcc4cd6be', 'Kitchen', 'Kitchen Cabinets & Countertops Core Baseline', 40000, 55000, 55000,
        'Phase 1: Critical Path', 'Shared material resource allocation across options', 22, 45
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_92b5879eabdd4827af', 'Kitchen', 'Scenario C: Non-Structural Partition Removal', 2500, 4000, 5500,
        'Phase 1: Critical Path', 'Demolish wall to open up layout conceptual continuity', 23, 46
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_4a007222824e4a3899', 'Kitchen', 'Scenario C: Kitchen Window Alteration (Sill Raise)', 1800, 2500, 3200,
        'Phase 1: Critical Path', 'Reframe wall and alter exterior plate to clear sink counter', 24, 47
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d9e4711f7af64b6796', 'Kitchen', 'Scenario C: Pella Window Hardware', 2200, 2500, 2800,
        'Phase 1: Critical Path', 'Cost of pella window', 25, 48
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d1ec0868688b4670a3', 'Kitchen', 'Scenario C: Kitchen Sink Plumbing Move to Window', 3000, 3500, 4200,
        'Phase 1: Critical Path', 'Plumbing, Trenching & Electrical Core Runs', 26, 49
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_7e570e60896e406a9a', 'Upper Level - Flooring, Windows, & Finishing', 'Hardwood Flooring - Material (Min/Mid/Max grades)', 17091, 20241, 23391,
        'Phase 1: Critical Path', 'Material only allocation for 900 SF upstairs footprint', 27, 52
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_a0debff300c04ce292', 'Upper Level - Flooring, Windows, & Finishing', 'Hardwood - Stair Tread Installation & Detail Premium', 1500, 2000, 2500,
        'Phase 1: Critical Path', 'High labor premium for hand-cut finish carpentry on treads', 28, 53
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_1a6bc02e0260447c8b', 'Upper Level - Flooring, Windows, & Finishing', 'Flush Trimless Shadow-Gap Baseboard Track Install', 6000, 7250, 8500,
        'Phase 2: Deferrable', '', 29, 54
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_05b3068c30c14028bc', 'Upper Level - Flooring, Windows, & Finishing', 'Family Room Oversized Pella Impervia Box Bay Window', 9500, 10250, 11000,
        'Phase 2: Deferrable', 'Ideally goes along with Kitchen Option C so the front windows will match Can be handled at a future date option tracking parameter', 30, 55
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_52df201388474cb79c', 'Upper Level - Flooring, Windows, & Finishing', 'Lighting: Recessed Decommissioning & Minimalist Surface Junction Box Box Prep', 4500, 6000, 7500,
        'Phase 1: Critical Path', 'Capping old cluttered cans; prep layout for strategic surface/pendant locations', 31, 56
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_5eca80810009498882', 'Upper Level - Flooring, Windows, & Finishing', 'Lighting: Flush Mounted Minimalist Surface Fixtures (6-Head Array)', 2400, 4800, 7200,
        'Phase 1: Critical Path', '3 total; 2 in primary bathroom, 1 in hall bathroom', 32, 57
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d81c44d3a22c4a4c86', 'Upper Level - Flooring, Windows, & Finishing', 'Lighting: Bespoke Modern Monopoint Adjustable Spotlights (10-Head Array)', 3000, 5250, 7500,
        'Phase 1: Critical Path', '12 total; 2 in living room, 2 above kitchen sink, 2 above island, 2 on stairs, 4 in primary closet', 33, 58
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_99d728f06da9412da1', 'Upper Level - Flooring, Windows, & Finishing', 'Lighting: Modern Wall Sconces & Indirect Fixtures (6-Head Array)', 2400, 4350, 6300,
        'Phase 2: Deferrable', 'High-end vertical indirect lighting; requires cutting drywall and routing new in-wall electrical lines', 34, 59
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_c8e132bbf4bb496a86', 'Upper Level - Flooring, Windows, & Finishing', 'Lighting: Trimless Recessed Hidden Magnetic Track (5 Linear Feet)', 5250, 8750, 12250,
        'Phase 1: Critical Path', '7 total; 1 track in living room, 1 in kitchen, 2 in hallway, 1 for each bedroom', 35, 60
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_696025d88c15415c8a', 'Guest Bathrooms', 'Lower Bath: Shower Retile & Pan Install', 4000, 5250, 6500,
        'Phase 1: Critical Path', 'Retaining existing structural glass enclosure system', 36, 64
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_a6dbf8e1e300464bb2', 'Guest Bathrooms', 'Lower Bath: Single Vanity & Sink Hardware Setup', 600, 900, 1200,
        'Phase 1: Critical Path', 'Hardware selection and localized trade installation labor', 37, 65
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d0d221653a6c4ca7af', 'Guest Bathrooms', 'Lower Bath: New Toilet Hardware Component', 450, 625, 800,
        'Phase 1: Critical Path', 'Premium porcelain hardware components only allocation', 38, 66
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_54889a8ee674455e92', 'Guest Bathrooms', 'Lower Bath: Copper Plumbing Verification & Preventative Fixes', 600, 800, 1000,
        'Phase 1: Critical Path', 'Leak prevention evaluation and line check on lower slab', 39, 67
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_4db2515231c845ce94', 'Guest Bathrooms', 'Upstairs Hall Bath: Shower Retile & Pan Install', 4000, 5250, 6500,
        'Phase 1: Critical Path', 'Retaining existing structural glass enclosure system', 40, 68
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_b9e75a95f2c5423ea0', 'Guest Bathrooms', 'Upstairs Hall Bath: Single Vanity & Sink Hardware Setup', 600, 900, 1200,
        'Phase 1: Critical Path', 'Hardware selection and localized trade installation labor', 41, 69
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_2369f63f217c4b4b84', 'Guest Bathrooms', 'Upstairs Hall Bath: New Toilet Hardware Component', 450, 625, 800,
        'Phase 1: Critical Path', 'Premium porcelain hardware components only allocation', 42, 70
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_0ff36927e54a4497a5', 'Guest Bathrooms', 'Upstairs Hall Bath: Copper Plumbing Verification & Preventative Fixes', 600, 800, 1000,
        'Phase 1: Critical Path', 'Leak prevention evaluation and line integrity check', 43, 71
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_795d7717953e4389b4', 'Primary Bathroom', 'Primary Bath Core: Toilet Realignment & New Porcelain Hardware', 1300, 1675, 2000,
        'Phase 1: Critical Path', 'Reverses old flipper modification to fix offset flange seal failure. Shifting the closet flange 3-5 inches back to native center layout. Includes cutting old ABS/cast iron collar, short-elbow offsets, and subfloor collar patch.', 44, 74
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_436635f808db4028aa', 'Primary Bathroom', 'Primary Bath: Shower - DEFAULT - In-Kind Footprint Refinish', 8000, 10000, 12000,
        'TBD', 'Tucked to the side; new tile and pan build baseline', 45, 75
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_6cfa8592e6a34f5cb5', 'Primary Bathroom', 'Primary Bath Core: Double Vanity & Integrated Sinks', 1800, 2400, 3000,
        'Phase 1: Critical Path', 'High-end double vanity cabinetry setup with integrated stone/quartz remnant countertop surfaces and dual sinks.', 46, 76
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_57eaffecb27148049c', 'Primary Bathroom', 'Primary Bath: Laundry Relocation (Electrical & Venting)', 3000, 3750, 4500,
        'Phase 1: Critical Path', 'Route 240V lines ~30ft into suite closet; tie to wall vent already in wall behind toilet', 47, 77
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_31f3e10c11ad46dc8c', 'A', 1, 'center', 'curbless_drop_box', 'dual_rainhead',
        0, NULL, 'Scenario A1: Curbless Drop-Box + Dual Rainheads + Handheld', 16800, 20850, 24900,
        'TBD', 'Includes dropped-joist framing via downstairs access ($1.45k), linear drain/tanking ($1.6k), high-flow thermostatic valves, and dual overhead ceiling rough-ins ($17.8k).', 48, 82
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_8b1bd0d0194a41d68c', 'A', 2, 'center', 'curbless_drop_box', 'single_rainhead',
        0, NULL, 'Scenario A2: Curbless Drop-Box + Single Rainhead + Handheld', 14100, 17750, 21400,
        'TBD', 'Keeps premium flush curbless drop framing ($1.45k) and linear drain/tanking ($1.6k). Cost-engineered to standard pressure-balanced mixing valve with 2-way diverter ($14.7k).', 49, 83
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_40d13d8dd2084064af', NULL, NULL, 'center', 'no_pan_mud_bed', NULL,
        0, NULL, 'Primary Bath - Shower - Scenario B: No Pan, Slight Slope / Mud Bed Packages', NULL, NULL, NULL,
        'TBD', '', 50, 85
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_20400452cb32427c8f', 'B', 1, 'center', 'no_pan_mud_bed', 'dual_rainhead',
        0, NULL, 'Scenario B1: No-Pan Sloped Mud Bed + Dual Rainheads + Handheld', 16500, 20500, 24500,
        'TBD', 'Avoids joist structural modifications but requires a labor-intensive hand-packed sloped mortar bed ($1.1k), full-room waterproofing ($1.6k), and the premium high-flow dual valve array ($17.8k).', 51, 86
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_270c48e72b074d4d98', 'B', 2, 'center', 'no_pan_mud_bed', 'single_rainhead',
        0, NULL, 'Scenario B2: No-Pan Sloped Mud Bed + Single Rainhead + Handheld', 13800, 17400, 21000,
        'TBD', 'Standard flat framing with sloped mortar bed ($1.1k) and full tanking waterproofing ($1.6k). Cost-engineered to standard single-head pressure-balanced plumbing valves ($14.7k).', 52, 87
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_a5258105616e4b17aa', NULL, NULL, 'center', 'step_up_curb', NULL,
        0, NULL, 'Primary Bath - Shower - Scenario C: Standard Step Up Curb Packages', NULL, NULL, NULL,
        'TBD', '', 53, 89
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_033351b216794118b1', 'C', 1, 'center', 'step_up_curb', 'dual_rainhead',
        0, NULL, 'Scenario C1: Standard Step-Up Curb Pan + Dual Rainheads + Handheld', 15000, 18400, 21800,
        'TBD', 'Bypasses all subfloor structural and sloped tile deck labor ($600 basic pan install). Stacks the entire design premium exclusively onto the luxury high-flow dual rainhead valve system ($17.8k).', 54, 90
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_81a7fb5ccb1a462c8c', 'C', 2, 'center', 'step_up_curb', 'single_rainhead',
        0, NULL, 'Scenario C2: Standard Step-Up Curb Pan + Single Rainhead + Handheld', 12300, 15300, 18300,
        'TBD', 'The ultimate cash-preservation baseline. Uses standard flat subfloor framing, an off-the-shelf step-up shower pan ($600), and a standard single-valve single rainhead/handheld layout ($14.7k).', 55, 91
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_4386e5db1dda44f0af', 'D', 1, 'side', 'curbless_drop_box', 'dual_rainhead',
        0, NULL, 'Scenario D1: Side Wall Curbless Drop-Box + Dual Rainheads + Handheld', 15600, 19350, 23100,
        'TBD', 'Includes dropped-joist framing via open downstairs access ($1.45k), linear drain/tanking ($1.6k), high-flow thermostatic valves, and dual side-wall/ceiling rough-ins ($16.3k).', 56, 96
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_635193a771954e2ba8', 'D', 2, 'side', 'curbless_drop_box', 'single_rainhead',
        0, NULL, 'Scenario D2: Side Wall Curbless Drop-Box + Single Rainhead + Handheld', 12900, 16250, 19600,
        'TBD', 'Keeps premium flush curbless drop framing ($1.45k) and linear drain/tanking ($1.6k). Cost-engineered to standard side-wall pressure-balanced mixing valve ($13.2k).', 57, 97
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_bd751def8cc545868e', NULL, NULL, 'side', 'no_pan_mud_bed', NULL,
        0, NULL, 'Primary Bath - Shower - Scenario E: No Pan, Slight Slope / Mud Bed Packages', NULL, NULL, NULL,
        'TBD', '', 58, 99
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_8d5aee1a0b004933a7', 'E', 1, 'side', 'no_pan_mud_bed', 'dual_rainhead',
        0, NULL, 'Scenario E1: Side Wall No-Pan Sloped Mud Bed + Dual Rainheads + Handheld', 15300, 19000, 22700,
        'TBD', 'Traditional flat framing with a hand-packed sloped mortar bed ($1.1k), full-room tanking waterproofing ($1.6k), and the premium high-flow dual side-wall valve array ($16.3k).', 59, 100
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_446a10c81e1449159f', 'E', 2, 'side', 'no_pan_mud_bed', 'single_rainhead',
        0, NULL, 'Scenario E2: Side Wall No-Pan Sloped Mud Bed + Single Rainhead + Handheld', 12600, 15900, 19200,
        'TBD', 'Flat framing with sloped mortar bed ($1.1k) and full tanking waterproofing ($1.6k). Cost-engineered to standard single-head pressure-balanced side-wall plumbing valves ($13.2k).', 60, 101
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_00b8f487b4ca41e48e', NULL, NULL, 'side', 'step_up_curb', NULL,
        0, NULL, 'Primary Bath - Shower - Scenario F: Standard Step Up Curb Packages', NULL, NULL, NULL,
        'TBD', '', 61, 103
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_3b50d9f2949f4936a6', 'F', 1, 'side', 'step_up_curb', 'dual_rainhead',
        0, NULL, 'Scenario F1: Side Wall Step-Up Curb Pan + Dual Rainheads + Handheld', 13800, 16900, 20000,
        'TBD', 'Bypasses all subfloor modifications ($600 side pan install). Concentrates the entire design premium exclusively on the luxury high-flow dual rainhead valve system ($16.3k).', 62, 104
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_ff030aea01174d7380', 'F', 2, 'side', 'step_up_curb', 'single_rainhead',
        0, NULL, 'Scenario F2: Side Wall Step-Up Curb Pan + Single Rainhead + Handheld', 11100, 13800, 16500,
        'Phase 1: Critical Path', 'The absolute minimum spend path. Uses standard flat framing, an off-the-shelf side-wall step-up pan ($600), and a standard single-valve single rainhead/handheld layout ($13.2k).', 63, 105
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_fdec165ad2bb4bbfa7', NULL, NULL, 'center', NULL, NULL,
        1, 'steam', 'Add-On - Steam Shower: Steam Generator Hardware & Control Kit', 2800, 3600, 4400,
        'TBD', 'Procurement of high-end 6kW-9kW steam generator unit, electronic control pad, aromatherapy steam head, and auto-flush drain valve assembly.', 64, 108
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_d44ce52b4b304f2da5', NULL, NULL, 'center', NULL, NULL,
        1, 'steam', 'Add-On - Steam Shower: Dedicated 240V Electrical & Mechanical Rough-In', 1500, 1950, 2400,
        'TBD', 'Running dedicated 240V line from panel to generator location; copper water feed plumbing and insulated steam distribution line installation.', 65, 109
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_c03184c8d7504fc2b1', NULL, NULL, 'center', NULL, NULL,
        1, 'steam', 'Add-On - Steam Shower: Sloped Ceiling Framing & Vapor-Barrier Tanking', 1800, 2300, 2800,
        'TBD', 'Framing a slight slope into the shower ceiling plane. Upgrading to a Class I Vapor Retarder membrane on 100% of walls/ceiling to prevent framing rot.', 66, 110
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_4993b773770947839d', NULL, NULL, 'center', NULL, NULL,
        1, 'steam', 'Add-On - Steam Shower: Floor-to-Ceiling Air-Tight Glass Enclosure', 3200, 4100, 5000,
        'TBD', 'Upgraded heavy-duty tempered glass enclosure extending dead-flush to ceiling with airtight seals and a movable top ventilation transom panel.', 67, 111
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_56fd2e64b0dd4743a5', NULL, NULL, 'center', NULL, NULL,
        1, 'smart', 'Add-On - Smart Shower: 2-Outlet Digital Smart Shower Upgrade Kit', 950, 1400, 1850,
        'TBD', 'Upgrades manual handles to digital touch control. Bakes in the electronic thermostatic valve box, digital wall control pad, data cable, and low-voltage electrical run.', 68, 114
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_e1635c2b2fb64a62bb', NULL, NULL, 'center', NULL, NULL,
        1, 'smart', 'Add-On - Smart Shower: 3-Outlet Digital Smart Shower Upgrade Kit', 1800, 2450, 3100,
        'TBD', 'Upgrades manual dual-rainhead systems to full digital integration. Electronic 3-port valve box permits precise multi-user programmable temperature presets.', 69, 115
      );
INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'amv_ef90f9cd75934fe5bb', NULL, NULL, 'center', NULL, NULL,
        1, 'smart', 'Add-On - Smart Shower: Smart Shower 120V GFCI & Data Cable Rough-In [Required in any smart shower add on configuration]', 450, 650, 850,
        'TBD', 'Wiring a dedicated 120V GFCI outlet in an accessible vanity or closet pocket; routing low-voltage data conduit from the shower control pad location to the valve box.', 70, 116
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_9eeec694b20849519e', 'Mechanical Trade Core Breakdowns (Client Supplied Hardware)', 'MrCool DIY 5th Gen 3-Zone Hardware Bundle', 4900, 5200, 5500,
        'Phase 1: Critical Path', 'Includes 36K BTU condenser + 12K + 9K + 9K air heads', 71, 119
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_1cbfd61064bf432d87', 'Mechanical Trade Core Breakdowns (Client Supplied Hardware)', 'HVAC Mechanical Installation Labor Allocation', 3500, 5250, 7000,
        'Phase 1: Critical Path', 'Subject to 20% framing credit coefficient deduction', 72, 120
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_ee28377941b84acdac', 'Mechanical Trade Core Breakdowns (Client Supplied Hardware)', 'Dedicated 240V High-Voltage Condenser Whip Run', 800, 1300, 1800,
        'Phase 1: Critical Path', 'Electrical sub circuit disconnect infrastructure', 73, 121
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_c356ddb669e544459d', 'Mechanical Trade Core Breakdowns (Client Supplied Hardware)', 'Condensate Drainage Gravity Variance Block (Lift Pumps)', 400, 800, 1200,
        'Phase 2: Deferrable', 'Triggered if wall framers fail downward gravity slopes', 74, 122
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_3e59877230904a16bc', 'Mechanical Trade Core Breakdowns (Client Supplied Hardware)', 'Underground 200A Main Service Upgrade (PG&E Allocation)', 12500, 18000, 35000,
        'Phase 1: Critical Path', 'Conditional critical-path risk. Essential if 125A fails calc', 75, 123
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_78d9700d8429447098', 'Site Geographic Zonal Phasing Assets', 'Justin''s Back Office Performance Casement Window Array', 4800, 5150, 5500,
        'Phase 2: Deferrable', 'Can be handled at a future date option tracking parameter', 76, 126
      );
INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        'ali_d644c3323eef448c90', 'Site Geographic Zonal Phasing Assets', 'a', NULL, NULL, NULL,
        'TBD', '', 77, 155
      );
