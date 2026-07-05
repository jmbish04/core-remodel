# frozen_string_literal: true
# build_shell_extras.rb — adds the 3 universal shell changes to the OPEN model:
#   1) missing front wall east of the box bay
#   2) bay window grids (pencil-thin muntins) on the "Window Grids" tag
#   3) a roof with skylight cut-outs on the "Roof" tag
# Idempotent: re-running replaces what it made. Run in each model's Ruby Console, then SAVE.
#   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/ruby_scripts/build_shell_extras.rb'

m = Sketchup.active_model
ents = m.active_entities
FZ = 120.6
CEIL = FZ + 96            # 216.6 wall/ceiling top
white = m.materials["Wall White"] || m.materials.add("Wall White"); white.color = Sketchup::Color.new(242,241,238)
blk   = m.materials["Window Frame Black"] || m.materials.add("Window Frame Black"); blk.color = Sketchup::Color.new(20,20,22)
roofm = m.materials["Roof"] || m.materials.add("Roof"); roofm.color = Sketchup::Color.new(70,70,74)
gtag  = m.layers["Window Grids"] || m.layers.add("Window Grids")
rtag  = m.layers["Roof"] || m.layers.add("Roof")

m.start_operation("shell extras", true)
["UP - Front Wall (East of Bay)", "UP - Bay Grids", "UP - Roof"].each do |nm|
  ents.grep(Sketchup::Group).select { |g| g.name == nm }.each(&:erase!)
end

# 1) missing front wall east of bay (bay east edge X265 -> east wall 293.5)
wg = ents.add_group; wg.name = "UP - Front Wall (East of Bay)"
f = wg.entities.add_face([265,0,FZ],[293.5,0,FZ],[293.5,6,FZ],[265,6,FZ]); f.pushpull(CEIL - FZ)
wg.entities.grep(Sketchup::Face).each { |x| x.material = white; x.back_material = white }

# 2) bay grids (pencil-thin muntins) on Window Grids tag
sill = FZ + 24; head = FZ + 83; z1 = 164.3; z2 = 183.9; t = 0.15
G = ents.add_group; G.name = "UP - Bay Grids"; G.layer = gtag; E = G.entities
mk = lambda { |x0,y0,z0,x1,y1,z1v| ff = E.add_face([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]); ff.reverse! if ff.normal.z < 0; ff.pushpull(z1v - z0) }
[170.5,200,229.5].each { |x| mk.call(x-t,-38.6,sill, x+t,-38.0,head) }          # front verticals
[z1,z2].each { |z| mk.call(141,-38.6,z-t, 259,-38.0,z+t) }                       # front horizontals
[[137,140],[260,263]].each do |x0,x1|                                            # side windows
  [z1,z2].each { |z| mk.call(x0,-36,z-t, x1,0,z+t) }
  mk.call(x0,-18-t,sill, x1,-18+t,head)
end
E.grep(Sketchup::Face).each { |x| x.material = blk; x.back_material = blk }

# 3) roof with skylight cut-outs on Roof tag
R = ents.add_group; R.name = "UP - Roof"; R.layer = rtag; RE = R.entities
RE.add_face([0,-42,CEIL],[300,-42,CEIL],[300,660,CEIL],[0,660,CEIL])
[[7,378,129,425],[217,367,258,409],[219,290,248,321]].each do |x0,y0,x1,y1|
  hf = RE.add_face([x0,y0,CEIL],[x1,y0,CEIL],[x1,y1,CEIL],[x0,y1,CEIL]); hf.erase! if hf && hf.valid?
end
RE.grep(Sketchup::Face).max_by(&:area).pushpull(5)
RE.grep(Sketchup::Face).each { |x| x.material = roofm; x.back_material = roofm }
R.layer = rtag
m.commit_operation
puts "shell extras added: east-of-bay wall, bay grids (Window Grids tag), roof (Roof tag). SAVE the model now."
