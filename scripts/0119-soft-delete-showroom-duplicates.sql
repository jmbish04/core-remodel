-- 0119 — Soft-delete duplicate showroom_stores rows left by the non-idempotent seed.
--
-- The seed (seedShowroomStores) ran three times before PR #221 made it
-- bootstrap-only, cloning the store list twice. showroom_stores ended up with
-- 219 rows where ~160 are unique. This hides the duplicates with is_active = 0
-- rather than deleting them:
--   * every showroom read path filters is_active = 1 (audited in PR #154), so
--     the duplicates vanish from the directory, map, catalog, drives, MCP, etc;
--   * NO child rows are touched and NOTHING is hard-deleted — fully reversible
--     (set is_active = 1 to restore). The winners keep all their own data.
--
-- Keep policy: keep the enriched/canonical row per store (real street address,
-- zip, placeId, coords, icon); hide the city-only re-seed shells. The id list is
-- the authoritative dedup dry-run (MCP dedup_showroom_stores) PLUS five
-- cross-city corrections: five stores (27 Concreteworks, 28 America's Dream
-- HomeWorks, 32 Petty Masonry, 33 Archatrak, 19 Lema) were enriched to a
-- different city than their shells, so the shells grouped separately; we keep the
-- enriched originals (27/28/32/33/19) and hide their shells too.
--
-- Run:
--   npx wrangler d1 execute core-remodel --remote \
--     --file=scripts/0119-soft-delete-showroom-duplicates.sql
--
-- Preview first (writes nothing) — see exactly which rows will be hidden:
--   npx wrangler d1 execute core-remodel --remote --command \
--     "SELECT id, name, location_city, zip_code FROM showroom_stores
--      WHERE id IN (34,154,155,156,157,158,159,160,161,162,163,164,165,169,171,172,174,175,176,177,178,180,181,182,183,184,188,189,190,191,192,193,194,195,196,197,198,199,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221) ORDER BY name, id;"
--
-- Rollback (restore everything this hid):
--   UPDATE showroom_stores SET is_active = 1 WHERE id IN ( ...same ids... );

UPDATE showroom_stores
SET is_active = 0,
    updated_at = unixepoch()
WHERE id IN (
  -- Whole Wood (keep 1)
  154, 188,
  -- Argonaut Window & Door (keep 2)
  155, 189,
  -- Pacific Sash & Design (keep 3)
  156, 190,
  -- Wedlock Windows (keep 4)
  157, 191,
  -- California Closets (keep 5)
  158, 192,
  -- Studio Belmont (Flagship) (keep 6)
  159, 193,
  -- Studio Belmont (SF) (keep 7)
  160, 194,
  -- Lutz Bath & Kitchen (keep 8)
  161, 195,
  -- Townsend Showroom (keep 9)
  162, 196,
  -- Porcelanosa (keep 10)
  163, 197,
  -- Nido Living (Rimadesio) (keep 11)
  164, 198,
  -- Insensation Inc. (keep 12)
  165, 199,
  -- Archetype Lighting (keep 15)
  169, 203,
  -- Poliform (keep 18)
  182, 216,
  -- Lema (keep 19; 19 has a mis-enriched address — see flag below)
  183, 217,
  -- Avera by The Container Store (keep 20)
  184, 218,
  -- Studio Belmont (San Jose) (keep 23)
  171, 205,
  -- Tredi Interiors (keep 24)
  172, 206,
  -- Studio Belmont (Walnut Creek) (keep 26)
  174, 208,
  -- Concreteworks (keep 27)
  175, 209,
  -- America's Dream HomeWorks (keep 28)
  176, 210,
  -- Duraamen (keep 29)
  177, 211,
  -- Studio Belmont (Novato) (keep 31)
  178, 212,
  -- Petty Masonry Inc. (keep 32)
  180, 214,
  -- Archatrak (keep 33)
  181, 215,
  -- Closet Factory (keep 187 — has website; 34 & 221 are barer)
  34, 221,
  -- Italdoors (San Bruno) (keep 167)
  201,
  -- Craftex Microcement (keep 168)
  202,
  -- Tile Tech Pavers (keep 170)
  204,
  -- Topcret (San Jose) (keep 173)
  207,
  -- Topcret (SF) (keep 179)
  213,
  -- The Container Store (keep 185)
  219,
  -- IKEA PAX (keep 186)
  220
);

-- Verify: how many stores remain active (expect ~160), and confirm no
-- (name, active) duplicates remain among city-only rows.
SELECT COUNT(*) AS active_stores FROM showroom_stores WHERE is_active = 1;
SELECT name, COUNT(*) AS n
FROM showroom_stores
WHERE is_active = 1
GROUP BY lower(trim(name))
HAVING n > 1
ORDER BY n DESC, name;
