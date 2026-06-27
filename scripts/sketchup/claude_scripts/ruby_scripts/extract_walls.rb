# extract_walls.rb
# ---------------------------------------------------------------------------
# Dumps every Group / ComponentInstance in the active model to JSON with its
# GLOBAL (world-space) bounding box — the snapshot that analyze_walls.py reads.
#
# This is "the Ruby extractor". Output matches sketchup_diagnostics.json:
#   { model_name, export_time, objects: [ { type, path, tag, visible,
#       dimensions:{width_x,depth_y,height_z}, x_bounds, y_bounds, z_bounds } ] }
#
# Run from SketchUp's Ruby Console:
#   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/extract_walls.rb'
#
# Units are inches (SketchUp internal). Writes to ../sketchup_diagnostics.json.
# ---------------------------------------------------------------------------
require 'json'

module ColbyExtract
  # Write to the parent claude_scripts/ dir where analyze_walls.py reads it.
  OUT = File.expand_path('/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/sketchup_diagnostics.json', __dir__)

  module_function

  def container?(e)
    e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
  end

  def child_entities(e)
    e.is_a?(Sketchup::ComponentInstance) ? e.definition.entities : e.entities
  end

  # World bounds of `ent` given the accumulated transform of its PARENT space.
  def world_bounds(ent, parent_tr)
    local = ent.bounds                      # already in parent space
    wb = Geom::BoundingBox.new
    8.times { |i| wb.add(parent_tr * local.corner(i)) }
    wb
  end

  def round2(v)
    (v * 100.0).round / 100.0
  end

  def emit(ent, path, parent_tr, objects)
    wb = world_bounds(ent, parent_tr)
    mn, mx = wb.min, wb.max
    objects << {
      type:    ent.is_a?(Sketchup::Group) ? 'Group' : 'Component',
      path:    path,
      tag:     (ent.layer ? ent.layer.name : 'Layer0'),
      visible: ent.visible?,
      dimensions: {
        width_x:  round2(mx.x - mn.x),
        depth_y:  round2(mx.y - mn.y),
        height_z: round2(mx.z - mn.z)
      },
      z_bounds: { min: round2(mn.z), max: round2(mx.z) },
      x_bounds: { min: round2(mn.x), max: round2(mx.x) },
      y_bounds: { min: round2(mn.y), max: round2(mx.y) }
    }
  end

  def walk(ents, parent_tr, prefix, objects)
    ents.each do |e|
      next unless container?(e)
      nm = e.name
      nm = e.definition.name if (nm.nil? || nm.empty?) && e.is_a?(Sketchup::ComponentInstance)
      nm = 'Unnamed Group' if nm.nil? || nm.empty?
      path = prefix.empty? ? nm : "#{prefix} > #{nm}"
      emit(e, path, parent_tr, objects)
      walk(child_entities(e), parent_tr * e.transformation, path, objects)
    end
  end

  def run
    model = Sketchup.active_model
    return UI.messagebox('No active model.') unless model
    objects = []
    walk(model.entities, Geom::Transformation.new, '', objects)
    payload = {
      model_name:  (model.title.empty? ? 'untitled' : model.title),
      export_time: Time.now.to_s,
      objects:     objects
    }
    File.open(OUT, 'w') { |f| f.write(JSON.pretty_generate(payload)) }
    msg = "Extracted #{objects.length} objects -> #{OUT}"
    puts msg
    msg
  end
end

ColbyExtract.run
