# fix_stairwell_geometry.rb
# ---------------------------------------------------------------------------
# Geometric fixes for base_colby derived from sketchup_diagnostics.json
# (cross-checked by analyze_walls.py).
#
#   1. Re-slope "Foyer Red Wall (Sloped Pony Wall)" so its top runs 96"->120"
#      and never pokes above the 120" upper finished floor.
#   2. Delete the solid "UP - Dining / Stairs Pony Wall" that buries the
#      stairwell opening, and rebuild it as an L of perimeter guard rails
#      (North + West edges only) leaving the stair footprint open.
#   3. Keep the middle-bedroom (Bed6) closet return, delete the rogue
#      30" return floating in the front kitchen/living open space.
#   4. Rebuild the RIGHT exterior as a uniform 6.5" wall (inner face x=293.5,
#      outer x=300) so it meets the interior build line. Height-NEUTRAL: each
#      segment keeps its existing y-span and z-height. Closes the 2.5"-5.4"
#      void and the 2.86" lower/upper jog. (analyze_walls.py: thickness +
#      gap-to-interior flags.)
#   5. Replace the MISSING foyer/garage wall: extend the Foyer/Garage Divider
#      line from y=228.35 (where it dangles) to y=297.68 (the Red Wall), at
#      x 78.5-83, z 0-116. (analyze_walls.py: dangling-end flag.)
#   6. Heal the RED-WALL sever: the wall was once continuous along y~300; a
#      messy cut left a 9.31" gap (x 184.19->193.5), a 0.32" face offset, and a
#      4.82" vs 4.5" thickness mismatch. Rebuild the Hallway 108 piece as one
#      clean wall that butts the divider at x=193.5 (gap closed), at the standard
#      4.5" thickness (front face y=298.0), full height z 0-116.
#
# Run from SketchUp's Ruby Console:
#   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/fix_stairwell_geometry.rb'
#
# All edits are wrapped in a single undoable operation (Cmd-Z reverts everything).
# All coordinates below are GLOBAL inches, straight from the diagnostics export.
# ---------------------------------------------------------------------------
require 'sketchup.rb'

module ColbyFixes
  # ===== TUNABLE ASSUMPTIONS — flip these if the markup says otherwise =====

  # Fix 1: which end of the pony wall is the LOW (96") end of the slope.
  # true  -> 96" at the West end (min X = 193.5), rising to 120" at East (253.5)
  # false -> 96" at the East end, rising to 120" at the West end
  PONY_LOW_END_WEST = true

  # Fix 1: keep the wall full-height from the lower floor (z = 0) up to the
  # sloped top. The diagnostics show the original started at z = 0.
  PONY_BOTTOM_Z = 0.0

  # Fix 2: which two edges of the stair opening get a guard rail.
  RAIL_NORTH = true   # y = oy0 (256.5) edge, spans full opening in X
  RAIL_WEST  = true   # x = ox0 (180.6) edge, spans full opening in Y
  RAIL_THICKNESS = 4.5

  # Fix 3: remove the rogue closet return floating up front near the kitchen.
  DELETE_FRONT_CLOSET_RETURN = true

  # ========================================================================

  module_function

  def container_entities(node)
    case node
    when Sketchup::Model             then node.entities
    when Sketchup::Group             then node.entities
    when Sketchup::ComponentInstance then node.definition.entities
    end
  end

  def container?(e)
    e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
  end

  # Resolve "A > B > C" to the leaf group plus the parent entities collection
  # and the parent's accumulated global transform.
  def find_by_path(model, path)
    names = path.split(' > ').map(&:strip)
    node = model
    acc  = Geom::Transformation.new
    parent_ents = model.entities
    parent_tr   = acc
    leaf = nil
    names.each do |nm|
      ents = container_entities(node)
      child = ents.to_a.find { |e| container?(e) && e.name == nm }
      return nil unless child
      parent_ents = ents
      parent_tr   = acc
      leaf = child
      acc  = acc * child.transformation
      node = child
    end
    { group: leaf, parent_ents: parent_ents, parent_tr: parent_tr, global_tr: acc }
  end

  # Walk the whole tree, yielding (container, parent_entities, parent_global_tr).
  def walk(node, acc, &blk)
    ents = container_entities(node)
    return unless ents
    ents.to_a.each do |e|
      next unless container?(e)
      blk.call(e, ents, acc)
      walk(e, acc * e.transformation, &blk)
    end
  end

  def find_all_by_name(model, name)
    res = []
    walk(model, Geom::Transformation.new) do |g, pents, ptr|
      res << { group: g, parent_ents: pents, parent_tr: ptr } if g.name == name
    end
    res
  end

  # Add an axis-aligned box (global inches) into parent_ents (parent global tr).
  def add_box(parent_ents, parent_tr, x0, x1, y0, y1, z0, z1, name)
    g = parent_ents.add_group
    g.name = name
    inv = parent_tr.inverse
    base = [
      Geom::Point3d.new(x0, y0, z0),
      Geom::Point3d.new(x1, y0, z0),
      Geom::Point3d.new(x1, y1, z0),
      Geom::Point3d.new(x0, y1, z0)
    ].map { |p| p.transform(inv) }
    face = g.entities.add_face(base)
    dir  = face.normal.transform(parent_tr).dot(Z_AXIS) >= 0 ? 1.0 : -1.0
    face.pushpull((z1 - z0) * dir)
    g
  end

  # Capture a group's paint so a rebuild can re-apply it. Without this, every
  # erase+rebuild comes back as default-white geometry (the "deleted red wall").
  def grab_material(group)
    return group.material if group.material
    group.entities.grep(Sketchup::Face).each do |f|
      return f.material if f.material
    end
    nil
  end

  # Paint every face in a freshly built group with the captured material.
  def repaint(group, mat)
    return unless mat
    group.material = mat
    group.entities.grep(Sketchup::Face).each { |f| f.material = mat }
  end

  # -------------------------------------------------------------------------
  def fix1_slope_pony_wall(model)
    hit = find_by_path(model, 'Master Structure > Foyer Red Wall (Sloped Pony Wall)')
    raise 'Fix 1: "Foyer Red Wall (Sloped Pony Wall)" not found' unless hit

    parent_ents = hit[:parent_ents]
    parent_tr   = hit[:parent_tr]
    mat = grab_material(hit[:group])      # keep the red paint
    layer = hit[:group].layer
    hit[:group].erase!

    x0, x1 = 193.5, 253.5
    y0, y1 = 298.0, 302.5
    z_lo, z_hi = 96.0, 120.0
    z_at_x0 = PONY_LOW_END_WEST ? z_lo : z_hi
    z_at_x1 = PONY_LOW_END_WEST ? z_hi : z_lo

    g = parent_ents.add_group
    g.name = 'Foyer Red Wall (Sloped Pony Wall)'
    g.layer = layer if layer
    inv = parent_tr.inverse

    # Trapezoid in the X-Z plane at y0: flat bottom, sloped top, then extrude to y1.
    profile = [
      Geom::Point3d.new(x0, y0, PONY_BOTTOM_Z),
      Geom::Point3d.new(x1, y0, PONY_BOTTOM_Z),
      Geom::Point3d.new(x1, y0, z_at_x1),
      Geom::Point3d.new(x0, y0, z_at_x0)
    ].map { |p| p.transform(inv) }
    face = g.entities.add_face(profile)
    dir  = face.normal.transform(parent_tr).dot(Y_AXIS) >= 0 ? 1.0 : -1.0
    face.pushpull((y1 - y0) * dir)
    repaint(g, mat)

    puts "Fix 1: rebuilt sloped pony wall  top #{z_at_x0.to_i}\"(W) -> #{z_at_x1.to_i}\"(E), capped at 120\" (paint kept)."
  end

  # -------------------------------------------------------------------------
  def fix2_clear_stairwell(model)
    hit = find_by_path(model, 'Upper Level Structure > UP - Dining / Stairs Pony Wall')
    raise 'Fix 2: "UP - Dining / Stairs Pony Wall" not found' unless hit

    parent_ents = hit[:parent_ents]
    parent_tr   = hit[:parent_tr]
    mat = grab_material(hit[:group])      # reuse the pony slab's paint on the rails
    hit[:group].erase!

    # Stair opening footprint (matches the slab we just removed) and rail height.
    ox0, ox1 = 180.6, 293.5
    oy0, oy1 = 256.5, 302.5
    z0,  z1  = 120.0, 162.0
    t = RAIL_THICKNESS

    if RAIL_NORTH
      r = add_box(parent_ents, parent_tr, ox0, ox1, oy0, oy0 + t, z0, z1,
                  'UP - Stair Rail (North)')
      repaint(r, mat)
      puts 'Fix 2: added North guard rail.'
    end
    if RAIL_WEST
      r = add_box(parent_ents, parent_tr, ox0, ox0 + t, oy0, oy1, z0, z1,
                  'UP - Stair Rail (West)')
      repaint(r, mat)
      puts 'Fix 2: added West guard rail.'
    end
    puts 'Fix 2: stair footprint cleared (slab deleted, perimeter rails only).'
  end

  # -------------------------------------------------------------------------
  def fix3_closet_returns(model)
    returns = find_all_by_name(model, 'UP - Closet Return')
    if returns.empty?
      puts 'Fix 3: no "UP - Closet Return" groups found — nothing to do.'
      return
    end

    returns.each do |h|
      c = h[:group].bounds.center.transform(h[:parent_tr])
      if c.y < 100.0
        # Rogue return up front (diagnostics: y 4.5-34.5) near the kitchen/box bay.
        if DELETE_FRONT_CLOSET_RETURN
          h[:group].erase!
          puts format('Fix 3: deleted rogue front closet return @ y~%.0f".', c.y)
        else
          puts format('Fix 3: KEPT front closet return @ y~%.0f" (flag off).', c.y)
        end
      else
        # Middle-bedroom (Bed6) closet return — already anchors the SE corner
        # (x 90-94.5 = closet east wall, y 191-221, full height 120-216).
        puts format('Fix 3: verified Bed6 closet return @ y~%.0f" (SE corner, full height) — left in place.', c.y)
      end
    end
  end

  # -------------------------------------------------------------------------
  # Fix 4: right exterior shell -> uniform 6.5" wall, inner face flush at x=293.5.
  # Height-neutral: rebuild each existing segment with its OWN y-span and z-range.
  def fix4_right_exterior_thickness(model)
    targets = [
      'Master Structure > Right Exterior (Lower)',
      'Master Structure > Right Exterior (2-Story Core)'
    ]
    x_inner, x_outer = 293.5, 300.0
    targets.each do |path|
      hit = find_by_path(model, path)
      unless hit
        puts "Fix 4: '#{path.split('> ').last}' not found — skipped."
        next
      end
      g = hit[:group]
      bb = g.bounds
      gmin = hit[:parent_tr] * bb.min
      gmax = hit[:parent_tr] * bb.max
      y0, y1 = gmin.y, gmax.y
      z0, z1 = gmin.z, gmax.z
      layer = g.layer
      name  = g.name
      mat   = grab_material(g)
      g.erase!
      nw = add_box(hit[:parent_ents], hit[:parent_tr], x_inner, x_outer, y0, y1, z0, z1, name)
      nw.layer = layer if layer
      repaint(nw, mat)
      puts format('Fix 4: rebuilt %-26s 6.5" thick (x %.1f-%.1f, y %.1f-%.1f, z %.0f-%.0f).',
                  name, x_inner, x_outer, y0, y1, z0, z1)
    end
  end

  # -------------------------------------------------------------------------
  # Fix 5: replace the missing foyer/garage wall. The Foyer/Garage Divider line
  # dangles at y=228.35; extend it to the Red Wall at y=297.68 (x 78.5-83, z 0-116).
  def fix5_garage_wall_return(model)
    anchor = find_by_path(model, 'Master Structure > Foyer / Garage Divider (Main)')
    raise 'Fix 5: "Foyer / Garage Divider (Main)" not found' unless anchor

    x0, x1 = 78.5, 83.0       # matches the existing divider (4.5" thick)
    y0, y1 = 228.35, 297.68   # from divider dangling end to the Red Wall face
    z0, z1 = 0.0, 116.0       # matches the divider height

    # guard against re-running: skip if a wall already occupies this gap
    exists = find_all_by_name(model, 'Foyer / Garage Divider (Return to Red Wall)')
    if exists.any?
      puts 'Fix 5: return wall already present — skipped.'
      return
    end
    g = add_box(anchor[:parent_ents], anchor[:parent_tr], x0, x1, y0, y1, z0, z1,
                'Foyer / Garage Divider (Return to Red Wall)')
    g.layer = anchor[:group].layer if anchor[:group].layer
    repaint(g, grab_material(anchor[:group]))   # match the divider it continues
    puts format('Fix 5: added garage wall return (x %.1f-%.1f, y %.1f-%.1f, z %.0f-%.0f, %.1f" long).',
                x0, x1, y0, y1, z0, z1, y1 - y0)
  end

  # -------------------------------------------------------------------------
  # Fix 6: heal the red-wall sever. Rebuild the Hallway 108 piece as one clean
  # wall that butts the (resloped) pony divider at x=193.5 — closing the 9.31"
  # gap, normalizing 4.82"->4.5" thickness, and aligning the front face to 298.0.
  # Seam at x=193.5: hallway stays full-height (116); the divider slope (Fix 1)
  # begins there at its low end. Change x1/z1 here if the seam should differ.
  def fix6_heal_red_wall_sever(model)
    hit = find_by_path(model, 'Master Structure > Foyer Red Wall (Hallway 108)')
    raise 'Fix 6: "Foyer Red Wall (Hallway 108)" not found' unless hit

    layer = hit[:group].layer
    parent_ents = hit[:parent_ents]
    parent_tr   = hit[:parent_tr]
    mat = grab_material(hit[:group])      # keep the red paint
    hit[:group].erase!

    x0, x1 = 78.5, 193.5      # extend east to butt the divider, closing the gap
    y0, y1 = 298.0, 302.5     # standard 4.5" thick, front face aligned to divider
    z0, z1 = 0.0, 116.0       # full lower-level height (was 115.56)

    g = add_box(parent_ents, parent_tr, x0, x1, y0, y1, z0, z1,
                'Foyer Red Wall (Hallway 108)')
    g.layer = layer if layer
    repaint(g, mat)
    puts format('Fix 6: healed red-wall sever — Hallway piece x %.1f-%.1f, 4.5" @ '\
                'y %.1f-%.1f, butts divider at x=%.1f (9.31" gap closed).',
                x0, x1, y0, y1, x1)
  end

  # -------------------------------------------------------------------------
  Y_AXIS = Geom::Vector3d.new(0, 1, 0)
  Z_AXIS = Geom::Vector3d.new(0, 0, 1)

  def run
    model = Sketchup.active_model
    model.start_operation('Colby Stairwell Geometry Fixes', true)
    begin
      fix1_slope_pony_wall(model)
      fix2_clear_stairwell(model)
      fix3_closet_returns(model)
      fix4_right_exterior_thickness(model)
      fix5_garage_wall_return(model)
      fix6_heal_red_wall_sever(model)
      model.commit_operation
      puts '== All fixes committed. Cmd-Z to revert everything. =='
    rescue => e
      model.abort_operation
      puts "!! Rolled back — #{e.message}"
      puts e.backtrace.first(5).join("\n")
    end
  end
end

ColbyFixes.run
