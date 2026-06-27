/* eslint-disable */
// =============================================================
// Build-Vision data model
// In production this comes from /api/build-vision/{uuid}, which
// pre-bakes the contractor's permitted view from D1 tables.
// =============================================================

// -------------------------------------------------------------
// TRADES — categorize every line item & section
// -------------------------------------------------------------
const TRADES = {
  gc:         { label: "General Contractor", abbr: "GC" },
  architect:  { label: "Architect",          abbr: "ARCH" },
  civil:      { label: "Civil Engineer",     abbr: "CIVIL" },
  structural: { label: "Structural Eng.",    abbr: "STRUCT" },
  carpenter:  { label: "Carpenter",          abbr: "CARP" },
  electrician:{ label: "Electrician",        abbr: "ELEC" },
  plumber:    { label: "Plumber",            abbr: "PLUMB" },
};

// -------------------------------------------------------------
// PERSONAS — defaults applied when admin issues a new link.
// Admin can override section visibility / budget detail per-link.
// -------------------------------------------------------------
const PERSONAS = {
  gc: {
    label: "General Contractor",
    sections: ["cover", "backyard", "flooring", "bathrooms", "primary-suite", "kitchen", "kitchen-c", "kitchen-d", "utilities", "end-of-brief"],
    budget: "rounded",      // off | rounded | detailed
    showInternal: false,
    showComparator: true,
    showPhotos: true,
  },
  architect: {
    label: "Architect",
    sections: ["cover", "kitchen", "kitchen-a", "kitchen-b", "kitchen-c", "kitchen-d", "primary-suite", "end-of-brief"],
    budget: "off",
    showComparator: true,
    showPhotos: true,
  },
  civil: {
    label: "Civil Engineer",
    sections: ["cover", "backyard", "end-of-brief"],
    budget: "off",
    showPhotos: true,
  },
  structural: {
    label: "Structural Engineer",
    sections: ["cover", "kitchen", "kitchen-c", "kitchen-d", "utilities", "end-of-brief"],
    budget: "off",
    showPhotos: true,
  },
  carpenter: {
    label: "Carpenter",
    sections: ["cover", "flooring", "kitchen", "kitchen-c", "end-of-brief"],
    budget: "detailed",
    showPhotos: true,
  },
  electrician: {
    label: "Electrician",
    sections: ["cover", "utilities", "kitchen", "kitchen-c", "bathrooms", "primary-suite", "end-of-brief"],
    budget: "off",
    showPhotos: true,
  },
  plumber: {
    label: "Plumber",
    sections: ["cover", "backyard", "bathrooms", "primary-suite", "kitchen", "kitchen-c", "end-of-brief"],
    budget: "off",
    showPhotos: true,
  },
};

// -------------------------------------------------------------
// SECTIONS — single source of truth for the brief.
// Each section is built dynamically; vendor link config decides
// which appear, whether $ is visible, whether internal blocks show.
// -------------------------------------------------------------
const SECTIONS = [
  // ----------------------------------------------------------
  {
    id: "cover", group: "00", groupLabel: "Overview", title: "Cover",
    eyebrow: "Welcome",
    kind: "cover",
    hero: "../photos-inline/cover/house-front.jpg",
    fact: { lot: "5,400 sf", built: 1948, beds: 3, baths: 2 },
    trades: ["all"],
  },
  // ----------------------------------------------------------
  {
    id: "triage", group: "00", groupLabel: "Overview", title: "Triage dashboard",
    eyebrow: "Internal triage",
    kind: "internal",       // only shown if vendor link explicitly opts in
    summary: "$300k Phase 1 cap. Scenario triage, parked items, phasing.",
    internalTitle: "$300k Phase 1 cap · how we triaged scope",
    internalBody: "You're seeing this because your scope touches a load-bearing decision (kitchen scenario, primary-suite shower, panel upgrade). Below is the cap we're underwriting against, the items we parked, and the phasing logic. We're sharing it sparingly — please don't forward.",
    trades: ["all"],
  },
  // ----------------------------------------------------------
  {
    id: "backyard", group: "01", groupLabel: "Backyard", title: "Drainage & patio",
    eyebrow: "Primary goal #1",
    flag: "primary",
    summary: "Solve the standing-water problem on the lower yard. Re-grade, sub-surface drainage, new patio surface tied to the deck.",
    photos: [
      { src: "../photos-inline/backyard/drone-overview.jpg",            caption: "Drone overview · standing water in lower yard" },
      { src: "../photos-inline/backyard/patio-deck.jpg",                caption: "Existing patio + deck transition" },
      { src: "../photos-inline/backyard/patio-from-deck-annotated.jpg", caption: "From deck · annotated drainage zones" },
      { src: "../photos-inline/backyard/retaining-walls.jpg",           caption: "Failing pony wall along the lower bed" },
    ],
    budget: { min: 45000, avg: 57000, max: 78000 },
    trades: ["gc", "civil", "plumber", "carpenter"],
    lineItems: [
      { id: "by-1", scope: "Sub-surface french drain, ~80 lf", trades: ["civil", "plumber"], min: 9500, avg: 12500, max: 18000, source: "d1:scope.backyard.drainage_french", rationale: "Existing soil report shows clay layer at 18\". French drain ties into existing storm tie-in at street side." },
      { id: "by-2", scope: "Re-grade lower yard, swale to drain", trades: ["civil", "gc"], min: 6500, avg: 8500, max: 11000, source: "d1:scope.backyard.regrade", rationale: "1.5% min slope away from foundation. Spoil hauled off-site." },
      { id: "by-3", scope: "Concrete patio, 320 sf, broom finish", trades: ["gc", "carpenter"], min: 14500, avg: 19000, max: 26000, source: "d1:scope.backyard.patio_slab", rationale: "Tied to existing deck footing. 4\" slab, #4 rebar @ 16\" oc." },
      { id: "by-4", scope: "Retaining wall replacement (pony wall)", trades: ["gc", "civil"], min: 8500, avg: 11000, max: 15500, source: "d1:scope.backyard.retaining", rationale: "Existing wood pony wall failing. Replace with CMU or pressure-treated timber." },
      { id: "by-5", scope: "Landscape resto (planting, irrigation)", trades: ["gc"], min: 6000, avg: 6000, max: 7500, source: "d1:scope.backyard.landscape", rationale: "Drought-tolerant. Drip irrigation tied to existing controller." },
    ],
  },
  // ----------------------------------------------------------
  {
    id: "flooring", group: "02", groupLabel: "Flooring", title: "Hardwood + concrete",
    eyebrow: "Whole-house refinish",
    summary: "Refinish 1,840 sf existing white oak upstairs. Polish + seal existing concrete slab downstairs. No new floor coverings.",
    photos: [
      { src: "../photos-inline/floorplans/upper-flooring.jpg", caption: "Upper level · 1,840 sf white oak to refinish" },
      { src: "../photos-inline/floorplans/lower-flooring.jpg", caption: "Lower level · 920 sf concrete slab to polish" },
    ],
    budget: { min: 42000, avg: 55000, max: 71000 },
    trades: ["gc", "carpenter"],
    lineItems: [
      { id: "fl-1", scope: "Refinish white oak, 1,840 sf", trades: ["carpenter"], min: 26000, avg: 33000, max: 41000, source: "d1:scope.flooring.oak_refinish", rationale: "Sand 3-pass, water-pop, 1 coat sealer + 2 coats Bona Traffic HD. Furniture-out for 5 days." },
      { id: "fl-2", scope: "Concrete polish + seal, 920 sf", trades: ["carpenter", "gc"], min: 11500, avg: 15000, max: 19500, source: "d1:scope.flooring.concrete", rationale: "Densifier + 1500-grit. Penetrating sealer. Existing crack repairs included." },
      { id: "fl-3", scope: "Threshold + transition strips", trades: ["carpenter"], min: 4500, avg: 7000, max: 10500, source: "d1:scope.flooring.transitions", rationale: "8 doorways. Solid white oak custom-milled to match." },
    ],
  },
  // ----------------------------------------------------------
  {
    id: "bathrooms", group: "03", groupLabel: "Bathrooms", title: "Guest + hall bath",
    eyebrow: "Standard refresh",
    summary: "Two non-primary baths. Vanity + fixture swap. Keep tile + tub. No layout changes.",
    photos: [
      { src: "../photos-inline/baths/hall-bath.jpg",  caption: "Hall bath · vanity + fixtures only" },
      { src: "../photos-inline/baths/lower-bath.jpg", caption: "Lower bath · same scope as hall" },
    ],
    budget: { min: 9000, avg: 14000, max: 21000 },
    trades: ["gc", "plumber", "electrician"],
    lineItems: [
      { id: "ba-1", scope: "Vanity + faucet swap (×2)", trades: ["plumber", "carpenter"], min: 4500, avg: 6500, max: 9000, source: "d1:scope.baths.vanity", rationale: "Stock 36\" vanities. Owner-supplied faucets." },
      { id: "ba-2", scope: "Toilet swap (×2)", trades: ["plumber"], min: 1800, avg: 2500, max: 3500, source: "d1:scope.baths.toilet", rationale: "Kohler comfort-height. Flange repair allowance included." },
      { id: "ba-3", scope: "Light + exhaust upgrade", trades: ["electrician"], min: 1500, avg: 2500, max: 4000, source: "d1:scope.baths.electrical", rationale: "LED vanity bars, Panasonic FV-0511. New 20A circuit if needed." },
      { id: "ba-4", scope: "Paint + trim + finish carpentry", trades: ["gc", "carpenter"], min: 1200, avg: 2500, max: 4500, source: "d1:scope.baths.paint", rationale: "Walls + ceiling + door trim. Mildew-resistant primer." },
    ],
  },
  // ----------------------------------------------------------
  {
    id: "primary-suite", group: "03", groupLabel: "Bathrooms", title: "Primary suite",
    eyebrow: "Suite + TBD shower",
    summary: "Primary bath + laundry stack relocation + TBD high-end shower assembly. Shower scenario (curbless/curb, steam, smart) determined separately.",
    photos: [
      { src: "../photos-inline/primary/bath-tub.jpg",      caption: "Existing tub · removed for curbless shower" },
      { src: "../photos-inline/primary/bath-vanity.jpg",   caption: "Existing single vanity · replaced w/ double" },
      { src: "../photos-inline/primary/bath-skylight.jpg", caption: "Skylight · flash + reseal, possible frame swap" },
      { src: "../photos-inline/primary/bedroom.jpg",       caption: "Primary bedroom · laundry stack relocation" },
    ],
    budget: { min: 38000, avg: 58000, max: 92000 },
    trades: ["gc", "plumber", "electrician", "architect", "carpenter"],
    lineItems: [
      { id: "ps-1", scope: "Curbless shower pan + linear drain", trades: ["plumber", "gc"], min: 8500, avg: 11500, max: 16000, source: "d1:scope.primary.shower_base", rationale: "Pre-sloped foam pan, ABS drain. Subfloor must be lowered 1.5\"." },
      { id: "ps-2", scope: "Tile (walls + floor, ~110 sf)", trades: ["carpenter"], min: 9500, avg: 13500, max: 19500, source: "d1:scope.primary.tile", rationale: "Large-format porcelain. Schluter waterproofing." },
      { id: "ps-3", scope: "Steam generator (optional add-on)", trades: ["plumber", "electrician"], min: 0, avg: 8000, max: 12500, source: "d1:scope.primary.steam_addon", rationale: "Mr.Steam MS90. Requires 240V circuit. Toggle ENABLE_STEAM_SHOWER." },
      { id: "ps-4", scope: "Smart shower controller (optional add-on)", trades: ["plumber", "electrician"], min: 0, avg: 2450, max: 4000, source: "d1:scope.primary.smart_addon", rationale: "U by Moen 4-outlet. Wi-Fi controller. Toggle ENABLE_SMART_SHOWER." },
      { id: "ps-5", scope: "Laundry stack relocation", trades: ["plumber", "electrician"], min: 6500, avg: 9500, max: 14500, source: "d1:scope.primary.laundry", rationale: "Wall move. New 2\" stack vent + 240V/30A circuit." },
      { id: "ps-6", scope: "Vanity, double-bowl + lighting", trades: ["carpenter", "electrician"], min: 5500, avg: 8500, max: 13000, source: "d1:scope.primary.vanity", rationale: "Custom walnut. Sconces flank mirror." },
      { id: "ps-7", scope: "Skylight servicing", trades: ["gc"], min: 2200, avg: 4500, max: 8500, source: "d1:scope.primary.skylight", rationale: "Existing leaks. Flash + reseal; if frame is rotten, replace." },
    ],
  },
  // ----------------------------------------------------------
  {
    id: "kitchen", group: "04", groupLabel: "Kitchen", title: "Four options · overview",
    eyebrow: "Scenario comparator",
    summary: "Four kitchen scenarios under evaluation. Scenarios A & B are parked (downstairs); C is active (upstairs U-shape); D is the baseline in-kind option.",
    kind: "comparator",
    photos: [
      { src: "../photos-inline/kitchen/cabinets-overview.jpg", caption: "Existing upstairs cabinets · scope of work" },
    ],
    trades: ["gc", "architect", "plumber", "electrician", "carpenter", "structural"],
    scenarios: [
      { key: "a", label: "Scenario A", loc: "Downstairs", sub: "Living-room side", layout: "Galley", plumbing: "Long-haul, new stack", deviation: 38500, status: "parked" },
      { key: "b", label: "Scenario B", loc: "Downstairs", sub: "Guest-bedroom side", layout: "L-shape", plumbing: "Mid-haul, shared stack", deviation: 31000, status: "parked" },
      { key: "c", label: "Scenario C", loc: "Upstairs",   sub: "Existing footprint", layout: "U-shape",  plumbing: "In-place, no new stack", deviation: 21000, status: "active" },
      { key: "d", label: "Scenario D", loc: "Upstairs",   sub: "Existing footprint", layout: "L-shape (in-kind)", plumbing: "In-place baseline", deviation: 12500, status: "baseline" },
    ],
    comparison: [
      { label: "Cabinetry & millwork",    a: 32000, b: 31000, c: 28500, d: 22000 },
      { label: "Plumbing rough + finish", a: 18500, b: 14500, c:  9500, d:  6500 },
      { label: "Electrical rough + finish",a: 11500, b: 10500, c:  9000, d:  6500 },
      { label: "Countertop (slab)",        a:  9500, b:  9500, c:  9500, d:  7500 },
      { label: "Tile / backsplash",        a:  4500, b:  4500, c:  4000, d:  3000 },
      { label: "Appliance install",        a:  3500, b:  3500, c:  3500, d:  2500 },
      { label: "Stack relocation",         a: 12500, b:  8500, c:     0, d:     0 },
    ],
  },
  // ----------------------------------------------------------
  {
    id: "kitchen-a", group: "04", groupLabel: "Kitchen", title: "A · downstairs · living-room side",
    eyebrow: "Scenario A · Parked",
    badge: "parked",
    summary: "Galley layout running along the existing living-room wall. Parked: triggers a new stack relocation and structural beam.",
    photos: [
      { src: "../photos-inline/kitchen/render-down-livingroom.jpg",     caption: "3D render · galley from entry" },
      { src: "../photos-inline/kitchen/render-down-livingroom-alt.jpg", caption: "3D render · galley from window side" },
      { src: "../photos-inline/kitchen/option-a-living-room.jpg",       caption: "Existing wall · proposed galley run" },
    ],
    trades: ["gc", "architect", "plumber", "structural"],
  },
  {
    id: "kitchen-b", group: "04", groupLabel: "Kitchen", title: "B · downstairs · guest-bedroom side",
    eyebrow: "Scenario B · Parked",
    badge: "parked",
    summary: "L-shape with sink on the partition wall. Parked: requires relocating guest-bedroom egress.",
    photos: [
      { src: "../photos-inline/kitchen/render-down-guestbed.jpg",   caption: "3D render · L-shape from doorway" },
      { src: "../photos-inline/kitchen/option-b-guest-bedroom.jpg", caption: "Existing guest bedroom · proposed kitchen volume" },
      { src: "../photos-inline/kitchen/partition-wall.jpg",         caption: "Partition wall · sink/plumbing chase" },
    ],
    trades: ["gc", "architect", "structural"],
  },
  {
    id: "kitchen-c", group: "04", groupLabel: "Kitchen", title: "C · upstairs · U-shape",
    eyebrow: "Scenario C · Active",
    badge: "active",
    summary: "Active selection. U-shape on existing upstairs footprint. Re-uses existing stack. Most cost-efficient + lowest plumbing risk.",
    photos: [
      // Top row · 3D renders of the kitchen
      { src: "../photos-inline/kitchen/render-up-ushape.jpg",         caption: "3D render · U-shape from entry" },
      { src: "../photos-inline/kitchen/render-up-ushape-living.jpg",  caption: "3D render · looking toward living room" },
      { src: "../photos-inline/kitchen/render-up-ushape-forward.jpg", caption: "3D render · forward view, sink wall" },
      // Bottom row · kitchen window followed by cabinet blueprint
      { src: "../photos-inline/kitchen/sink-window-interior.jpg",     caption: "Kitchen window · sink wall, existing" },
      { src: "../photos-inline/kitchen/option-c-ushape-measurements.jpg", caption: "Cabinet blueprint · U-shape, measurements" },
    ],
    trades: ["gc", "architect", "plumber", "electrician", "carpenter"],
  },
  {
    id: "kitchen-d", group: "04", groupLabel: "Kitchen", title: "D · upstairs · L-shape (in-kind)",
    eyebrow: "Scenario D · Baseline in-kind",
    badge: "baseline",
    summary: "Baseline in-kind. Existing L-shape footprint. No plumbing or electrical moves. Cost floor.",
    photos: [
      { src: "../photos-inline/kitchen/upstairs-lshape.jpg",   caption: "Existing upstairs kitchen · L-shape, in-kind" },
      { src: "../photos-inline/kitchen/option-d-l-keep.jpg",   caption: "Cabinet blueprint · L-shape, in-kind" },
    ],
    trades: ["gc", "architect"],
  },
  // ----------------------------------------------------------
  {
    id: "utilities", group: "05", groupLabel: "Utilities", title: "PG&E panel upgrade",
    eyebrow: "125A → 200A · MrCool bundle",
    summary: "Panel upgrade required for kitchen + primary suite loads. MrCool mini-split bundle handles the cooling deficit.",
    photos: [
      { src: "../photos-inline/infra/panel-125a.jpg",      caption: "Existing 125A main panel · to be upgraded" },
      { src: "../photos-inline/infra/subpanel.jpg",        caption: "Sub-panel · to be replaced" },
      { src: "../photos-inline/infra/subpanel-labels.jpg", caption: "Sub-panel labels · circuit inventory" },
      { src: "../photos-inline/infra/mrcool-bundle.jpg",   caption: "MrCool 3-zone mini-split bundle" },
      { src: "../photos-inline/infra/furnace.jpg",         caption: "Existing furnace · stays as heat source" },
      { src: "../photos-inline/infra/gas-meter.jpg",       caption: "Gas meter · contingent relocation" },
    ],
    budget: { min: 5000, avg: 22000, max: 35000 },
    trades: ["gc", "electrician"],
    lineItems: [
      { id: "ut-1", scope: "PG&E 125A → 200A service upgrade", trades: ["electrician"], min: 5500, avg: 9500, max: 14000, source: "d1:scope.utilities.pge_upgrade", rationale: "Mast + meter + main breaker. Coordination with PG&E required. Lead time 8–14 wks." },
      { id: "ut-2", scope: "Main + sub panel replacement", trades: ["electrician"], min: 3500, avg: 6500, max: 9500, source: "d1:scope.utilities.panels", rationale: "Square D QO 40-circuit. AFCI/GFCI breakers per current code." },
      { id: "ut-3", scope: "MrCool mini-split bundle (3-zone)", trades: ["electrician"], min: 0, avg: 6000, max: 8500, source: "d1:scope.utilities.mrcool", rationale: "Existing furnace stays. Cooling-only addition. Linesets in soffit." },
      { id: "ut-4", scope: "Gas meter relocation (contingent)", trades: ["plumber"], min: 0, avg: 0, max: 3000, source: "d1:scope.utilities.gas_meter", rationale: "Only if panel position triggers PG&E clearance issue." },
    ],
  },
  // ----------------------------------------------------------
  {
    id: "end-of-brief", group: "06", groupLabel: "Wrap", title: "End of brief",
    eyebrow: "Recap & questions",
    kind: "wrap",
    trades: ["all"],
  },
];

// -------------------------------------------------------------
// MOCK VENDOR LINKS — what /api/build-vision/{uuid} returns
// In production these live in D1: vendor_links table.
// -------------------------------------------------------------
const MOCK_LINKS = [
  {
    uuid: "gc-7f3a2b81",
    recipient: { name: "Alex Cohen", company: "Cohen Construction", role: "General Contractor" },
    persona: "gc",
    welcome: "Alex — full brief below. Budget figures shown rounded; line-item detail intentionally withheld. Use the comparator on the kitchen to bid each scenario. Drop questions inline; we'll respond in 24h.",
    createdAt: "2026-05-18T14:22:00Z",
    expiresAt: "2026-06-17T14:22:00Z",   // 30d TTL
    revoked: false,
    permissions: {
      // overrides PERSONA defaults
      budgetMode: "rounded",        // off | rounded | detailed
      showInternal: false,
      showComparator: true,
      showPhotos: true,
      hiddenSections: [],           // sections to force-hide
      hiddenInternal: ["triage"],   // internal sections allowed to show
      // Per-link caption overrides — when admin generates the bid link
      // they can rewrite any photo's default heading.
      photoCaptions: {
        "../photos-inline/kitchen/render-up-ushape.jpg": "U-shape · final render for bid",
        "../photos-inline/floorplans/upper-flooring.jpg": "Upper level · refinish scope (yours)",
      },
    },
    stats: { opens: 3, lastOpen: "2026-05-24T09:13:00Z", timeSpent: "18m 42s", sectionsViewed: 7 },
    flow: [
      { ts: "2026-05-18T15:01:00Z", event: "Opened brief" },
      { ts: "2026-05-18T15:01:14Z", event: "Viewed Cover" },
      { ts: "2026-05-18T15:02:28Z", event: "Viewed Backyard" },
      { ts: "2026-05-18T15:08:11Z", event: "Viewed Kitchen overview" },
      { ts: "2026-05-18T15:12:43Z", event: "Expanded Scenario C line items" },
      { ts: "2026-05-22T11:30:02Z", event: "Re-opened brief" },
      { ts: "2026-05-22T11:35:18Z", event: "Asked question on Primary suite line ps-1" },
    ],
    questions: [
      { id: "q1", sectionId: "primary-suite", anchor: "Curbless shower pan + linear drain", text: "Subfloor lowering: is the floor joist depth above 2x10? Affects whether we can sister or have to scab.", askedAt: "2026-05-22T11:35:18Z", reply: null },
      { id: "q2", sectionId: "kitchen-c", anchor: "Scenario C · Active", text: "Confirming the existing stack location upstairs — is there an access panel from the laundry side or do we need to open the ceiling below?", askedAt: "2026-05-23T08:11:00Z", reply: { text: "Access panel exists in laundry ceiling. We'll send a photo.", repliedAt: "2026-05-23T10:02:00Z" } },
      // Photo-level comment (no annotation) — seeded so the lightbox is non-empty.
      { id: "q3", sectionId: "kitchen-c", anchor: "Photo · Cabinet blueprint · U-shape, measurements", text: "The 105\" overall on the back wall — is that finished-face or stud-to-stud? Affects the appliance pocket.", photoSrc: "../photos-inline/kitchen/option-c-ushape-measurements.jpg", annotations: [], askedAt: "2026-05-23T14:02:00Z", reply: null },
      // Region annotation — the reviewer sees the highlighted rectangle.
      { id: "q4", sectionId: "kitchen-c", anchor: "Photo region · 3D render · forward view, sink wall", text: "Confirming this upper cabinet stops short of the hood — there's a 2\" reveal? Want to be sure before pricing the trim.", photoSrc: "../photos-inline/kitchen/render-up-ushape-forward.jpg", annotations: [{ x: 0.52, y: 0.08, w: 0.22, h: 0.18 }], askedAt: "2026-05-24T09:11:00Z", reply: null },
      // AI chat — recipient asked the assistant for clarification.
      // In production this is written from a Cloudflare Worker via the Agent SDK
      // into the `ask_chats` + `ask_turns` D1 tables keyed by the bid uuid.
      { id: "ai_demo1", sectionId: "primary-suite", kind: "ai-chat",
        anchor: "Subfloor must be lowered 1.5\".",
        text: "Subfloor must be lowered 1.5\".",
        messages: [
          { role: "user", content: "Why does the subfloor need to be lowered exactly 1.5\" for the curbless shower? Could we go shallower and use a thinner pan?" },
          { role: "assistant", content: "The 1.5\" comes from the pre-sloped foam pan we spec'd (Schluter-style). Shallower pans exist but they require a flush linear drain trough plus a thinner mortar bed, which raises the risk of ponding at the ¼-per-foot slope the code wants. If you have a thinner assembly you've used before, share the cut sheet and we can review — the goal is curbless + no ponding, not 1.5\" specifically." },
          { role: "user", content: "Got it — I'll send the Wedi cut sheet I usually use." },
          { role: "assistant", content: "Sounds good. We just need to confirm the joist depth (you flagged 2x10 in a comment) so we know whether sistering is enough or we need scab framing." },
        ],
        askedAt: "2026-05-24T10:34:00Z", reply: null },
    ],
  },
  {
    uuid: "arch-c2d3e4",
    recipient: { name: "Maya Levinson", company: "ML Architecture", role: "Architect" },
    persona: "architect",
    welcome: "Maya — design-relevant sections only. No budget figures shared. Focus on kitchen scenario tradeoffs and primary-suite plan.",
    createdAt: "2026-05-20T10:00:00Z",
    expiresAt: "2026-06-19T10:00:00Z",
    revoked: false,
    permissions: { budgetMode: "off", showInternal: false, showComparator: true, showPhotos: true, hiddenSections: [], hiddenInternal: [] },
    stats: { opens: 1, lastOpen: "2026-05-21T16:45:00Z", timeSpent: "9m 12s", sectionsViewed: 5 },
    flow: [
      { ts: "2026-05-21T16:45:00Z", event: "Opened brief" },
      { ts: "2026-05-21T16:48:30Z", event: "Viewed Kitchen overview" },
      { ts: "2026-05-21T16:52:14Z", event: "Compared Scenarios C and D" },
    ],
    questions: [],
  },
  {
    uuid: "plumb-9a1f4c",
    recipient: { name: "Diego Ramirez", company: "Ramirez Plumbing", role: "Plumber" },
    persona: "plumber",
    welcome: "Diego — plumbing-relevant scope only. Curbless shower pan + steam are the trickiest pieces. Budget not shared at this stage.",
    createdAt: "2026-05-21T09:00:00Z",
    expiresAt: "2026-06-20T09:00:00Z",
    revoked: false,
    permissions: { budgetMode: "off", showInternal: false, showComparator: false, showPhotos: true, hiddenSections: [], hiddenInternal: [] },
    stats: { opens: 0, lastOpen: null, timeSpent: "0s", sectionsViewed: 0 },
    flow: [],
    questions: [],
  },
];

// -------------------------------------------------------------
// BUDGET TOTALS — used by the KPI strip + what-if
// -------------------------------------------------------------
const BUDGET_CAP = 300000;

// -------------------------------------------------------------
// Export onto window so other Babel scripts can read it.
// -------------------------------------------------------------
Object.assign(window, {
  BV_TRADES: TRADES,
  BV_PERSONAS: PERSONAS,
  BV_SECTIONS: SECTIONS,
  BV_MOCK_LINKS: MOCK_LINKS,
  BV_BUDGET_CAP: BUDGET_CAP,
});
