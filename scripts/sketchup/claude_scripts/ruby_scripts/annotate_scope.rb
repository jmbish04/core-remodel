# annotate_scope.rb
# ---------------------------------------------------------------------------
# Adds remodel-scope callouts to base_colby for the Dong/engineer handoff.
# Every label is flat 3D text (readable in a top/plan view), painted red, and
# placed on its OWN tag "SCOPE NOTES (Dong)" + parent group "SCOPE NOTES (Dong)"
# so you can toggle, move, or delete the whole set without touching the model.
#
# Run in SketchUp's Ruby Console:
#   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/ruby_scripts/annotate_scope.rb'
#
# Then: hide the roof/upper tags and look top-down to read them. Nudge any that
# overlap furniture. Re-running replaces the previous set.
# Coordinates are GLOBAL inches from sketchup_diagnostics.json. z=122 = just
# above the upper floor (120); z=3 = just above the lower floor (0).
# ---------------------------------------------------------------------------
require 'sketchup.rb'

module ColbyScopeNotes
  TAG        = 'SCOPE NOTES (Dong)'
  TEXT_H     = 5.0     # letter height, inches
  EXTRUDE    = 0.5     # slight extrusion so it reads in 3D too
  RED        = [210, 35, 35]

  # [ text, x, y, z ]  — x,y = left start of the label; z = elevation
  NOTES = [
    # ---- UPPER LEVEL (z = 122) ----
    ['1  RELOCATE KITCHEN  (move L -> R, this side)', 150.0,  60.0, 122.0],
    ['1  REMOVE EXISTING KITCHEN WALL (open up)',      20.0, 150.0, 122.0],
    ['2  NEW ISLAND SINK - route DWV to existing 4in stack', 150.0, 170.0, 122.0],
    ['3  RANGE HOOD - reuse existing chimney flue thru roof', 235.0,  40.0, 122.0],
    ['7  NEW LAUNDRY in PRIMARY BATH (relocated from downstairs)', 196.0, 470.0, 122.0],
    ['BATH REMODEL - PRIMARY (upper)',  196.0, 360.0, 122.0],
    ['BATH REMODEL - HALL (upper)',      12.0, 470.0, 122.0],
    # ---- LOWER LEVEL (z = 3) ----
    ['4  MOVE FRONT ENTRY FWD ~7ft-0 (keep 5ft-0 porch at gate)', 10.0, 30.0, 3.0],
    ['6  REMOVE LAUNDRY WALL (W/D plumbing stays -> future wet bar)  [confirm loc]', 90.0, 470.0, 3.0],
    ['EXISTING 4in SEWER STACK - tie new kitchen DWV in here', 150.0, 412.0, 3.0],
    ['EXISTING UNDER-SLAB 4in DRAIN -> sewer', 124.0, 250.0, 3.0],
    ['BATH REMODEL - DOWNSTAIRS (sanitation/life-safety)', 196.0, 360.0, 3.0]
  ].freeze

  module_function

  def red_material(model)
    model.materials['Scope Red'] ||
      model.materials.add('Scope Red').tap { |m| m.color = Sketchup::Color.new(*RED) }
  end

  def scope_tag(model)
    model.layers[TAG] || model.layers.add(TAG)
  end

  def run
    model = Sketchup.active_model
    model.start_operation('Add Scope Notes (Dong)', true)
    begin
      # clear any prior run so re-running is idempotent
      model.entities.grep(Sketchup::Group)
           .select { |g| g.name == TAG }
           .each(&:erase!)

      tag = scope_tag(model)
      red = red_material(model)

      # Build each label by adding 3D text to the model root, then grouping the
      # RESULTING geometry. (Creating an empty group and filling it later trips
      # SketchUp's empty-group GC -> "reference to deleted Group" on transform!.)
      note_groups = []
      NOTES.each do |text, x, y, z|
        before = model.entities.to_a
        made   = model.entities.add_3d_text(text, TextAlignLeft, '', true, false,
                                            TEXT_H, 0.0, 0.0, true, EXTRUDE)
        added  = model.entities.to_a - before
        if !made || added.empty?
          puts "  (no geometry for: #{text[0, 30]} - font issue?)"
          next
        end
        g = model.entities.add_group(added)           # group EXISTING geometry (robust)
        g.transform!(Geom::Transformation.translation(Geom::Point3d.new(x, y, z)))
        g.material = red
        note_groups << g
      end

      raise 'no 3D-text geometry was created' if note_groups.empty?

      parent = model.entities.add_group(note_groups)  # group the notes; never empty
      parent.name  = TAG
      parent.layer = tag
      note_groups.each { |g| g.layer = tag }

      model.commit_operation
      puts "Added #{note_groups.length} scope notes on tag '#{TAG}'. " \
           "Hide the roof/upper tags + view top-down to read them; nudge any that overlap."
    rescue => e
      model.abort_operation
      puts "!! Rolled back — #{e.message}"
      puts e.backtrace.first(5).join("\n")
    end
  end
end

ColbyScopeNotes.run
