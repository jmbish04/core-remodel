# frozen_string_literal: true
# =============================================================================
# build_layouts.rb — 126 Colby upper-floor LAYOUT COMPILER (strict schema)
# -----------------------------------------------------------------------------
# Reads a JSON file in which an AI model has fully specified one or more floor-plan
# layouts. EVERY layout must define EVERY required piece (cabinets, island, all
# appliances, dining table, living seating, rug, TV, island pendants) with exact
# inch coordinates. The script validates each layout, then builds it to scale in
# SketchUp on its own toggleable tag, and screenshots each.
#
# RUN (in SketchUp with base_colby.skp open — the fixed architectural shell):
#   Window ▸ Ruby Console:
#     $colby_layouts_json = '/abs/path/to/layouts.json'    # optional override
#     load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/layout-engine/build_layouts.rb'
#
# BROWSE:
#     ColbyLayouts.list            # ids + names + validation status
#     ColbyLayouts.show('L03')     # show only L03
#     ColbyLayouts.shoot('L03')    # re-screenshot one
#
# The script NEVER edits the architectural shell. It only adds furniture/cabinet
# massing under "Layout: <id>" tags, and clears its own prior output each run.
# =============================================================================

require 'json'
require 'fileutils'

module ColbyLayouts
  FZ        = 120.6   # finished floor top (Z)
  CEIL      = 216.6   # ceiling
  COUNTER_H = 36.0
  TALL_H    = 90.0

  DEFAULT_JSON = File.join(File.dirname(__FILE__), 'layouts.example.json')
  DEFAULT_OUT  = '/Volumes/Projects/workers/core-remodel/proofs/tight/sketchup-screenshots/layout-studies'

  PALETTE = {
    'walnut' => [104, 66, 45, 1.0], 'calacatta' => [238, 235, 232, 1.0],
    'dekton' => [214, 212, 206, 1.0], 'oak' => [171, 138, 96, 1.0],
    'fabric' => [150, 142, 130, 1.0], 'rug' => [120, 110, 100, 1.0],
    'black' => [24, 24, 26, 1.0], 'steel' => [170, 172, 176, 1.0],
    'brass' => [150, 116, 60, 1.0], 'glass' => [176, 206, 228, 0.45],
    'white' => [242, 241, 238, 1.0], 'dark' => [44, 44, 48, 1.0],
    'green' => [54, 74, 60, 1.0]
  }.freeze

  CAMERAS = [
    { tag: 'hero', eye: [282, 255, 182], tgt: [120, 95, 138], fov: 75 },
    { tag: 'bay',  eye: [200, -16, 174], tgt: [170, 200, 140], fov: 78 },
    { tag: 'wall', eye: [16, 132, 178],  tgt: [220, 120, 148], fov: 74 },
    { tag: 'plan', plan: true, height: 320 }
  ].freeze

  # --- REQUIRED schema: section => { field => kind } -------------------------
  BOX   = %w[x0 y0 x1 y1]                       # a footprint
  SPEC = {
    'kitchen' => {
      'cabinets'   => [:array, BOX],            # >=1 base-cabinet runs
      'island'     => [:box,   BOX],
      'pantry'     => [:box,   BOX],
      'fridge'     => [:box,   BOX],
      'cooktop'    => [:box,   BOX],
      'oven'       => [:box,   BOX],
      'hood'       => [:box,   BOX],
      'sink'       => [:box,   BOX],
      'dishwasher' => [:box,   BOX]
    },
    'dining'  => { 'table'   => [:obj, %w[cx cy w l seats]] },
    'living'  => {
      'seating'      => [:obj, %w[kind x0 y0 x1 y1 facing]],
      'rug'          => [:box, BOX],
      'coffee_table' => [:box, BOX],
      'tv'           => [:obj, %w[wall]]        # plus cx or cy (checked separately)
    },
    'lighting' => { 'island_pendants' => [:obj, %w[cx cy count]] }
  }.freeze

  module_function

  # ---------------------------------------------------------------------------
  def build_all(json_path = nil)
    json_path ||= ($colby_layouts_json if defined?($colby_layouts_json)) || DEFAULT_JSON
    return puts("[layouts] JSON not found: #{json_path}") unless File.exist?(json_path)
    data = JSON.parse(File.read(json_path))
    layouts = data['layouts'] || data
    m = Sketchup.active_model
    ensure_materials(m)
    @index = {}
    @errors = {}
    m.start_operation('build layouts', true)
    clear_all(m)
    layouts.each_with_index do |lay, i|
      id = (lay['id'] || "L#{format('%02d', i + 1)}").to_s
      problems = validate(lay)
      @errors[id] = problems
      if problems.empty?
        build_layout(m, id, lay)
      else
        puts "[layouts] #{id} REJECTED — missing/invalid: #{problems.join('; ')}"
      end
      @index[id] = lay
    end
    m.commit_operation
    ok = @index.keys.select { |k| @errors[k].empty? }
    puts "[layouts] built #{ok.size}/#{@index.size}: #{ok.join(', ')}"
    ok.each { |id| shoot(id) }
    puts "[layouts] screenshots under #{out_dir}"
    puts "[layouts] browse: ColbyLayouts.show('#{ok.first}')" unless ok.empty?
    ok
  end

  # --- validation: returns [] if the layout fully satisfies the schema -------
  def validate(lay)
    bad = []
    SPEC.each do |section, fields|
      sec = lay[section]
      next bad << "#{section} (section missing)" unless sec.is_a?(Hash)
      fields.each do |field, (kind, keys)|
        v = sec[field]
        case kind
        when :array
          if !v.is_a?(Array) || v.empty?
            bad << "#{section}.#{field} (need a non-empty array)"
          else
            v.each_with_index { |o, i| missing_keys(o, keys).each { |k| bad << "#{section}.#{field}[#{i}].#{k}" } }
          end
        else
          if !v.is_a?(Hash)
            bad << "#{section}.#{field} (missing)"
          else
            missing_keys(v, keys).each { |k| bad << "#{section}.#{field}.#{k}" }
          end
        end
      end
    end
    # tv needs cx or cy
    tv = lay.dig('living', 'tv')
    bad << 'living.tv.cx|cy (need one)' if tv.is_a?(Hash) && tv['cx'].nil? && tv['cy'].nil?
    bad
  end

  def missing_keys(obj, keys)
    return keys unless obj.is_a?(Hash)
    keys.reject { |k| obj.key?(k) && !obj[k].nil? }
  end

  # ---------------------------------------------------------------------------
  def build_layout(m, id, lay)
    tag = m.layers["Layout: #{id}"] || m.layers.add("Layout: #{id}")
    parent = m.active_entities.add_group
    parent.name = "LAYOUT #{id} — #{lay['name']}"
    parent.layer = tag
    e = parent.entities
    k = lay['kitchen']; d = lay['dining']; lv = lay['living']; lt = lay['lighting']

    k['cabinets'].each_with_index { |c, i| counter(e, c, "cabinets[#{i}]") }
    island(e, k['island'])
    tall(e, k['pantry'], 'walnut', 'pantry')
    tall(e, k['fridge'], 'steel',  'fridge')
    appliance(e, k['cooktop'], 'cooktop')
    appliance(e, k['oven'], 'oven')
    appliance(e, k['hood'], 'hood')
    appliance(e, k['sink'], 'sink')
    appliance(e, k['dishwasher'], 'dishwasher')

    table(e, d['table'])
    seating(e, lv['seating'])
    rug(e, lv['rug'])
    box(e, lv['coffee_table'], FZ, FZ + 16, 'oak', 'coffee table')
    tv(e, lv['tv'])
    pendant(e, lt['island_pendants'])

    # optional creative extras: array of generic boxes
    (lay['extras'] || []).each { |x| box(e, x, x['z0'] || FZ, x['z1'] || (FZ + (x['height'] || 36)), x['material'] || 'walnut', x['name']) }
    tag
  end

  # --- primitive builders ----------------------------------------------------
  def block(e, x0, y0, z0, x1, y1, z1, matname, name = nil)
    g = e.add_group; g.name = name if name
    x0, x1 = x1, x0 if x0 > x1
    y0, y1 = y1, y0 if y0 > y1
    f = g.entities.add_face([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0])
    f.reverse! if f.normal.z < 0
    f.pushpull(z1 - z0)
    mat = material(matname)
    g.entities.grep(Sketchup::Face).each { |fc| fc.material = mat; fc.back_material = mat }
    g
  end

  def box(e, o, z0, z1, mat, name)
    block(e, o['x0'], o['y0'], z0, o['x1'], o['y1'], z1, mat, name)
  end

  def counter(e, c, name)
    h = (c['height'] || COUNTER_H).to_f
    top = FZ + h
    block(e, c['x0'], c['y0'], FZ, c['x1'], c['y1'], top - 1.5, c['material_base'] || 'walnut', name)
    block(e, c['x0'], c['y0'], top - 1.5, c['x1'], c['y1'], top, c['material'] || 'dekton', "#{name} top")
    if c['backsplash']
      wall = (c['wall'] || 'W').to_s
      sx0, sy0, sx1, sy1 = case wall
                           when 'W' then [c['x0'], c['y0'], c['x0'] + 1.5, c['y1']]
                           when 'E' then [c['x1'] - 1.5, c['y0'], c['x1'], c['y1']]
                           when 'N' then [c['x0'], c['y0'], c['x1'], c['y0'] + 1.5]
                           else          [c['x0'], c['y1'] - 1.5, c['x1'], c['y1']]
                           end
      block(e, sx0, sy0, top, sx1, sy1, top + 18, c['material'] || 'dekton', "#{name} splash")
    end
  end

  def island(e, o)
    block(e, o['x0'], o['y0'], FZ, o['x1'], o['y1'], FZ + (o['height'] || COUNTER_H), o['material'] || 'calacatta', 'island')
  end

  def tall(e, o, mat, name)
    block(e, o['x0'], o['y0'], FZ, o['x1'], o['y1'], FZ + (o['height'] || TALL_H), mat, name)
  end

  def appliance(e, o, kind)
    case kind
    when 'cooktop'    then block(e, o['x0'], o['y0'], FZ + COUNTER_H, o['x1'], o['y1'], FZ + COUNTER_H + 1, 'dark', 'cooktop')
    when 'oven'       then block(e, o['x0'], o['y0'], FZ + 6, o['x1'], o['y1'], FZ + 54, 'dark', 'oven')
    when 'hood'       then block(e, o['x0'], o['y0'], FZ + 60, o['x1'], o['y1'], FZ + 90, 'dark', 'hood')
    when 'sink'       then block(e, o['x0'], o['y0'], FZ + COUNTER_H - 9, o['x1'], o['y1'], FZ + COUNTER_H - 1, 'steel', 'sink')
    when 'dishwasher' then block(e, o['x0'], o['y0'], FZ, o['x1'], o['y1'], FZ + COUNTER_H - 1, 'steel', 'dishwasher')
    else                   block(e, o['x0'], o['y0'], FZ, o['x1'], o['y1'], FZ + COUNTER_H, 'dark', kind)
    end
  end

  def table(e, t)
    cx = t['cx']; cy = t['cy']; w = t['w'].to_f; l = t['l'].to_f; tz = FZ + 30
    block(e, cx - w / 2, cy - l / 2, tz - 1.5, cx + w / 2, cy + l / 2, tz, t['material'] || 'oak', 'dining table')
    block(e, cx - w / 2 + 3, cy - l / 2 + 3, FZ, cx + w / 2 - 3, cy + l / 2 - 3, tz - 1.5, t['material'] || 'oak', 'table base')
    return if t['chairs'] == false
    per = [(t['seats'].to_i / 2.0).ceil, 1].max
    gap = l / per
    per.times do |i|
      yc = cy - l / 2 + gap * (i + 0.5)
      block(e, cx - w / 2 - 20, yc - 8, FZ, cx - w / 2 - 4, yc + 8, FZ + 18, 'black', 'chair')
      block(e, cx + w / 2 + 4, yc - 8, FZ, cx + w / 2 + 20, yc + 8, FZ + 18, 'black', 'chair')
    end
  end

  def seating(e, s)
    x0 = s['x0']; y0 = s['y0']; x1 = s['x1']; y1 = s['y1']; f = (s['facing'] || 'N').to_s
    seat = FZ + 16; back = FZ + 30; arm = FZ + 24; mat = 'fabric'
    block(e, x0, y0, FZ, x1, y1, seat, mat, s['kind'] || 'sofa')
    case f
    when 'N' then block(e, x0, y1 - 6, seat, x1, y1, back, mat); block(e, x0, y0, seat, x0 + 6, y1, arm, mat); block(e, x1 - 6, y0, seat, x1, y1, arm, mat)
    when 'S' then block(e, x0, y0, seat, x1, y0 + 6, back, mat); block(e, x0, y0, seat, x0 + 6, y1, arm, mat); block(e, x1 - 6, y0, seat, x1, y1, arm, mat)
    when 'E' then block(e, x0, y0, seat, x0 + 6, y1, back, mat); block(e, x0, y0, seat, x1, y0 + 6, arm, mat); block(e, x0, y1 - 6, seat, x1, y1, arm, mat)
    else          block(e, x1 - 6, y0, seat, x1, y1, back, mat); block(e, x0, y0, seat, x1, y0 + 6, arm, mat); block(e, x0, y1 - 6, seat, x1, y1, arm, mat)
    end
    # sectional: add the chaise-side back when kind == sectional + corner given
    if (s['kind'].to_s == 'sectional') && s['corner']
      if s['corner'].to_s =~ /N/ then block(e, x0, y1 - 6, seat, x1, y1, back, mat)
      else                            block(e, x0, y0, seat, x1, y0 + 6, back, mat) end
    end
  end

  def rug(e, o)
    z = FZ + 0.2
    block(e, o['x0'], o['y0'], z, o['x1'], o['y1'], z + 0.3, o['material'] || 'rug', 'rug')
  end

  def tv(e, o)
    wall = (o['wall'] || 'E').to_s; cz = FZ + 56
    case wall
    when 'E' then x = 292.0; block(e, x - 2, o['cy'] - 26, cz - 15, x, o['cy'] + 26, cz + 15, 'black', 'tv')
    when 'W' then x = 8.0;   block(e, x, o['cy'] - 26, cz - 15, x + 2, o['cy'] + 26, cz + 15, 'black', 'tv')
    when 'N' then y = 8.0;   block(e, o['cx'] - 26, y, cz - 15, o['cx'] + 26, y + 2, cz + 15, 'black', 'tv')
    else          y = 260.0; block(e, o['cx'] - 26, y - 2, cz - 15, o['cx'] + 26, y, cz + 15, 'black', 'tv')
    end
  end

  def pendant(e, o)
    cx = o['cx']; cy = o['cy']; n = (o['count'] || 2).to_i; sp = (o['spacing'] || 30).to_f
    ns = (o['axis'] || 'NS').to_s == 'NS'
    n.times do |i|
      off = (i - (n - 1) / 2.0) * sp
      px = ns ? cx : cx + off
      py = ns ? cy + off : cy
      block(e, px - 5, py - 5, CEIL - 24, px + 5, py + 5, CEIL, 'black', 'pendant')
    end
  end

  # --- materials / tags / screenshots ---------------------------------------
  def material(name)
    m = Sketchup.active_model
    key = (name || 'walnut').to_s
    rgba = PALETTE[key] || PALETTE['walnut']
    mat = m.materials["LE-#{key}"] || m.materials.add("LE-#{key}")
    mat.color = Sketchup::Color.new(rgba[0], rgba[1], rgba[2]); mat.alpha = rgba[3]
    mat
  end

  def ensure_materials(m)
    PALETTE.each_key { |k| material(k) }
  end

  def clear_all(m)
    m.entities.grep(Sketchup::Group).each { |g| g.erase! if g.valid? && g.name.to_s =~ /^LAYOUT / }
    m.layers.each { |l| (m.layers.remove(l) rescue nil) if l.name =~ /^Layout: / }
  end

  def out_dir
    ($colby_layouts_out if defined?($colby_layouts_out)) || DEFAULT_OUT
  end

  def show(id)
    Sketchup.active_model.layers.each { |l| l.visible = (l.name == "Layout: #{id}") if l.name =~ /^Layout: / }
    id
  end

  def show_all
    Sketchup.active_model.layers.each { |l| l.visible = true if l.name =~ /^Layout: / }
  end

  def list
    (@index || {}).each { |id, lay| puts "  #{id}  #{(@errors[id] || []).empty? ? 'OK ' : 'BAD'}  #{lay['name']}" }
    nil
  end

  def shoot(id)
    m = Sketchup.active_model
    ro = m.rendering_options
    ro['RenderMode'] = 3 rescue nil
    ro['DisplayColorByLayer'] = false rescue nil
    m.shadow_info['DisplayShadows'] = false rescue nil
    m.layers['Roof'].visible = false if m.layers['Roof']
    show(id)
    dir = File.join(out_dir, id); FileUtils.mkdir_p(dir)
    view = m.active_view
    CAMERAS.each do |c|
      if c[:plan]
        cam = Sketchup::Camera.new([150, 135, 640], [150, 135, FZ], [0, 1, 0]); cam.perspective = false; cam.height = c[:height]
      else
        cam = Sketchup::Camera.new(c[:eye], c[:tgt], [0, 0, 1]); cam.perspective = true; cam.fov = c[:fov]
      end
      view.camera = cam
      view.write_image(File.join(dir, "#{id}_#{c[:tag]}.png"), 1600, 1000, true)
    end
    id
  end
end

# Auto-build on load unless: $colby_layouts_noautorun = true
ColbyLayouts.build_all unless defined?($colby_layouts_noautorun) && $colby_layouts_noautorun
