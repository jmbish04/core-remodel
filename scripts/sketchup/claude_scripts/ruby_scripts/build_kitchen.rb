# build_kitchen.rb — 126 Colby UPPER KITCHEN (bespoke spec v3 — rounded island)
# === BACK WALL (14ft, floor-to-ceiling natural walnut) ===
#   - South/window end: 36" SINGLE PANEL panel-ready fridge (Sub-Zero look), no reveal
#   - North end:        36" double-door pantry (center reveal)
#   - Central recess between them: Dekton Lunar counter + plain Dekton backsplash
#     terminating at mid-wall in a 5"-deep floating Dekton shelf, with a 48"
#     enclosed Dekton range hood to the ceiling. NO UPPER CABINETS above the shelf.
#   - Invisacook (invisible — plain Dekton counter), wall oven below.
# === ISLAND (11ft monolithic Calacatta Viola, ROUNDED WATERFALL EDGES) ===
#   - Side profile = rounded rectangle: top corners R=4", bottom corners R=2.5"
#   - Extruded 132" along Y; sink hole cut into the flat top at the south end
#   - Sink basin = stainless (NOT viola); faucet = Kraus Bolden (black + brass
#     coil spring, matches faucet.jpg)
# === LIGHTING === Two Octo wood-lantern pendants (Ø21.3"x26.8") over the island.
# Frame: X 0=W..300=E, Y 0=S(bay)..N, Z up, FF=120, ceiling=216, east wall X=293.5.
# Textures: walnut_clean.jpg + viola_clean.jpg (cropped from styled refs, see
# textures/ dir) at large world-size so no visible tiling. Run inline via supex
# eval_ruby (eval_ruby_file is sandboxed; see [[supex-sketchup-rendering-gotchas]]).
# Idempotent — re-runnable.

model = Sketchup.active_model

def getmat(m,n,rgb=nil); mt=m.materials[n]||m.materials.add(n); mt.color=Sketchup::Color.new(*rgb) if rgb && mt.texture.nil?; mt; end
def getlayer(m,n); m.layers[n]||m.layers.add(n); end
def paint_all(ents,mat)
  ents.grep(Sketchup::Face).each { |f| f.material=mat; f.back_material=mat }
  ents.grep(Sketchup::Group).each { |g| paint_all(g.entities,mat) }
end
def box(parent,x0,y0,z0,x1,y1,z1,mat=nil)
  g=parent.add_group; e=g.entities
  f=e.add_face([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]].map{|a| Geom::Point3d.new(*a)})
  f.reverse! if f.normal.z<0
  f.pushpull(z1-z0); paint_all(e,mat) if mat; g
end
def cyl(parent,cx,cy,z0,z1,r,mat,sides=16)
  g=parent.add_group; e=g.entities
  c=e.add_circle(Geom::Point3d.new(cx,cy,z0),Geom::Vector3d.new(0,0,1),r,sides)
  f=e.add_face(c); f.reverse! if f.normal.z<0; f.pushpull(z1-z0); paint_all(e,mat); g
end
# Tube — triangulated (non-planar quads fail in add_face).
def tube(parent,pts,r,mat,sides=8)
  return nil if pts.size<2
  g=parent.add_group; e=g.entities
  frames=pts.each_with_index.map do |c,i|
    t=(i<pts.size-1 ? (pts[i+1]-c) : (c-pts[i-1])); t.normalize!
    ref=(t.parallel?(Geom::Vector3d.new(0,0,1)) ? Geom::Vector3d.new(1,0,0) : Geom::Vector3d.new(0,0,1))
    s=(t*ref); s.normalize!; u=(t*s); u.normalize!
    (0...sides).map{|k| a=2*Math::PI*k/sides;
      Geom::Point3d.new(c.x+r*(Math.cos(a)*s.x+Math.sin(a)*u.x),
                        c.y+r*(Math.cos(a)*s.y+Math.sin(a)*u.y),
                        c.z+r*(Math.cos(a)*s.z+Math.sin(a)*u.z))}
  end
  (0...frames.size-1).each do |i|
    a=frames[i]; b=frames[i+1]
    (0...sides).each do |k|
      j=(k+1)%sides
      [[a[k],a[j],b[k]],[a[j],b[j],b[k]]].each do |tri|
        begin; ff=e.add_face(tri); ff.material=mat; ff.back_material=mat; rescue StandardError; end
      end
    end
  end
  g
end
def helix_pts(cx,cy,z0,z1,r,turns,seg)
  n=(turns*seg).to_i
  (0..n).map{|i| f=i.to_f/n; a=2*Math::PI*turns*f; Geom::Point3d.new(cx+r*Math.cos(a),cy+r*Math.sin(a),z0+(z1-z0)*f)}
end
def lantern(parent,cx,cy,profile,mat,sides=18)
  g=parent.add_group; e=g.entities
  rings=profile.map{|r,z| (0...sides).map{|i| a=2*Math::PI*i/sides; Geom::Point3d.new(cx+r*Math.cos(a),cy+r*Math.sin(a),z)}}
  (0...rings.size-1).each{|k| a=rings[k]; b=rings[k+1]; (0...sides).each{|i| j=(i+1)%sides; begin; f=e.add_face(a[i],a[j],b[j],b[i]); f.material=mat; f.back_material=mat; rescue StandardError; end}}
  [rings.first,rings.last].each{|ring| begin; f=e.add_face(ring); f.material=mat; f.back_material=mat; rescue StandardError; end}
  g
end

# --- Materials (textures: walnut_clean.jpg + viola_clean.jpg = cropped clean tiles from styled refs;
#                detail.jpg = lunar/detail.jpg for Dekton. Big world sizes so no visible repeat.) ---
TEX = '/Volumes/Projects/workers/core-remodel/scripts/sketchup/claude_scripts/textures'
LUN = '/Volumes/Projects/workers/core-remodel/proofs/tight/jason_20260615/upper_level/kitchen/ai_renders/inspo_for_ai_rendering/use_these/lunar'
VIOLA  = getmat(model,'Stone - Calacatta Viola')
DEKTON = getmat(model,'Stone - Dekton Lunar')
WALNUT = getmat(model,'Wood - Walnut Cabinet')
BIRCH  = getmat(model,'Wood - Birch Lantern',[214,184,134])
BRASS  = getmat(model,'Metal - Brass',[176,138,74])
BLACK  = getmat(model,'Metal - Matte Black',[36,36,38])
STEEL  = getmat(model,'Metal - Stainless',[176,178,181])
OGLASS = getmat(model,'Glass - Appliance',[22,22,26])

# --- Frame / planes ---
FF=120.0; CEIL=216.0; EW=293.5; CTOP=156.0
RY0=6.5; RY1=174.5     # 14' walnut wall S→N
FR1=42.5               # fridge (S) = 36" -> Y6.5..42.5
PA0=138.5              # pantry (N) = 36" -> Y138.5..174.5
RX=269.0               # base-cabinet front
COOK=90.5              # recess / cooktop / hood centerline
SHELF=186.0            # backsplash terminates here -> Dekton floating shelf
# Island
X0=184.0; X1=224.0; Y0=25.0; Y1=157.0
R_TOP=4.0; R_BOT=2.5

model.start_operation('Build Kitchen v3', true)

# Repoint textures + reset color tints (white = let texture display unfiltered)
VIOLA.texture  = ["#{TEX}/viola_clean.jpg",   144.0, 80.0]; VIOLA.color  = Sketchup::Color.new(255,255,255)
WALNUT.texture = ["#{TEX}/walnut_clean.jpg",  51.2, 96.0];  WALNUT.color = Sketchup::Color.new(120, 76, 56)
DEKTON.texture = ["#{LUN}/detail.jpg",        60.0, 38.1];  DEKTON.color = Sketchup::Color.new(232,226,216)

# Wipe prior output
['UP - Kitchen Cabinets','UP - Kitchen Island','UP - Kitchen Lighting',
 'UP - Kitchen Appliances','New Kitchen Appliances (est)'].each do |nm|
  model.entities.grep(Sketchup::Group).select { |g| g.name == nm }.each(&:erase!)
end
cab  = model.entities.add_group; cab.name  = 'UP - Kitchen Cabinets';   cab.layer  = getlayer(model,'Kitchen - Cabinets')
isl  = model.entities.add_group; isl.name  = 'UP - Kitchen Island';     isl.layer  = getlayer(model,'Kitchen - Island')
app  = model.entities.add_group; app.name  = 'UP - Kitchen Appliances'; app.layer  = getlayer(model,'Appliances')
lite = model.entities.add_group; lite.name = 'UP - Kitchen Lighting';   lite.layer = getlayer(model,'Kitchen - Lighting')

# ===== BACK WALL (14ft, NO UPPER CABINETS above the shelf) ==================
ce = cab.entities
# South end: 36" SINGLE PANEL Sub-Zero panel-ready fridge (no reveal)
box(ce, RX, RY0, FF, EW, FR1, CEIL, WALNUT)
# North end: 36" double-door pantry (center reveal)
box(ce, RX, PA0,   FF, EW, 156.0, CEIL, WALNUT)
box(ce, RX, 157.0, FF, EW, RY1,   CEIL, WALNUT)
# Recess base + Dekton counter + backsplash + 5" shelf + 48" hood
box(ce, 272.0, FR1, FF,    EW, PA0, 124.0,    WALNUT)   # toe kick
box(ce, RX,    FR1, 124.0, EW, PA0, 154.5,    WALNUT)   # base carcass
box(ce, 267.0, FR1, 154.5, EW, PA0, CTOP,     DEKTON)   # counter (2" overhang)
box(ce, 292.0, FR1, CTOP,  EW, PA0, SHELF,    DEKTON)   # backsplash to mid-wall
box(ce, 288.5, FR1, SHELF, EW, PA0, SHELF+1.5, DEKTON)  # 5"-deep Dekton shelf
box(ce, 269.5, COOK-24.0, SHELF, EW, COOK+24.0, CEIL, DEKTON)  # 48" enclosed hood

# Wall oven (in base cabinet, below the invisible Invisacook)
box(app.entities, 268.5, COOK-15.0, 126.0, 269.3, COOK+15.0, 150.0, STEEL)
box(app.entities, 268.4, COOK-13.0, 128.0, 269.0, COOK+13.0, 148.0, OGLASS)
box(app.entities, 268.2, COOK-12.0, 145.5, 269.0, COOK+12.0, 147.0, STEEL)

# ===== ISLAND — 11' monolithic Calacatta Viola, ROUNDED WATERFALL ==========
# Build rounded-rect cross-section in XZ plane at Y=Y0 (CCW viewed from +Y),
# then extrude +Y by 132" to make a continuous slab with soft rolled edges.
segs = 10
prof = []
arc = lambda do |cx,cz,r,a0|
  (0..segs).each { |i| a = a0 + i.to_f/segs * (Math::PI/2)
    prof << Geom::Point3d.new(cx + r*Math.cos(a), Y0, cz + r*Math.sin(a)) }
end
arc.call(X0+R_BOT, FF+R_BOT,   R_BOT, Math::PI)         # bottom-left corner
arc.call(X1-R_BOT, FF+R_BOT,   R_BOT, 1.5*Math::PI)     # bottom-right corner
arc.call(X1-R_TOP, CTOP-R_TOP, R_TOP, 0)                # top-right corner
arc.call(X0+R_TOP, CTOP-R_TOP, R_TOP, 0.5*Math::PI)     # top-left corner
# Dedupe consecutive duplicates
prof_u = []; prof.each{|p| prof_u << p if prof_u.empty? || (prof_u.last - p).length > 0.001 }

body = isl.entities.add_group
be = body.entities
face = be.add_face(prof_u)                 # NB: add_face(points) – not add_face(edges)
dir = (face.normal.y > 0) ? (Y1-Y0) : -(Y1-Y0)
face.pushpull(dir)
paint_all(be, VIOLA)

# Sink hole in the flat top (clear of the rounded edges)
top = be.grep(Sketchup::Face).find{|f| f.normal.z > 0.99 && (f.bounds.center.z - CTOP).abs < 0.5 && f.area > 1000}
if top
  hx0,hy0,hx1,hy1 = 194.0,32.0,214.0,64.0
  inner = be.add_face([[hx0,hy0,CTOP],[hx1,hy0,CTOP],[hx1,hy1,CTOP],[hx0,hy1,CTOP]].map{|a| Geom::Point3d.new(*a)})
  inner.erase! if inner
end

# Stainless undermount basin (NOT viola)
box(isl.entities, 194.5, 32.5, 141.0, 213.5, 63.5, 155.5, STEEL)

# Kraus Bolden-style spring-neck faucet (black body + brass coil + black gooseneck)
FX=204.0; FY=66.5
cyl(isl.entities, FX,FY, CTOP, 162.0, 1.3,  BLACK)                                # base body
cyl(isl.entities, FX,FY, 161.5, 163.0, 1.35, BRASS, 16)                            # brass collar
box(isl.entities, FX+1.0, FY-0.5, 158.5, FX+3.8, FY+0.5, 159.9, BRASS)             # brass lever
tube(isl.entities, helix_pts(FX,FY,163.0,182.0,1.3,6,9), 0.34, BRASS, 8)           # brass coil
tube(isl.entities, [[FX,FY,182.0],[FX,FY-1.5,183.6],[FX,FY-4.0,184.0],
                    [FX,FY-6.5,183.0],[FX,FY-7.6,180.0],[FX,FY-7.8,177.0]].map{|a| Geom::Point3d.new(*a)},
     0.45, BLACK, 8)                                                                # gooseneck
cyl(isl.entities, FX, FY-7.8, 172.8, 177.2, 0.7, BLACK)                            # spray head

# ===== LIGHTING — two Octo birch pendants over the island ==================
profile = [[1.5,184.0],[4.5,185.0],[7.5,187.0],[9.5,190.0],[10.65,194.0],
           [10.3,197.0],[9.0,200.0],[6.5,203.5],[4.0,206.5],[2.6,209.0],[2.4,210.8]]
[58.0, 124.0].each do |yc|
  lantern(lite.entities, 204.0, yc, profile, BIRCH)
  box(lite.entities, 203.5, yc-0.5, 210.8, 204.5, yc+0.5, CEIL, BLACK)  # stem
  box(lite.entities, 202.0, yc-2.0, 215.4, 206.0, yc+2.0, CEIL, BLACK)  # canopy
end

model.commit_operation
"OK: kitchen v3 built"
