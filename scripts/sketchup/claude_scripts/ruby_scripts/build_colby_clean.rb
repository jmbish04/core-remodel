# build_colby_clean.rb
# =============================================================================
# 126 COLBY ST — CLEAN-SLATE, WATERTIGHT 2-STORY REBUILD
# -----------------------------------------------------------------------------
# Abandons the piecemeal patching of base_colby and rebuilds the whole house
# "the right way": every wall is a continuous, watertight solid (add_face +
# push/pull), every element lives in a strict Outliner group hierarchy, and
# every surface carries a proper Tag (Layer) + moody-modern material.
#
# GROUNDING: all coordinates are GLOBAL inches, lifted from
#   scripts/sketchup/claude_scripts/sketchup_diagnostics.json  (the real model)
# and reconciled with the "updated layout logic" in the rebuild brief. The known
# Frankenstein defects are corrected in-place (see "BAKED-IN FIXES" below), so we
# do not reproduce them.
#
# COORDINATE FRAME (confirmed from diagnostics):
#   X : 0 (West/left outer face) .. 300 (East/right outer face)   = 25'-0" wide
#   Y : 0 (Front/street/south)   .. 588 (Back/north outer face)   = 49'-0" deep
#       (upper rear bedrooms cantilever to Y=660; backyard beyond)
#   Z : up. Foundation < 0.
#
# Z CONSTANTS (per brief, matched to diagnostics):
#   Lower finished floor   Z =   0
#   Lower ceiling          Z =  96
#   Lower/upper transition Z = 120  (upper finished floor)
#   Upper ceiling          Z = 216
#   Pony walls             Z = 162  (42" above the 120" upper floor)
#   Roof deck              Z = 220
#
# BAKED-IN FIXES (from fix_stairwell_geometry.rb + analyze_walls.py):
#   * East (right) exterior rebuilt as ONE uniform 6.5" wall (inner 293.5 /
#     outer 300) — closes the 2.5–5.4" void and the lower/upper jog.
#   * Stair void left OPEN through the 120" slab; capped only by a 42" North+West
#     pony rail (no buried solid slab).
#   * Stair flight divider re-sloped 162" (upper landing) -> 96" (lower floor).
#   * Rogue front closet return (the one floating in the kitchen) is NOT rebuilt.
#   * Foyer/Garage divider runs unbroken to the Red Wall (no dangling gap).
#
# SAFETY: this script REFUSES to run in a non-empty model, so it can never touch
# base_colby. Do File -> New first, then run it in the empty document. It saves a
# brand-new colby_clean_rebuild.skp next to base_colby and never overwrites it.
#
# RUN (SketchUp Ruby Console):
#   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/ruby_scripts/build_colby_clean.rb'
# =============================================================================
require 'sketchup.rb'

module ColbyBuild
  # ----------------------------------------------------------------------------
  # CONSTANTS
  # ----------------------------------------------------------------------------
  # Z heights
  Z_FND_BOT = -18.0   # bottom of foundation
  Z_FND_TOP =  -2.0   # top of foundation / underside of floor slab
  Z_LFF     =   0.0   # lower finished floor
  Z_LCEIL   =  96.0   # lower interior ceiling
  Z_UFF     = 120.0   # upper finished floor (lower exterior carries up to here)
  Z_UCEIL   = 216.0   # upper ceiling
  Z_PONY    = 162.0   # pony / guard-rail top (42" above UFF)
  Z_ROOF    = 220.0   # roof deck top

  # Plan extents (main 2-story block)
  X_W, X_E   = 0.0, 300.0       # exterior outer faces, west/east
  Y_F, Y_B   = 0.0, 588.0       # exterior outer faces, front/back
  Y_BU       = 660.0            # upper rear-bedroom back wall (cantilever)
  WALL       = 6.5              # exterior wall thickness
  PART       = 4.5              # interior partition thickness
  XEI        = X_E - WALL       # east interior face  = 293.5
  YBI        = Y_B - WALL       # back interior face   = 581.5

  # Stair void (kept open through the upper slab)
  SV_X0, SV_X1 = 180.6, 293.5
  SV_Y0, SV_Y1 = 256.5, 302.5

  # Moody-modern / Japandi palette  (name => [r,g,b])
  COLORS = {
    'Exterior Walls'             => [ 41,  41,  44],
    'Interior Partitions'        => [ 74,  70,  65],
    'Floors'                     => [ 46,  37,  30],
    'Roof'                       => [ 26,  26,  28],
    'Stairs'                     => [ 58,  50,  42],
    'Doors'                      => [ 48,  37,  28],
    'Finishes - Dark Walnut'     => [ 60,  41,  28],
    'Finishes - Calacatta Viola' => [233, 227, 223],
    'Glass/Glazing'              => [150, 178, 190],   # alpha applied at build
    'Site & Foundation'          => [ 57,  55,  51],
    'MEP - Plumbing'             => [ 80, 120, 158],
    'MEP - Electrical'           => [205, 170,  70],
    'Appliances'                 => [122, 124, 128],
  }.freeze
  GLASS_ALPHA = 0.35

  Z_AXIS = Geom::Vector3d.new(0, 0, 1)
  Y_AXIS = Geom::Vector3d.new(0, 1, 0)
  X_AXIS = Geom::Vector3d.new(1, 0, 0)

  module_function

  # ----------------------------------------------------------------------------
  # TAGS + MATERIALS
  # ----------------------------------------------------------------------------
  def tag(name)
    return nil if name.nil?
    @tags[name] ||= (@model.layers[name] || @model.layers.add(name))
  end

  def material(name)
    return nil if name.nil?
    return @mats[name] if @mats[name]
    m = @model.materials[name] || @model.materials.add(name)
    rgb = COLORS[name] || [128, 128, 128]
    m.color = Sketchup::Color.new(rgb[0], rgb[1], rgb[2])
    m.alpha = GLASS_ALPHA if name == 'Glass/Glazing'
    @mats[name] = m
  end

  def setup_tags_and_materials
    COLORS.each_key { |n| tag(n); material(n) }
  end

  # ----------------------------------------------------------------------------
  # GEOMETRY HELPERS  (fresh model => every group sits at identity transform,
  # so we can author directly in world inches).
  # ----------------------------------------------------------------------------
  def subgroup(parent, name)
    g = parent.entities.add_group
    g.name = name
    g
  end

  # Axis-aligned watertight box. parent is a Group. mat defaults to the tag.
  def box(parent, x0, x1, y0, y1, z0, z1, name, tagname = nil, matname = tagname)
    x0, x1 = x1, x0 if x0 > x1
    y0, y1 = y1, y0 if y0 > y1
    z0, z1 = z1, z0 if z0 > z1
    return nil if (z1 - z0).abs < 1e-4 || (x1 - x0).abs < 1e-4 || (y1 - y0).abs < 1e-4
    g = parent.entities.add_group
    g.name = name
    f = g.entities.add_face([
      Geom::Point3d.new(x0, y0, z0), Geom::Point3d.new(x1, y0, z0),
      Geom::Point3d.new(x1, y1, z0), Geom::Point3d.new(x0, y1, z0)
    ])
    f.reverse! if f.normal.dot(Z_AXIS) < 0
    f.pushpull(z1 - z0)
    g.layer = tag(tagname) if tagname
    g.material = material(matname) if matname
    g
  end

  # Thin glass/door panel. `axis` is the thin direction (:x, :y, or :z).
  def panel(parent, x0, x1, y0, y1, z0, z1, name, tagname, matname = tagname)
    box(parent, x0, x1, y0, y1, z0, z1, name, tagname, matname)
  end

  # Solid with a flat bottom and a top that ramps between two heights.
  #   axis :x  -> top = z_lo at x0  rising to z_hi at x1, extruded over [y0,y1]
  #   axis :y  -> top = z_lo at y0  rising to z_hi at y1, extruded over [x0,x1]
  def sloped(parent, x0, x1, y0, y1, z_bot, z_lo, z_hi, axis, name, tagname = nil, matname = tagname)
    g = parent.entities.add_group
    g.name = name
    if axis == :x
      f = g.entities.add_face([
        Geom::Point3d.new(x0, y0, z_bot), Geom::Point3d.new(x1, y0, z_bot),
        Geom::Point3d.new(x1, y0, z_hi),  Geom::Point3d.new(x0, y0, z_lo)
      ])
      f.reverse! if f.normal.dot(Y_AXIS) < 0
      f.pushpull(y1 - y0)
    else
      f = g.entities.add_face([
        Geom::Point3d.new(x0, y0, z_bot), Geom::Point3d.new(x0, y1, z_bot),
        Geom::Point3d.new(x0, y1, z_hi),  Geom::Point3d.new(x0, y0, z_lo)
      ])
      f.reverse! if f.normal.dot(X_AXIS) < 0
      f.pushpull(x1 - x0)
    end
    g.layer = tag(tagname) if tagname
    g.material = material(matname) if matname
    g
  end

  # Rectangular hollow wall-tube from a SINGLE closed polygon push/pull
  # (outer loop minus inner loop), per the brief's "draw the room as one closed
  # polygon, then push/pull" instruction. loops are [[x,y],...] in world inches.
  def wall_tube(parent, outer, inner, z0, z1, name, tagname = 'Interior Partitions')
    g = parent.entities.add_group
    g.name = name
    g.entities.add_face(outer.map { |x, y| Geom::Point3d.new(x, y, z0) })
    hole = g.entities.add_face(inner.map { |x, y| Geom::Point3d.new(x, y, z0) })
    hole.erase! # leave a hole; shared edges remain and bound the ring face
    ring = g.entities.grep(Sketchup::Face).max_by(&:area)
    raise "wall_tube('#{name}'): ring face not formed" unless ring
    ring.reverse! if ring.normal.dot(Z_AXIS) < 0
    ring.pushpull(z1 - z0)
    g.layer = tag(tagname) if tagname
    g.material = material(tagname) if tagname
    g
  end

  # Horizontal slab with one or more rectangular openings punched through.
  # holes = [[hx0,hx1,hy0,hy1], ...] in world inches. Same single-polygon
  # push/pull technique as wall_tube, so openings are true voids.
  def slab_with_holes(parent, x0, x1, y0, y1, z0, z1, holes, name, tagname)
    g = parent.entities.add_group
    g.name = name
    g.entities.add_face([
      Geom::Point3d.new(x0, y0, z0), Geom::Point3d.new(x1, y0, z0),
      Geom::Point3d.new(x1, y1, z0), Geom::Point3d.new(x0, y1, z0)
    ])
    holes.each do |hx0, hx1, hy0, hy1|
      h = g.entities.add_face([
        Geom::Point3d.new(hx0, hy0, z0), Geom::Point3d.new(hx1, hy0, z0),
        Geom::Point3d.new(hx1, hy1, z0), Geom::Point3d.new(hx0, hy1, z0)
      ])
      h.erase!
    end
    slab = g.entities.grep(Sketchup::Face).max_by(&:area)
    raise "slab_with_holes('#{name}'): face not formed" unless slab
    slab.reverse! if slab.normal.dot(Z_AXIS) < 0
    slab.pushpull(z1 - z0)
    g.layer = tag(tagname) if tagname
    g.material = material(tagname) if tagname
    g
  end

  # ----------------------------------------------------------------------------
  # 1. SITE & FOUNDATION  (Z < 0) + FLOOR / ROOF SLABS
  # ----------------------------------------------------------------------------
  def build_site_and_foundation
    g = @g_site
    # Continuous foundation slab under the whole footprint.
    box(g, X_W, X_E, Y_F, Y_B, Z_FND_BOT, Z_FND_TOP, 'Foundation Slab', 'Site & Foundation')
    # Perimeter stem-wall ring (reads as footing under the exterior walls).
    box(g, X_W, X_W + WALL, Y_F, Y_B, Z_FND_BOT, Z_LFF, 'Stem Wall - West',  'Site & Foundation')
    box(g, X_E - WALL, X_E, Y_F, Y_B, Z_FND_BOT, Z_LFF, 'Stem Wall - East',  'Site & Foundation')
    box(g, X_W, X_E, Y_F, Y_F + WALL, Z_FND_BOT, Z_LFF, 'Stem Wall - Front', 'Site & Foundation')
    box(g, X_W, X_E, Y_B - WALL, Y_B, Z_FND_BOT, Z_LFF, 'Stem Wall - Back',  'Site & Foundation')
    # Site service lines (from diagnostics: irrigation + electrical to the rear).
    box(g, 130.2, 131.8, 588.0, 732.8, -30.0, 22.8, 'Site - Irrigation Line', 'Site & Foundation')
    box(g, 184.2, 185.8, 588.0, 732.8, -30.0, 42.8, 'Site - Electrical Line', 'Site & Foundation')
  end

  def build_slabs
    # --- Lower finished-floor slab (full footprint) ---
    box(@g_lower, X_W, X_E, Y_F, Y_B, Z_FND_TOP, Z_LFF, 'LL Floor Slab', 'Floors')

    # --- Upper finished-floor slab (Z116->120), framed AROUND the open stair
    #     void so the stairwell stays open. Four clean panels = no buried slab. ---
    s = subgroup(@g_upper, 'UL Floor Slab')
    box(s, X_W, X_E, Y_F,  SV_Y0, 116.0, Z_UFF, 'UL Slab - Front',  'Floors')   # ahead of void
    box(s, X_W, X_E, SV_Y1, Y_BU, 116.0, Z_UFF, 'UL Slab - Back',   'Floors')   # behind void (to rear bays)
    box(s, X_W, SV_X0, SV_Y0, SV_Y1, 116.0, Z_UFF, 'UL Slab - West', 'Floors')  # west of void
    box(s, SV_X1, X_E, SV_Y0, SV_Y1, 116.0, Z_UFF, 'UL Slab - East', 'Floors')  # thin east strip

    # --- Roof deck (full footprint incl. rear cantilever) with the two skylight
    #     openings punched through; glass panels (Glazing group) sit in them. ---
    skylights = [
      [6.5, 128.5, 377.5, 424.5],  # lightwell skylight
      [229.0, 253.0, 379.0, 403.0] # primary-bath 24"x24" skylight
    ]
    slab_with_holes(@g_upper, X_W, X_E, Y_F, Y_BU, Z_UCEIL, Z_ROOF, skylights, 'Roof Deck', 'Roof')
  end

  # ----------------------------------------------------------------------------
  # 2. LOWER LEVEL STRUCTURE  (Z 0 -> 120)
  # ----------------------------------------------------------------------------
  def build_lower_level
    ext = subgroup(@g_lower, 'LL Exterior Shell')
    # Unified, full-2-story exterior shell carried up to the 120" upper floor.
    box(ext, X_W, X_W + WALL, Y_F, Y_B, Z_LFF, Z_UFF, 'Left Exterior (Lower)',  'Exterior Walls')
    box(ext, X_E - WALL, X_E, Y_F, Y_B, Z_LFF, Z_UFF, 'Right Exterior (Lower)', 'Exterior Walls') # uniform 6.5" (fix4)
    box(ext, X_W, XEI, YBI, Y_B, Z_LFF, Z_UFF, 'Back Exterior (Lower)', 'Exterior Walls')
    box(ext, 78.5, 296.0, Y_F, Y_F + WALL, Z_LFF, Z_UFF, 'Front Garage Exterior', 'Exterior Walls')

    # Front porch + entry (front-left bay, street side).
    box(ext, 6.5, 36.5, Y_F, 4.5,  Z_LFF, 116.0, 'Porch Front Wall (Gate Infill)', 'Exterior Walls')
    box(ext, 6.5, 83.0, 60.0, 64.5, Z_LFF, 116.0, 'Front Door Wall (Pivot)',        'Exterior Walls')
    box(ext, 78.5, 82.0, 6.5, 60.0, Z_LFF, 116.0, 'Porch / Garage Divider',         'Exterior Walls')

    part = subgroup(@g_lower, 'LL Interior Partitions')
    # Foyer / garage spine — runs UNBROKEN to the Red Wall (fix5: no dangling gap).
    box(part, 78.5, 83.0, 64.5, 297.7, Z_LFF, 116.0, 'Foyer / Garage Divider',       'Interior Partitions')
    box(part, 154.0, 158.5, 230.0, 265.0, Z_LFF, 116.0, 'Foyer / HVAC Divider (West)',  'Interior Partitions')
    box(part, 158.5, 293.5, 262.9, 265.0, Z_LFF, 116.0, 'Stairs / HVAC Divider (North)', 'Interior Partitions')
    # Foyer "Red Wall" hallway band across the house at the stair line.
    box(part, 78.5, 184.2, 297.7, 302.5, Z_LFF, 115.6, 'Foyer Red Wall (Hallway)', 'Interior Partitions')

    # Lower guest bath + guest bedroom suite (rear-left of lower level).
    box(part, 184.0, 293.5, 345.0, 349.5, Z_LFF, Z_LCEIL, 'Bath / Stair Divider',          'Interior Partitions')
    box(part, 184.0, 188.5, 349.5, 416.0, Z_LFF, Z_LCEIL, 'Bath West (Hallway)',           'Interior Partitions')
    box(part, 184.0, 293.5, 416.0, 420.5, Z_LFF, Z_LCEIL, 'Bath / Closet Divider',         'Interior Partitions')
    box(part, 184.0, 188.5, 420.5, 444.0, Z_LFF, Z_LCEIL, 'Closet West (Hallway Return)',  'Interior Partitions')
    box(part, 143.0, 188.5, 444.0, 448.5, Z_LFF, Z_LCEIL, 'Guest Bed Entrance Wall',       'Interior Partitions')
    box(part, 184.0, 293.5, 444.0, 448.5, Z_LFF, Z_LCEIL, 'Guest Bed Closet Front',        'Interior Partitions')
    box(part, 143.0, 147.5, 448.5, 581.5, Z_LFF, Z_LCEIL, 'Family / Guest Bed Divider',    'Interior Partitions')
  end

  # ----------------------------------------------------------------------------
  # 3. UPPER LEVEL STRUCTURE  (Z 120 -> 216)
  # ----------------------------------------------------------------------------
  def build_upper_level
    ext = subgroup(@g_upper, 'UL Exterior Shell')
    # Exterior shell continues; sides + back run to the rear-bedroom line (Y660).
    box(ext, X_W, X_W + WALL, Y_F, Y_BU, Z_UFF, Z_UCEIL, 'Left Exterior (Upper)',  'Exterior Walls')
    box(ext, X_E - WALL, X_E, Y_F, Y_BU, Z_UFF, Z_UCEIL, 'Right Exterior (Upper)', 'Exterior Walls')
    box(ext, X_W, XEI, Y_BU - WALL, Y_BU, Z_UFF, Z_UCEIL, 'Back Exterior (Upper)', 'Exterior Walls')

    # --- FRONT FACADE: cantilevered "box bay" projecting to Y = -24, plus the
    #     flush wall to its left. ---
    bay = subgroup(@g_upper, 'UL Open Concept (Living / Kitchen)')
    box(bay, 78.5, X_E, -24.0, 4.5, Z_UFF, Z_UCEIL, 'UP - Box Bay (cantilever, squared)', 'Exterior Walls')
    box(bay, 6.5, 78.5, Y_F, 6.5,  Z_UFF, Z_UCEIL, 'UP - Front Flush Wall (left of bay)',  'Exterior Walls')

    # --- MIDDLE BEdtagOOM (Bed6): drawn as ONE closed polygon (L-shape: main room
    #     + 2'-6" closet return), push/pulled 120->216, anchored at the roof-drain
    #     chase corner (143, 257). ---
    bed6 = subgroup(@g_upper, 'UL Middle Bedroom (Bed6)')
    # Outer wall loop (CCW) and inner loop offset by the 4.5" partition.
    # Inner loop is offset 4.5" inward on every side (incl. west) so the hole is
    # fully interior — a robust closed ring, no edge coincident with the outline.
    outer = [[6.5,191.0],[94.5,191.0],[94.5,252.5],[143.0,252.5],[143.0,373.0],[6.5,373.0]]
    inner = [[11.0,195.5],[90.0,195.5],[90.0,257.0],[138.5,257.0],[138.5,368.5],[11.0,368.5]]
    wall_tube(bed6, outer, inner, 116.0, Z_UCEIL, 'UP - Bed6 Walls (single polygon)', 'Interior Partitions')
    # The roof-drain chase that the SE corner anchors to.
    box(bed6, 120.0, 143.0, 257.5, 263.5, 116.0, Z_UCEIL, 'UP - Roof Drain Chase', 'Interior Partitions')

    # --- PRIMARY BATH enclosing walls (zones/millwork added later). ---
    pb = subgroup(@g_upper, 'UL Primary Bath')
    box(pb, 184.0, 293.5, 349.5, 354.0, 116.0, Z_UCEIL, 'UP - Primary Bath South Wall', 'Interior Partitions')
    box(pb, 184.0, 188.5, 349.5, 416.0, 116.0, Z_UCEIL, 'UP - Hallway East (Stairs)',   'Interior Partitions')
    box(pb, 184.0, 188.5, 416.0, 488.0, 116.0, Z_UCEIL, 'UP - Primary Bath West Wall',  'Interior Partitions')

    # --- MIDDLE-BEdtagOOM LIGHTWELL + HALL BATH / CLOSET (rear-left core). ---
    lw = subgroup(@g_upper, 'UL Lightwell + Hall Core')
    box(lw, 6.5, 133.0, 373.0, 377.5, 116.0, Z_UCEIL, 'UP - Lightwell South Wall',  'Interior Partitions')
    box(lw, 133.0, 143.0, 373.0, 377.5, 116.0, Z_UCEIL, 'UP - Hall Closet South Wall', 'Interior Partitions')
    box(lw, 143.0, 147.5, 252.5, 424.5, 116.0, Z_UCEIL, 'UP - Hallway / Bed6 Divider', 'Interior Partitions')
    box(lw, 128.5, 133.0, 377.5, 424.5, 116.0, Z_UCEIL, 'UP - Lightwell East Wall',   'Interior Partitions')
    box(lw, 6.5, 111.0, 424.5, 429.0, 116.0, Z_UCEIL, 'UP - Hall Bath South Wall',    'Interior Partitions')
    box(lw, 111.0, 147.2, 424.5, 429.0, 116.0, Z_UCEIL, 'UP - Hall Closet North Wall', 'Interior Partitions')
    box(lw, 106.5, 111.0, 429.0, 488.0, 116.0, Z_UCEIL, 'UP - Hall Bath East Wall',   'Interior Partitions')

    # --- REAR BEdtagOOMS (Back-Left + Primary) with central spine. ---
    bd = subgroup(@g_upper, 'UL Rear Bedrooms')
    box(bd, 6.5, 147.5, 488.0, 492.5, 116.0, Z_UCEIL, 'UP - Back-Left Bedroom Front Wall', 'Interior Partitions')
    box(bd, 152.0, 293.5, 488.0, 492.5, 116.0, Z_UCEIL, 'UP - Primary Bedroom Front Wall', 'Interior Partitions')
    box(bd, 147.5, 152.0, 488.0, Y_BU, 116.0, Z_UCEIL, 'UP - Central Spine (Bed7 / Bed8)', 'Interior Partitions')
  end

  # ----------------------------------------------------------------------------
  # 4. STAIRWELL  (open void + pony rails + sloped flight divider + stair mass)
  # ----------------------------------------------------------------------------
  def build_stairwell
    sw = subgroup(@g_upper, 'UL Stairwell')
    rail = 4.5
    # 42" guard rail wrapping ONLY the North + West edges of the open void.
    box(sw, SV_X0, SV_X1, SV_Y0, SV_Y0 + rail, Z_UFF, Z_PONY, 'UP - Stair Rail (North)', 'Interior Partitions')
    box(sw, SV_X0, SV_X0 + rail, SV_Y0, SV_Y1, Z_UFF, Z_PONY, 'UP - Stair Rail (West)',  'Interior Partitions')
    # Flight divider: slopes 162" at the upper landing (Y=302.5) down to 96" at the
    # lower floor line (Y=265). Centered in the run.
    sloped(sw, 231.5, 236.0, 265.0, 302.5, Z_LFF, Z_LCEIL, Z_PONY, :y,
           'UP - Stair Flight Divider (sloped 96->162)', 'Interior Partitions')

    # Lower stair mass as a clean ramped solid (treads refined later in-app).
    st = subgroup(@g_lower, 'LL Stairs')
    sloped(st, 173.5, 293.5, 265.0, 345.0, Z_LFF, 6.0, 112.5, :y,
           'Staircase (ramped mass)', 'Stairs')
  end

  # ----------------------------------------------------------------------------
  # 5a. KITCHEN MILLWORK  (Dark Walnut run + Calacatta Viola waterfall island)
  # ----------------------------------------------------------------------------
  def build_kitchen_millwork
    k = subgroup(@g_mill, 'Kitchen')
    dw = 'Finishes - Dark Walnut'
    cv = 'Finishes - Calacatta Viola'
    x0, x1 = 269.5, 293.5   # 24" deep run, flush to the East ("True North right") wall
    # 16'-0" flush run, broken into its real cabinet segments.
    box(k, x0, x1,  0.0,  36.0, Z_UFF, Z_UCEIL, 'Fridge - 36" Panel-Ready (Dark Walnut)', dw)
    box(k, x0, x1, 36.0, 156.0, Z_UFF, 154.5,   'Base Run - 10ft Counter (Dark Walnut)',  dw)
    box(k, x0, x1, 36.0, 156.0, 154.5, 156.0,   'Counter Top (Calacatta Viola)',          cv)
    box(k, x0, x1, 156.0, 192.0, Z_UFF, Z_UCEIL, 'Double Pantry - 36" (Dark Walnut)',     dw)
    box(k, 269.5, 287.5, 72.0, 120.0, 186.0, Z_UCEIL, 'Upper Cabinets (Dark Walnut)',     dw)
    # 48" hood over the cooktop run.
    box(k, x0, x1, 72.0, 120.0, 198.0, Z_UCEIL, 'Hood - 48" (Dark Walnut)', dw)

    # 11'-0" island, 48" deep, parallel to the run — Calacatta Viola waterfall.
    box(k, 173.5, 221.5, 30.0, 162.0, Z_UFF, 156.0, 'UP - Kitchen Island (11ft, waterfall)', cv)
  end

  # ----------------------------------------------------------------------------
  # 5b. PRIMARY BATH MILLWORK + ZONES
  # ----------------------------------------------------------------------------
  def build_bath_millwork
    b = subgroup(@g_mill, 'Primary Bath')
    dw = 'Finishes - Dark Walnut'
    cv = 'Finishes - Calacatta Viola'
    # Floating West-wall double vanity: Dark Walnut box + Calacatta top.
    box(b, 188.5, 213.5, 406.0, 486.0, 132.0, 152.0, 'PB - Double Vanity (Dark Walnut)', dw)
    box(b, 188.5, 213.5, 406.0, 486.0, 152.0, 156.0, 'PB - Vanity Top (Calacatta Viola)', cv)
    # South-East pre-cast shower enclosure with Calacatta surround.
    box(b, 247.0, 249.5, 354.0, 416.0, Z_UFF, 204.0, 'PB - Shower Glass Jamb (West)', 'Glass/Glazing')
    box(b, 289.0, 293.5, 354.0, 411.5, 124.0, Z_UCEIL, 'PB - Shower Surround (East, Calacatta)', cv)
    box(b, 249.5, 293.5, 354.0, 357.0, 126.0, 204.0,   'PB - Shower Surround (South, Calacatta)', cv)
    box(b, 247.0, 293.5, 354.0, 416.0, Z_UFF, 126.0,   'PB - Shower Pan (Calacatta)', cv)
    # North-East stacked utility / steam closet niche (Dark Walnut doors).
    box(b, 261.5, 293.5, 416.0, 488.0, Z_UFF, Z_UCEIL, 'PB - Utility / Steam Niche (Dark Walnut)', dw)
    # South-West water closet (open, partition-screened).
    box(b, 193.0, 211.0, 358.0, 380.0, Z_UFF, 138.0, 'PB - Water Closet (WC)', 'Interior Partitions')
  end

  # ----------------------------------------------------------------------------
  # 6. MEP  (plumbing / electrical placeholders at real diagnostics coords)
  # ----------------------------------------------------------------------------
  def build_mep
    plumb = subgroup(@g_mep, 'Plumbing')
    box(plumb, 127.0, 133.0, 348.0, 354.0, -2.0, 120.5, 'Sewer + Hot + Cold Stack (Red Wall)', 'MEP - Plumbing')
    box(plumb, 80.0,  84.0,  11.0, 592.0,  18.0,  58.0, 'Cold Water Main Run',  'MEP - Plumbing')
    box(plumb, 119.5, 123.5, 457.9, 588.5, 22.0, 103.5, 'Hot to Patio Bib',     'MEP - Plumbing')

    elec = subgroup(@g_mep, 'Electrical')
    box(elec, 83.0, 86.0, 20.0, 122.0, 36.0, 66.0, 'Main Sub Panel / Breakers / Solar TDS', 'MEP - Electrical')
    box(elec, 278.4, 279.6, 80.4, 81.6, 116.0, 150.0, 'Induction Cooktop 240V Feed', 'MEP - Electrical')
  end

  # ----------------------------------------------------------------------------
  # 7. GLAZING & DOORS
  # ----------------------------------------------------------------------------
  def build_glazing_and_doors
    gl = subgroup(@g_glaz, 'Glazing')
    gg = 'Glass/Glazing'
    # Box-bay front glazing (the cantilevered living-room window wall).
    panel(gl, 80.0, 291.0, -24.0, -22.5, Z_UFF + 6, Z_UCEIL - 6, 'Box Bay Glazing (front)', gg)
    # Front living-room window (street facade) + lower entry sidelite line.
    panel(gl, 22.0, 65.0, 1.5, 3.0, 150.0, 204.0, 'UP - Living Room Front Window', gg)
    # Rear bedroom windows.
    panel(gl, 47.0, 107.0, 657.0, 658.5, 150.0, 198.0, 'UP - Rear Window (Back-Left Bed)', gg)
    panel(gl, 192.8, 252.8, 657.0, 658.5, 150.0, 198.0, 'UP - Rear Window (Primary Bed)',   gg)
    # Lightwell slider (middle bedroom -> lightwell).
    panel(gl, 36.0, 108.0, 374.5, 376.0, Z_UFF, 200.0, 'UP - Lightwell Slider', gg)
    # Lower rear sliders.
    panel(gl, 38.8, 110.8, 583.0, 585.0, 1.0, 95.0, 'Slider - Family',  gg)
    panel(gl, 184.5, 256.5, 583.0, 585.0, 1.0, 95.0, 'Slider - Bedroom', gg)

    sky = subgroup(@g_glaz, 'Skylights')
    # Lightwell skylight (over the middle-bedroom lightwell).
    panel(sky, 6.5, 128.5, 377.5, 424.5, Z_UCEIL, Z_UCEIL + 2, 'Lightwell Skylight', gg)
    # Primary-bath 24"x24" ceiling skylight (centered over the room).
    panel(sky, 229.0, 253.0, 379.0, 403.0, Z_UCEIL, Z_UCEIL + 2, 'Primary Bath Skylight (24x24)', gg)

    dr = subgroup(@g_glaz, 'Doors')
    dtag = 'Doors'
    panel(dr, 21.5, 64.5, 61.0, 63.5, 0.5, 116.0, 'Pivot Front Door',  dtag)
    panel(dr, 90.0, 284.4, 0.7, 1.5, 1.0, 105.0, 'Garage Door Panel',  dtag)
    panel(dr, 79.85, 81.65, 160.0, 196.0, Z_LFF, 80.0, 'Door - Garage to Foyer', dtag)
    panel(dr, 185.35, 187.15, 305.0, 337.0, Z_LFF, 80.0, 'Door - Under-Stair',   dtag)
    panel(dr, 185.35, 187.15, 360.0, 392.0, Z_LFF, 80.0, 'Door - Guest Bath',    dtag)
    panel(dr, 150.0, 182.0, 445.4, 447.1, Z_LFF, 80.0, 'Door - Guest Bed',       dtag)
    panel(dr, 210.0, 282.0, 445.4, 447.1, Z_LFF, 80.0, 'Door - Closet (Double)', dtag)
  end

  # ----------------------------------------------------------------------------
  # ORCHESTRATION
  # ----------------------------------------------------------------------------
  def setup(model)
    @model = model
    @ents  = model.entities
    @tags  = {}
    @mats  = {}
    # Top-level Outliner hierarchy (exactly the five requested roots + glazing).
    @g_site  = subgroup_root('Site & Foundation')
    @g_lower = subgroup_root('Lower Level Structure')
    @g_upper = subgroup_root('Upper Level Structure')
    @g_mill  = subgroup_root('Millwork & Casework')
    @g_mep   = subgroup_root('MEP')
    @g_glaz  = subgroup_root('Glazing & Doors')
  end

  def subgroup_root(name)
    g = @ents.add_group
    g.name = name
    g
  end

  def finalize_and_save
    @model.active_view.zoom_extents rescue nil
    dir  = '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts'
    path = File.join(dir, 'colby_clean_rebuild.skp')
    if File.exist?(path)
      i = 2
      i += 1 while File.exist?(File.join(dir, "colby_clean_rebuild_#{i}.skp"))
      path = File.join(dir, "colby_clean_rebuild_#{i}.skp")
    end
    begin
      @model.save(path)
      UI.messagebox("✅ Clean rebuild complete.\nSaved a BRAND-NEW file:\n#{path}\n\nbase_colby was never touched.")
      puts "✅ Saved: #{path}"
    rescue => e
      UI.messagebox("Geometry built OK, but auto-save failed:\n#{e.message}\n\nUse File -> Save As to name it yourself.")
    end
  end

  def run
    model = Sketchup.active_model

    # ---- SAFETY GUARD: never run inside a populated model (e.g. base_colby) ----
    groups = model.entities.grep(Sketchup::Group).size +
             model.entities.grep(Sketchup::ComponentInstance).size
    faces  = model.entities.grep(Sketchup::Face).size
    if groups > 0 || faces > 0
      UI.messagebox(
        "ABORTED — this document is not empty (#{groups} groups/components, " \
        "#{faces} loose faces).\n\nThis builder only runs in a fresh model so it " \
        "can NEVER overwrite base_colby.\n\nDo File -> New, then re-run:\n" \
        "load '#{__FILE__}'"
      )
      return
    end

    model.start_operation('Build 126 Colby — Clean Rebuild', true)
    begin
      setup(model)
      setup_tags_and_materials
      build_site_and_foundation
      build_slabs
      build_lower_level
      build_upper_level
      build_stairwell
      build_kitchen_millwork
      build_bath_millwork
      build_mep
      build_glazing_and_doors
      model.commit_operation
      finalize_and_save
    rescue => e
      model.abort_operation
      UI.messagebox("Build FAILED and was rolled back (model untouched):\n" \
                    "#{e.message}\n\n#{e.backtrace.first(6).join("\n")}")
      puts "!! #{e.message}"
      puts e.backtrace.first(10).join("\n")
    end
  end
end

ColbyBuild.run
