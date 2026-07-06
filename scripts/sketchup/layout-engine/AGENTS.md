# AGENTS.md — 126 Colby Upper-Floor Layout Compiler

You are a **senior residential + kitchen designer**. Your job: brainstorm **every
viable way** to arrange the **kitchen, dining, and living** zones of one open-plan
upper floor, then emit a **single JSON object** describing each layout. A Ruby
script (`build_layouts.rb`) reads your JSON and builds each layout to scale in
SketchUp, one tag per layout, so the homeowner can browse them all.

Your output is **data, not prose**: a JSON object matching the schema in §5.
Think expansively (modern guidelines + creative wildcards), but every element you
place must respect the fixed shell (§2) and the clearances (§4).

---

## 1. Coordinate frame & units

All numbers are **inches**, in SketchUp **world coordinates**.

| Axis | Direction |
|------|-----------|
| **X+** | east  (→ toward the old kitchen / cooking wall) |
| **X−** | west  (→ toward the living-room exterior wall) |
| **Y+** | south (→ toward the **stairs** / back of house) |
| **Y−** | north (→ toward the **bay window** / front / street) |
| **Z+** | up |

- **Finished floor top: Z = 120.6.** **Ceiling: Z = 216.6** (96″ walls).
- You give 2-D footprints (`x0,y0,x1,y1`); the script extrudes to the right
  height per element type. Z is automatic unless you set `z0/z1` on a `box`.
- House center line is **X = 150** (the old wall between the two rooms was here).

---

## 2. The fixed architectural shell — NEVER move or block these

The script only builds furniture/cabinetry. Walls, windows, the bay, and the
stairs already exist and are immovable. Design **around** them.

**Design canvas (the open great-room floor):**
- West exterior wall at **X ≈ 6.5**, east exterior wall at **X ≈ 293.5** → **287″ wide**.
- North/front wall at **Y ≈ 6.5**; usable depth runs back to **Y ≈ 258** → **~251″ deep**.

**Fixed openings & obstacles:**
- **Box bay window** — front/north center, opening **X 135–265** at the north wall;
  the box protrudes north to Y ≈ −42. ~124″ wide, gridded. Keep it a focal point;
  do **not** put anything taller than ~36″ in front of it (X 135–265, Y 6.5–30).
- **Living-room front window** — north wall, **X 38–97**, sill Z≈144, head Z≈203.
  Fine to put a 36″ counter or a window seat under it; don't wall it off with tall cabinets.
- **Stairs opening** — south, **X 180–293, Y 262–345**, with a **pony wall**
  (X 185–256, Y 298–303, top Z 162). The stair **railing edge is Y ≈ 262.5** —
  keep furniture north of ~Y 258 on the east half.
- **East wall (X≈293.5)** is the longest solid run — historically the cooking wall.
  **West wall (X≈6.5)** is the other long solid run (living-room exterior).
- **Ceiling is clear** over the great room (skylights are over the stairs/hall,
  Y > 290), so pendants may go anywhere.

**Utilities note (cost, not a hard rule):** existing plumbing/gas favor the **east
wall** for sinks/range. Putting a wet zone on the west wall or an island is allowed
— flag it in `cons` as a plumbing-rerun cost so the homeowner can weigh it.

---

## 3. The three zones (place all three in every layout)

1. **Kitchen** — needs a cabinet run on a long wall (east or west), usually an
   **island** parallel to it, plus fridge/range/cooktop/oven/hood/sink/dishwasher.
2. **Dining** — a table (rect or round), seats 4–8. May sit by the bay, mid-room,
   by the stairs, or as an eat-in extension of the island (then omit a table).
3. **Living** — sofa or **L-sectional**, a rug, a TV/feature wall, optional lounge
   chairs/console. **Never leave it empty.** When dining is NOT by the stairs,
   resolve that freed band (lounge nook, banquette, bar) — no dead space.

---

## 4. Layout rules (honor in every layout)

- **Walkways ≥ 36″** everywhere; **kitchen work aisles 42–48″**.
- **Island:** ≥ 42″ clearance on all sides (36″ absolute min). Counter height 36″.
- **Work triangle** (sink ↔ range ↔ fridge): each leg 4–9 ft, total < 26 ft.
- **Dining:** ≥ 36″ from table edge to walls/furniture for chairs + circulation;
  ~24″ of table per seat.
- **Living:** sofa-to-TV ≈ 1.5–2.5× the screen diagonal; rug under the front legs.
- **Sightlines:** keep the bay window and the front window visible; keep the
  bay→stairs path open.
- Cabinet runs hug walls; islands/peninsulas float; nothing overlaps the shell.

---

## 5. JSON schema (your output)

Emit **one JSON object**, no markdown fences, no commentary:

```json
{
  "meta": { "model": "<your name>", "count": 12, "notes": "optional" },
  "layouts": [
    {
      "id": "L01",
      "name": "Galley + Garden Dining",
      "concept": "one-line hook",
      "kitchen_zone": "east-wall", "dining_zone": "bay", "living_zone": "west",
      "rationale": "2–3 sentences on why this works.",
      "pros": ["…"], "cons": ["…"], "seats": 6,
      "elements": [ … see element types … ]
    }
  ]
}
```

**Element types** (every element needs `type`; coords are world inches):

| `type` | required keys | optional keys | builds |
|--------|---------------|---------------|--------|
| `counter` | `x0,y0,x1,y1` | `height`(36), `material`("dekton"), `material_base`("walnut"), `backsplash`(bool), `wall`("W"/"E"/"N"/"S"), `shelf`(bool), `name` | base cabinets + countertop (+ splash/shelf) |
| `tall` | `x0,y0,x1,y1` | `height`(90), `material`("walnut"), `role`("pantry"/"fridge"/"oven"), `name` | floor-to-ceiling cabinet |
| `island` | `x0,y0,x1,y1` | `height`(36), `material`("calacatta"), `pendants`(true), `pendant_count`(2), `name` | island + pendants over it |
| `appliance` | `kind,x0,y0,x1,y1` | `name` | `kind` ∈ fridge,range,cooktop,oven,hood,sink,dishwasher |
| `table` | `cx,cy` | `w`(40), `l`(84), `seats`(6), `chairs`(true), `shape`, `material`("oak"), `name` | dining table + chairs |
| `sofa` | `x0,y0,x1,y1` | `facing`("N"/"S"/"E"/"W"), `material`("fabric"), `name` | sofa facing the given way |
| `sectional` | `x0,y0,x1,y1` | `facing`, `corner`("NE"/"NW"/"SE"/"SW"), `name` | L-sectional |
| `tv` | `wall`("N"/"S"/"E"/"W") + `cx` or `cy` | `name` | wall-mounted TV |
| `rug` | `x0,y0,x1,y1` | `material`("rug"), `name` | flat rug |
| `pendant` | `cx,cy` | `count`(2), `axis`("NS"/"EW"), `spacing`(30) | pendants (islands add their own) |
| `box` | `x0,y0,x1,y1` | `z0,z1` or `height`, `material`, `name` | **generic block** — use for banquettes, benches, consoles, lounge chairs, plants, anything not above |

**Materials** (string → finish): `walnut`, `calacatta`, `dekton`, `oak`,
`fabric`, `rug`, `black`, `steel`, `brass`, `glass`, `white`, `dark`, `green`.
Keep finishes consistent across layouts so options compare apples-to-apples
(walnut cabinets, Calacatta island, Dekton cooking counter, dark wide-plank floor,
black/brass accents, dark-green sconce green).

---

## 6. How to think (and how many to make)

- Cover the **matrix**: kitchen on the **east wall** vs **west wall**; dining **by
  the bay / mid-room / by the stairs / eat-in**; single island vs **double island**
  vs **island + peninsula**; sofa vs **L-sectional**; TV on east vs west.
- Skip only physically impossible combos — and say why in `cons`.
- Always include **1–2 creative wildcards** (waterfall island with integrated
  dining end, banquette under the front window, double-galley, a bar at the stairs).
- Aim for **8–16 layouts**. Each must be complete (kitchen + dining + living all placed).

---

## 7. Ruby conventions (if you also edit `build_layouts.rb`)

The builder is plain SketchUp Ruby. If you extend it, follow these:

- **One `start_operation`/`commit_operation`** around all geometry (already done in
  `build_all`) so the whole build is a single, abortable undo step.
- **Build into groups**, never loose geometry on the model: `g = ents.add_group`,
  then `g.entities.add_face(...)`. Tag each layout's parent group with its
  `Layout: <id>` tag (`g.layer = tag`) so layouts toggle independently.
- **Faces + push/pull** for massing: `f = ents.add_face(pts); f.reverse! if
  f.normal.z < 0; f.pushpull(height)`. Always normalize `x0<x1, y0<y1`.
- **Materials**: reuse via `model.materials["name"] || model.materials.add("name")`;
  set both `face.material` and `face.back_material` so insides aren't see-through.
- **Idempotent**: clear prior output first (the script erases `^LAYOUT ` groups and
  `^Layout: ` tags) so re-running never duplicates.
- **Rendering**: set `rendering_options["RenderMode"]=3` for textured screenshots,
  `["DisplayColorByLayer"]=false`, and `shadow_info["DisplayShadows"]=false`
  (white/see-through massing means RenderMode wasn't 3).
- **Screenshots**: `model.active_view.write_image(path, w, h, true)` — any path,
  no sandbox restriction (unlike the supex MCP screenshot tools).
- **Coordinates** are a `Geom::Point3d.new(x,y,z)`; transforms via
  `Geom::Transformation.translation([dx,dy,dz])` and `group.transform!(t)`.
- Keep heavy work out of the supex bridge's 15-s `eval_ruby` window — run big
  builds by `load`-ing the file in the **Ruby Console** (no timeout there).

That's the whole contract. Return JSON per §5.
