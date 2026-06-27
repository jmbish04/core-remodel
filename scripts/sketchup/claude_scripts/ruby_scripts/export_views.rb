# export_views.rb
# ---------------------------------------------------------------------------
# Captures kitchen viewpoints from base_colby to PNG files that Claude can read,
# and reports the island's current material + the model's material list. This is
# the "screenshot" channel: you load this, it writes images to ../exports/,
# Claude reads them and iterates camera/material.
#
# Run in SketchUp's Ruby Console:
#   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/ruby_scripts/export_views.rb'
#
# Output: ../exports/kitchen_*.png  and  ../exports/_report.txt
# ---------------------------------------------------------------------------
require 'sketchup.rb'
require 'fileutils'

module ColbyViews
  OUT = File.expand_path('../exports', __dir__)
  W, H = 1600, 1000

  # [ name, eye, target ]  (up is +Z). Perspective, fov 50. Tune after first look.
  VIEWS = [
    ['kitchen_toward_windows', [205, 380, 176], [205,  40, 144]],
    ['kitchen_3q_left',        [ 70, 320, 188], [240,  70, 150]],
    ['kitchen_3q_right',       [330, 320, 192], [215,  70, 150]]
  ].freeze

  ISLAND = 'UP - Kitchen Island (11ft, waterfall)'

  module_function

  # recursive find by exact group name; returns the group or nil
  def find_group(ents, name)
    ents.each do |e|
      next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
      return e if e.respond_to?(:name) && e.name == name
      sub = e.is_a?(Sketchup::ComponentInstance) ? e.definition.entities : e.entities
      hit = find_group(sub, name)
      return hit if hit
    end
    nil
  end

  def face_materials(grp)
    mats = []
    collect = lambda do |ents|
      ents.each do |e|
        if e.is_a?(Sketchup::Face)
          mats << e.material.name if e.material
        elsif e.is_a?(Sketchup::Group)
          collect.call(e.entities)
        elsif e.is_a?(Sketchup::ComponentInstance)
          collect.call(e.definition.entities)
        end
      end
    end
    collect.call(grp.entities)
    mats.uniq
  end

  def run
    model = Sketchup.active_model
    FileUtils.mkdir_p(OUT)
    view = model.active_view

    # ---- report: materials + island ----
    lines = []
    lines << "model: #{model.title}"
    lines << "materials in model (#{model.materials.size}):"
    model.materials.each { |m| lines << "  - #{m.name}" }
    island = find_group(model.entities, ISLAND)
    if island
      lines << ""
      lines << "ISLAND group: #{ISLAND}"
      lines << "  group.material: #{island.material ? island.material.name : '(none)'}"
      lines << "  layer/tag: #{island.layer.name}"
      lines << "  face materials: #{face_materials(island).inspect}"
    else
      lines << "ISLAND group NOT found by name '#{ISLAND}'"
    end
    File.write(File.join(OUT, '_report.txt'), lines.join("\n"))
    puts lines.join("\n")

    # ---- screenshots ----
    VIEWS.each do |name, eye, target|
      cam = Sketchup::Camera.new(eye, target, [0, 0, 1], true, 50)
      view.camera = cam
      path = File.join(OUT, "#{name}.png")
      view.write_image(filename: path, width: W, height: H, antialias: true)
      puts "wrote #{path}"
    end
    puts "Done. #{VIEWS.length} images + _report.txt in #{OUT}"
  end
end

ColbyViews.run
