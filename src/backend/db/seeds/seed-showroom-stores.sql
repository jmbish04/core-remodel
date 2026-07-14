-- Seed Showroom Stores
-- References store_bayarea_cities by sub-select on city name
-- website_url/instagram_url/facebook_url/pinterest_url moved to
-- showroom_store_links (one row per link, type = 'WEBSITE' | 'INSTAGRAM' | ...);
-- seeded below via name-based sub-selects after each store insert.
-- Hub C: Peninsula / San Carlos
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Whole Wood', 'San Carlos whole-wood flooring hub. Massive selection of engineered and solid hardwoods.', '$$$', 'San Carlos, CA', 1, 'Massive warehouse with wide range of variations', 'Engineered hardwood, solid hardwood, European imports, reclaimed wood', 'Homeowners doing full-floor renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Carlos')),
('Argonaut Window & Door', 'Premium window and door showroom. Authorized Marvin and Andersen dealer.', '$$$$', 'San Carlos, CA', 1, 'Medium showroom with comprehensive window/door vignettes', 'Marvin, Andersen, and specialty window systems', 'Architects, general contractors', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Carlos')),
('Pacific Sash & Design', 'Specialty wood and aluminum-clad windows. Custom sizing and historic restoration.', '$$$$', 'San Carlos, CA', 1, 'Curated showroom with custom order focus', 'Custom-sized windows, historic sash replacement', 'Historic home renovators, Victorian restoration projects', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Carlos')),
('Wedlock Windows', 'Value-oriented window replacement. Vinyl and fiberglass frames.', '$$', 'San Carlos, CA', 1, 'Lean operation focused on volume replacements', 'Vinyl replacement windows, fiberglass frames', 'Budget-conscious homeowners', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Carlos')),
('California Closets', 'National custom closet franchise. San Carlos showroom with full walk-in vignettes.', '$$$', 'San Carlos, CA', 0, 'Medium showroom with multiple walk-in displays', 'Custom closet systems, home office, garage storage', 'Homeowners seeking turnkey closet solutions', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Carlos'));

INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.wholewood.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Whole Wood';

-- Hub C: Belmont
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Studio Belmont (Flagship)', 'Massive dual-wing facility. Largest comprehensive display of all brands.', '$$$$', 'Belmont, CA', 1, 'Massive, dual-wing facility', 'Largest display of brands, valves, and technical systems', 'Architects, interior designers, GCs', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Belmont'));

-- Hub A: SF Design District
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Studio Belmont (SF)', 'SF Design District location. Focuses on statement pieces and European luxury.', '$$$$', 'San Francisco, CA', 0, 'Highly curated boutique', 'Statement pieces, European luxury (THG Paris)', 'Urban architects, Pacific Heights renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Lutz Bath & Kitchen', 'Ultra-luxury bath and steam showroom.', '$$$$', 'San Francisco, CA', 1, 'Curated boutique focused on thermal experiences', 'Steam generators, shower systems, luxury bath fixtures', 'Ultra-luxury homeowners, spa-inspired bath renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Townsend Showroom', 'High-end bath and vanity showroom in SF.', '$$$$', 'San Francisco, CA', 1, 'Medium boutique with curated vignettes', 'Luxury vanities, vessel sinks, decorative hardware', 'Interior designers, high-end bath renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Porcelanosa', 'Spanish tile and porcelain slab manufacturer with SF showroom.', '$$$$', 'San Francisco, CA', 0, 'Large showroom with full slab gallery', 'Large-format porcelain slabs, ceramic tile', 'Architects specifying porcelain slabs', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Nido Living (Rimadesio)', 'Authorized Rimadesio dealer. Ultra-luxury Italian closet systems.', '$$$$', 'San Francisco, CA', 1, 'Curated boutique with full-room Rimadesio installations', 'Rimadesio sliding doors, walk-in closets, glass partitions', 'Ultra-luxury penthouse and loft conversions', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Insensation Inc.', 'Frameless door systems — flush-mount interior doors.', '$$$$', 'San Francisco, CA', 1, 'Small showroom with full-scale door installations', 'Frameless interior doors, pocket door systems', 'Modern/minimalist renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Italdoors (SF)', 'Italian frameless door systems. SF showroom.', '$$$', 'San Francisco, CA', 1, 'Boutique showroom with operational door samples', 'Italian frameless doors, concealed frame systems', 'Modern renovations, contractors', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Craftex Microcement', 'Microcement and microconcrete coatings.', '$$$', 'San Francisco, CA', 1, 'Studio with sample panels and application demos', 'Microcement coatings, microconcrete, polished plaster', 'Modern/industrial renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Archetype Lighting', 'Architectural lighting studio.', '$$$$', 'San Francisco, CA', 1, 'Studio-format showroom with lighting installations', 'Architectural recessed lighting, linear LED systems', 'Architects, lighting designers', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Tile Tech Pavers', 'Porcelain and concrete pavers for exterior decking.', '$$$', 'San Francisco, CA', 0, 'Showroom with outdoor application samples', 'Porcelain pavers, pedestal systems', 'Landscape architects, rooftop deck projects', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Topcret (SF)', 'Spanish microcement manufacturer. SF showroom.', '$$$', 'San Francisco, CA', 1, 'Showroom with application demos and samples', 'Topcret microcement systems', 'SF architects seeking European seamless surfaces', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Poliform', 'Italian luxury wardrobe and closet systems.', '$$$$', 'San Francisco, CA', 0, 'Dealer showroom — full-room installations', 'Bespoke Italian walk-in systems, leather drawers', 'Ultra-luxury primary suite renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Lema', 'Italian high-end wardrobe manufacturer.', '$$$$', 'San Francisco, CA', 0, 'Dealer showroom with European walk-in displays', 'Italian modular closet systems, integrated LED lighting', 'Ultra-luxury renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('Avera by The Container Store', 'Premium turnkey closet systems by TCS.', '$$$', 'San Francisco, CA', 0, 'In-store boutique within Container Store', 'Floor-to-ceiling closet systems, shoe storage', 'Premium homeowners wanting turnkey solutions', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco')),
('The Container Store', 'National organizer retailer. Elfa and basic closet systems.', '$$', 'San Francisco, CA', 0, 'Retail store with closet section', 'Elfa systems, basic to mid-range closet organizers', 'Budget to mid-range homeowners', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Francisco'));

INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.lutzbathandkitchen.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Lutz Bath & Kitchen';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.porcelanosa.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Porcelanosa';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.nidoliving.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Nido Living (Rimadesio)';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.insensation.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Insensation Inc.';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.italdoors.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Italdoors (SF)';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.topcret.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Topcret (SF)';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.poliform.it', 'WEBSITE' FROM showroom_stores WHERE name = 'Poliform';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.lemamobili.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Lema';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.containerstore.com/avera', 'WEBSITE' FROM showroom_stores WHERE name = 'Avera by The Container Store';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.containerstore.com', 'WEBSITE' FROM showroom_stores WHERE name = 'The Container Store';

-- Hub C: San Bruno
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Italdoors (San Bruno)', 'Italian frameless door systems. San Bruno warehouse.', '$$$', 'San Bruno, CA', 0, 'Warehouse + showroom combined', 'Italian frameless doors, pivot doors', 'Contractors purchasing in volume', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Bruno'));

-- Hub B: Silicon Valley
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Studio Belmont (San Jose)', 'South Bay location. Strong appliance and kitchen display.', '$$$$', 'San Jose, CA', 0, 'Medium showroom with kitchen/bath vignettes', 'Kitchen fixtures, appliances, South Bay product lines', 'Tech executives, Silicon Valley firms', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Jose')),
('Tredi Interiors', 'Authorized InvisaCook dealer. Exclusive Arrital Italian Kitchens importer.', '$$$$', 'Santa Clara, CA', 1, 'Medium showroom with working InvisaCook installations', 'InvisaCook invisible induction, Arrital Italian kitchens', 'Tech executives, modern kitchen renovations', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Santa Clara')),
('Topcret (San Jose)', 'Spanish microcement manufacturer. San Jose center.', '$$$', 'San Jose, CA', 0, 'Application center with sample panels', 'Topcret microcement systems', 'Contractors seeking seamless surfaces', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'San Jose'));

INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.trediinteriors.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Tredi Interiors';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.topcret.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Topcret (San Jose)';

-- Hub D: East Bay
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Studio Belmont (Walnut Creek)', 'East Bay location. Contra Costa corridor.', '$$$', 'Walnut Creek, CA', 0, 'Medium showroom focused on plumbing and bath', 'Plumbing fixtures, bath accessories', 'East Bay homeowners', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Walnut Creek')),
('Concreteworks', 'Precast concrete fabricator. Custom sinks, countertops, and architectural elements.', '$$$$', 'Alameda, CA', 1, 'Factory + showroom combined', 'Precast concrete sinks, countertops, fireplace surrounds', 'Architects, interior designers', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Alameda')),
('America''s Dream HomeWorks', 'PITT Cooking and modern kitchen showroom in Emeryville.', '$$$', 'Emeryville, CA', 1, 'Medium showroom with working PITT Cooking installations', 'PITT Cooking gas/induction burners', 'Home cooks, kitchen renovators', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Emeryville')),
('Duraamen', 'Microcement and epoxy flooring manufacturer. Hayward distribution.', '$$$', 'Hayward, CA', 0, 'Distribution center with sample area', 'Microcement, epoxy flooring, self-leveling overlays', 'Flooring contractors', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Hayward')),
('IKEA PAX', 'Modular PAX wardrobe system. Standard 29" and 19" frames.', '$', 'Emeryville, CA', 0, 'Full retail store with extensive PAX display area', 'PAX wardrobe frames, KOMPLEMENT interiors, modular organization', 'Budget DIY renovators', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Emeryville'));

INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.concreteworks.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Concreteworks';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.duraamen.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Duraamen';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.ikea.com', 'WEBSITE' FROM showroom_stores WHERE name = 'IKEA PAX';

-- Hub E: North Bay
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic, bay_area_city_id)
VALUES
('Studio Belmont (Novato)', 'North Bay location. Serves Marin County.', '$$$', 'Novato, CA', 0, 'Smaller satellite showroom', 'Plumbing fixtures and hardware for North Bay', 'Marin County homeowners', (SELECT id FROM store_bayarea_cities WHERE bay_area_city_name = 'Novato'));

-- Bay-wide (no specific city)
INSERT OR IGNORE INTO showroom_stores (name, description, price_point, location_address, is_flagship_location, scale, inventory_focus, target_demographic)
VALUES
('Petty Masonry Inc.', 'Pedestal deck systems and exterior hardscape. Full Bay Area.', '$$$', 'Bay Area, CA', 0, 'Field operations — consultation-based', 'Pedestal deck systems, exterior pavers', 'GCs, landscape architects'),
('Archatrak', 'Pedestal paver and deck systems. Bay Area distribution.', '$$$', 'Bay Area, CA', 0, 'Distribution/online — consultation-based', 'Adjustable pedestal systems, porcelain pavers', 'Architects, deck contractors'),
('Closet Factory', 'Custom closet manufacturer with Costco member benefits. 10% Shop Card rebate.', '$$$', 'Bay Area, CA', 0, 'Manufacturing + consultation-based', 'Custom closet systems, home office, garage, Murphy beds', 'Costco members, mid-range custom seekers');

INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.archatrak.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Archatrak';
INSERT OR IGNORE INTO showroom_store_links (store_id, url, type)
SELECT id, 'https://www.closetfactory.com', 'WEBSITE' FROM showroom_stores WHERE name = 'Closet Factory';
