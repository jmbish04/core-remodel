// 126 Colby Street — real data from uploaded floor plans + listing photos.
// Plus mini-floorplan SVG renderer used by the room detail overlay.

const PROJECT = {
  address: "126 Colby Street",
  city: "San Francisco, CA",
  scenarioName: "Kitchen Downstairs, Family Up",
  scenarioDescription:
    "Whole-home remodel of a two-level 1920s home. Open up the upper level around the kitchen + dining, refit the primary bath, convert the upstairs hall bath to stacked laundry. Lower level lightly refreshed: family room repaint, garage to remain.",
  publishedAt: "May 14, 2026",
  expiresOn: "Jun 12, 2026",
};

const OWNER = {
  name: "Marcus Asado",
  shortName: "Marcus",
  email: "marcus@asado.family",
  initial: "MA",
  greeting:
    "Thanks for taking the time to bid on our remodel. Everything you need to scope is below — floor plans, listing photos, supporting docs, and our material picks where we've decided. The Monolith lets you enter your bid here so we can compare line items consistently. We'll see your numbers as a draft until you hit send.",
};

const COLLABORATORS = [
  { role: "Architect", name: "Lena Park, AIA", firm: "Park & Associates", email: "lena@parkarch.studio", phone: "415-555-0142" },
  { role: "Structural eng.", name: "Tom Yee, PE", firm: "Yee Structural", email: "tom@yeestructural.com", phone: "415-555-0188" },
  { role: "Interior design", name: "Saoirse Quinn", firm: "Quinn Studio", email: "saoirse@quinn.studio", phone: null },
  { role: "Permit expediter", name: "Ron Velasco", firm: "SF Permit Group", email: "ron@sfpermitgroup.com", phone: "415-555-0211" },
];

// Listing photos pre-remodel
const LISTING_PHOTOS = [
  { id: "p1", src: "uploads/126-colby-street.58685.p2k.004.web.jpg", caption: "Front entry — patterned tile threshold", roomKeys: ["entryway"] },
  { id: "p2", src: "uploads/126-colby-street.58685.p2k.006.web.jpg", caption: "Lower foyer + stair to upper level", roomKeys: ["family_room", "entryway"] },
  { id: "p3", src: "uploads/126-colby-street.58685.p2k.017.web.jpg", caption: "Upper living + dining (current)", roomKeys: ["living", "dining"] },
  { id: "p4", src: "uploads/126-colby-street.58685.p2k.019.web.jpg", caption: "Existing kitchen — to be replaced", roomKeys: ["kitchen"] },
  { id: "p5", src: "uploads/126-colby-street.58685.p2k.030.web.jpg", caption: "Primary bedroom", roomKeys: ["primary_bedroom"] },
  { id: "p6", src: "uploads/126-colby-street.58685.p2k.033.web.jpg", caption: "Primary bath", roomKeys: ["primary_bath"] },
  { id: "p7", src: "uploads/126-colby-street.58685.p2k.042.web.jpg", caption: "Upper bedroom — staged as office", roomKeys: ["bedroom_3"] },
  { id: "p8", src: "uploads/126-colby-street.58685.p2k.045.web.jpg", caption: "Lower family room", roomKeys: ["family_room"] },
];

const FLOORPLAN_IMAGES = {
  upper: "uploads/upper_level_floorplan.jpg",
  lower: "uploads/lower_level_floor_plan.jpg",
};

// Inspirational photos uploaded by owner — for now reuse a couple listing shots as
// stand-ins (could be replaced when owner uploads). Stays inside scope.
const INSPIRATION = {
  kitchen: [
    { id: "i1", caption: "Wood + black quartz — direction we're after", src: "uploads/126-colby-street.58685.p2k.019.web.jpg" },
  ],
  primary_bath: [
    { id: "i2", caption: "Skylight + freestanding tub", src: "uploads/126-colby-street.58685.p2k.033.web.jpg" },
  ],
  living: [
    { id: "i3", caption: "Open dining ↔ living, light wood floor", src: "uploads/126-colby-street.58685.p2k.045.web.jpg" },
  ],
};

const DOCS = [
  { id: "d1", name: "Approved plan set — Park & Associates, 04/22", size: "8.4 MB", type: "pdf", roomKeys: ["kitchen", "dining", "living", "primary_bath", "hall_bath"] },
  { id: "d2", name: "Structural calcs — kitchen wall removal", size: "1.2 MB", type: "pdf", roomKeys: ["kitchen", "dining"] },
  { id: "d3", name: "Title 24 energy compliance", size: "640 KB", type: "pdf", roomKeys: [] },
  { id: "d4", name: "HOA approval letter", size: "180 KB", type: "pdf", roomKeys: [] },
  { id: "d5", name: "Existing as-built measurements (PDF)", size: "2.1 MB", type: "pdf", roomKeys: [] },
];

// ---------- Rooms — keyed and tied to floorplan geometry ----------
// Coordinates are percent of viewBox 100×140 (portrait) for each level.

const ROOMS = [
  // UPPER LEVEL — matches uploads/upper_level_floorplan.jpg
  { key: "bedroom_2",       name: "Bedroom 2",          floor: "upper", dims: "11'11\" × 13'7\"",  sf: 162, scope: "refresh", listingPhotoId: null,
    intent: "Refresh paint + new closet system. Existing flooring stays.",
    geom: { x: 4, y: 4, w: 44, h: 26 }, marker: { topPct: 12, leftPct: 24 } },
  { key: "primary_bedroom", name: "Primary bedroom",    floor: "upper", dims: "11'11\" × 13'7\"",  sf: 162, scope: "refresh", listingPhotoId: "p5",
    intent: "Cosmetic only — paint, re-finish wood floor, new ceiling light.",
    geom: { x: 50, y: 4, w: 46, h: 26 }, marker: { topPct: 12, leftPct: 68 } },
  { key: "hall_bath",       name: "Hall bath",          floor: "upper", dims: "8'4\" × 4'11\"",   sf: 41,  scope: "convert", listingPhotoId: null,
    intent: "Convert to stacked laundry + linen. Plumbing rough stays, vent through roof.",
    geom: { x: 4, y: 32, w: 22, h: 14 }, marker: { topPct: 28, leftPct: 14 } },
  { key: "primary_bath",    name: "Primary bath",       floor: "upper", dims: "8'4\" × 11'3\"",   sf: 94,  scope: "gut", listingPhotoId: "p6",
    intent: "Full gut. New tile, freestanding tub, double vanity, radiant floor.",
    geom: { x: 58, y: 32, w: 38, h: 18 }, marker: { topPct: 33, leftPct: 76 } },
  { key: "lightwell",       name: "Light well",         floor: "upper", dims: "10'2\" × 3'11\"",  sf: 40,  scope: "no_work", listingPhotoId: null,
    intent: "Untouched — exterior service.",
    geom: { x: 28, y: 32, w: 14, h: 10 }, marker: { topPct: 36, leftPct: 30 } },
  { key: "hallway_u",       name: "Hallway",            floor: "upper", dims: "—",                  sf: 80,  scope: "refresh", listingPhotoId: null,
    intent: "Paint + new flooring run continuous from upper level kitchen.",
    geom: { x: 44, y: 32, w: 14, h: 42 }, marker: { topPct: 44, leftPct: 50 } },
  { key: "bedroom_mid",     name: "Bedroom 3",          floor: "upper", dims: "11'10\" × 10'7\"", sf: 125, scope: "refresh", listingPhotoId: "p7",
    intent: "Cosmetic refresh + flooring continuous from hall.",
    geom: { x: 4, y: 52, w: 38, h: 22 }, marker: { topPct: 52, leftPct: 22 } },
  { key: "kitchen",         name: "Kitchen",            floor: "upper", dims: "8'9\" × 12'10\"",  sf: 112, scope: "gut", listingPhotoId: "p4",
    intent: "Full gut + open to dining. Remove non-bearing wall, new island, induction range, custom cabinetry.",
    geom: { x: 4, y: 84, w: 22, h: 22 }, marker: { topPct: 71, leftPct: 15 } },
  { key: "breakfast",       name: "Breakfast nook",     floor: "upper", dims: "8'9\" × 5'5\"",    sf: 47,  scope: "absorb", listingPhotoId: null,
    intent: "Absorbed into kitchen footprint — becomes banquette seating.",
    geom: { x: 4, y: 108, w: 22, h: 10 }, marker: { topPct: 89, leftPct: 15 } },
  { key: "dining",          name: "Dining",             floor: "upper", dims: "15'0\" × 10'10\"", sf: 163, scope: "open_plan", listingPhotoId: "p3",
    intent: "Open to kitchen. New pendant cluster centered on table position.",
    geom: { x: 28, y: 76, w: 42, h: 22 }, marker: { topPct: 72, leftPct: 52 } },
  { key: "living",          name: "Living",             floor: "upper", dims: "15'0\" × 14'0\"",  sf: 210, scope: "refresh", listingPhotoId: "p3",
    intent: "Cosmetic refresh, refit fireplace surround, new media wall on north elevation.",
    geom: { x: 28, y: 100, w: 70, h: 18 }, marker: { topPct: 88, leftPct: 65 } },

  // LOWER LEVEL — matches uploads/lower_level_floor_plan.jpg
  { key: "patio",           name: "Patio",              floor: "lower", dims: "23'6\" × 9'8\"",   sf: 227, scope: "no_work", listingPhotoId: null,
    intent: "Out of scope — informational only.",
    geom: { x: 4, y: 2, w: 92, h: 14 }, marker: { topPct: 8, leftPct: 50 } },
  { key: "family_room",     name: "Family room",        floor: "lower", dims: "11'9\" × 22'6\"",  sf: 264, scope: "refresh", listingPhotoId: "p8",
    intent: "Repaint, new flooring, retain stair detail. No structural work.",
    geom: { x: 4, y: 20, w: 42, h: 40 }, marker: { topPct: 32, leftPct: 22 } },
  { key: "bedroom_lower",   name: "Lower bedroom",      floor: "lower", dims: "12'0\" × 13'4\"",  sf: 160, scope: "refresh", listingPhotoId: null,
    intent: "Refresh paint, replace closet doors. Used as guest room.",
    geom: { x: 48, y: 20, w: 48, h: 22 }, marker: { topPct: 27, leftPct: 75 } },
  { key: "bath_lower",      name: "Lower bath",         floor: "lower", dims: "8'1\" × 5'0\"",    sf: 40,  scope: "refresh", listingPhotoId: null,
    intent: "New vanity + tile floor. Keep existing tub.",
    geom: { x: 60, y: 44, w: 18, h: 16 }, marker: { topPct: 44, leftPct: 70 } },
  { key: "laundry_l",       name: "Laundry (existing)", floor: "lower", dims: "—",                  sf: 25,  scope: "remove", listingPhotoId: null,
    intent: "Removed — laundry relocates to upstairs hall bath conversion.",
    geom: { x: 30, y: 62, w: 14, h: 16 }, marker: { topPct: 50, leftPct: 37 } },
  { key: "storage",         name: "Storage",            floor: "lower", dims: "8'1\" × 3'0\"",    sf: 24,  scope: "no_work", listingPhotoId: null,
    intent: "Untouched.",
    geom: { x: 46, y: 62, w: 16, h: 8 }, marker: { topPct: 52, leftPct: 53 } },
  { key: "mech",            name: "Mech / WH",          floor: "lower", dims: "—",                  sf: 12,  scope: "no_work", listingPhotoId: null,
    intent: "WH replaced with tankless if budget allows — see scope toggles.",
    geom: { x: 64, y: 64, w: 14, h: 10 }, marker: { topPct: 54, leftPct: 67 } },
  { key: "garage",          name: "Garage",             floor: "lower", dims: "18'2\" × 21'9\"",  sf: 395, scope: "no_work", listingPhotoId: null,
    intent: "Out of scope. Will host EV charger circuit landing — coordinate with electrical.",
    geom: { x: 44, y: 94, w: 52, h: 40 }, marker: { topPct: 78, leftPct: 70 } },
  { key: "main_entry",      name: "Main entry",         floor: "lower", dims: "—",                  sf: 25,  scope: "refresh", listingPhotoId: "p1",
    intent: "Keep the patterned tile. Repaint, new light fixture.",
    geom: { x: 24, y: 98, w: 18, h: 18 }, marker: { topPct: 76, leftPct: 33 } },
  { key: "entryway",        name: "Entryway",           floor: "lower", dims: "5'8\" × 11'5\"",   sf: 65,  scope: "refresh", listingPhotoId: "p2",
    intent: "Repaint, retain existing flooring.",
    geom: { x: 4, y: 110, w: 20, h: 20 }, marker: { topPct: 88, leftPct: 16 } },
];

const SCOPE_TONE = {
  gut: { tone: "rose", label: "Full gut" },
  open_plan: { tone: "amber", label: "Open plan" },
  convert: { tone: "violet", label: "Convert" },
  refresh: { tone: "sky", label: "Refresh" },
  absorb: { tone: "amber", label: "Absorb" },
  remove: { tone: "zinc", label: "Remove" },
  no_work: { tone: "zinc", label: "No work" },
};

const TOGGLES_PUBLISHED = [
  { label: "Kitchen layout · downstairs-style island", description: "New island in kitchen, non-bearing wall removed.", category: "structural" },
  { label: "Convert hall bath to laundry", description: "Stacked W/D + linen storage replaces the upstairs hall bath.", category: "structural" },
  { label: "Engineered wood — main level", description: "6\" wide-plank engineered euro oak, matte UV finish, runs continuous main level.", category: "finish" },
  { label: "Mid-range quartz counters", description: "Quartz across baths + powder. One honed natural stone slab at kitchen.", category: "finish" },
  { label: "Ducted high-velocity HVAC", description: "Whole-home ducted system, low-profile registers.", category: "systems" },
  { label: "200A panel upgrade", description: "Service panel upgrade required for induction range + EV charger.", category: "systems" },
  { label: "Open dining ↔ kitchen", description: "Remove non-bearing wall between dining + kitchen; new island.", category: "layout" },
];

// Materials owner has decided to share publicly, keyed to roomKeys
const PORTAL_MATERIALS = [
  { id: "m1", category: "Cabinetry",   productName: "Rift white oak slab front, full overlay", brand: "Reform", roomKeys: ["kitchen"] },
  { id: "m2", category: "Countertop",  productName: "Calacatta Lincoln honed slab",            brand: "Stone Source", roomKeys: ["kitchen"] },
  { id: "m3", category: "Flooring",    productName: "6\" engineered euro oak, matte UV",       brand: "DuChâteau", roomKeys: ["kitchen", "dining", "living", "hallway_u", "bedroom_mid"] },
  { id: "m4", category: "Plumbing",    productName: "Vola HV1 wall-mount lav faucet",          brand: "Vola", roomKeys: ["primary_bath"] },
  { id: "m5", category: "Lighting",    productName: "Bocci 28 series — 7 pendant cluster",     brand: "Bocci", roomKeys: ["dining"] },
  { id: "m6", category: "Tile",        productName: "Heath 4×4 hand-glazed wall tile, fog",    brand: "Heath", roomKeys: ["primary_bath"] },
  { id: "m7", category: "Appliance",   productName: "Wolf 48\" dual-fuel range",               brand: "Wolf", roomKeys: ["kitchen"] },
  { id: "m8", category: "Hardware",    productName: "Sun Valley Bronze · Foundry pull, 8\"",   brand: "Sun Valley", roomKeys: ["kitchen"] },
];

const PORTAL_CATEGORY_META = {
  structural: { tone: "amber", color: "#fbbf24", label: "Structural" },
  finish:     { tone: "emerald", color: "#34d399", label: "Finish" },
  systems:    { tone: "sky", color: "#38bdf8", label: "Systems" },
  layout:     { tone: "violet", color: "#a78bfa", label: "Layout" },
};

// ---------- Mini floorplan SVG ----------
// Renders a single floor with rooms as labeled rectangles. Optionally highlights one.
function MiniFloorplan({ floor, highlightKey, onRoomClick, compact, className = "" }) {
  const rooms = ROOMS.filter(r => r.floor === floor);
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 100 140" className="w-full h-auto block" preserveAspectRatio="xMidYMid meet">
        {/* outer wall */}
        <rect x="2" y="0.5" width="96" height={floor === "upper" ? "119.5" : "135"} fill="none" stroke="#3f3f46" strokeWidth="0.6"/>
        {/* rooms */}
        {rooms.map(r => {
          const active = r.key === highlightKey;
          const dim = active ? "rgba(52, 211, 153, 0.18)" : "rgba(255,255,255,0.025)";
          const stroke = active ? "#34d399" : "#3f3f46";
          return (
            <g key={r.key}
               onClick={() => onRoomClick && onRoomClick(r.key)}
               style={{ cursor: onRoomClick ? "pointer" : "default" }}>
              <rect x={r.geom.x} y={r.geom.y} width={r.geom.w} height={r.geom.h}
                    fill={dim} stroke={stroke} strokeWidth={active ? 0.7 : 0.35}/>
              {!compact && r.geom.w >= 14 && r.geom.h >= 8 && (
                <text x={r.geom.x + r.geom.w/2} y={r.geom.y + r.geom.h/2 + 0.4}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={r.geom.w >= 28 ? 2.4 : 2.0}
                      fill={active ? "#d1fae5" : "#a1a1aa"}
                      style={{ fontFamily: "Inter, sans-serif", letterSpacing: 0.05 }}>
                  {r.name}
                </text>
              )}
              {!compact && r.geom.w >= 22 && r.geom.h >= 12 && r.dims !== "—" && (
                <text x={r.geom.x + r.geom.w/2} y={r.geom.y + r.geom.h/2 + 3.5}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={1.6} fill={active ? "#86efac" : "#52525b"}
                      style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                  {r.dims}
                </text>
              )}
            </g>
          );
        })}
        {/* floor label */}
        <text x="50" y={floor === "upper" ? "126" : "140"} textAnchor="middle" fontSize="3"
              fill="#71717a" style={{ fontFamily: "Inter, sans-serif", letterSpacing: 1, textTransform: "uppercase" }}>
          {floor === "upper" ? "Upper level" : "Lower level"}
        </text>
      </svg>
    </div>
  );
}

window.PROJECT = PROJECT;
window.OWNER = OWNER;
window.COLLABORATORS = COLLABORATORS;
window.LISTING_PHOTOS = LISTING_PHOTOS;
window.FLOORPLAN_IMAGES = FLOORPLAN_IMAGES;
window.INSPIRATION = INSPIRATION;
window.DOCS = DOCS;
window.ROOMS = ROOMS;
window.SCOPE_TONE = SCOPE_TONE;
window.TOGGLES_PUBLISHED = TOGGLES_PUBLISHED;
window.PORTAL_MATERIALS = PORTAL_MATERIALS;
window.PORTAL_CATEGORY_META = PORTAL_CATEGORY_META;
window.MiniFloorplan = MiniFloorplan;
