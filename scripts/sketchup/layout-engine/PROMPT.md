# PROMPT — 126 Colby upstairs floor-plan generator

Paste this entire file into a capable AI model. It is self-contained: it defines
the room, the fixed architecture you must design around, the rules, and the
**strict JSON schema** you must return. Your output (a JSON object) is fed
directly to a SketchUp builder (`build_layouts.rb`) that constructs every layout
to scale — so **every coordinate must be real and every required field present.**

---

## Your role
You are a senior residential + kitchen designer. Brainstorm **every viable way**
to arrange the **kitchen, dining, and living** zones of one open-plan upper floor,
and return them as a single JSON object matching the schema below. Think broadly
(modern guidelines + creative wildcards) but stay physically correct.

## Coordinate frame (all numbers = inches, SketchUp world coords)
- **X+** = east (toward the historic cooking wall). **X−** = west (living exterior wall).
- **Y+** = south (toward the stairs). **Y−** = north (toward the bay window / street).
- Floor top is Z = 120.6; ceiling Z = 216.6. You give 2-D footprints
  (`x0,y0,x1,y1` or `cx,cy`); the builder extrudes each piece to the correct height.
- House center line is **X = 150**.

## The fixed shell — design AROUND it, never on top of it
- **Canvas (open floor):** X **6.5 → 293.5** (287″ wide), Y **6.5 → 258** (~251″ deep).
- **Box bay window** (front focal point): opening X **135–265** at Y 6.5, protrudes
  north to ~Y −42. Put **nothing taller than 36″** in front of it (X 135–265, Y 6.5–30).
- **Front window** (north wall, west of bay): X **38–97**. A 36″ counter/bench may go
  under it; don't block it with tall cabinets.
- **Stairs** (south): opening X 180–293, Y 262–345; **railing edge Y ≈ 262.5** — keep
  furniture north of ~Y 258.
- **East wall (X 293.5)** and **west wall (X 6.5)** are the long solid runs for cabinets.
- Ceiling over the great room is clear — pendants may go anywhere.
- **Utilities:** existing plumbing/gas favor the **east** wall. A wet zone on the west
  wall or island is allowed — note the rerun cost in that layout's `cons`.

## Rules (every layout must satisfy)
- Walkways ≥ 36″; kitchen aisles 42–48″. Island ≥ 42″ clearance all sides (36″ min).
- Work triangle (sink↔cooktop↔fridge): legs 4–9 ft, total < 26 ft.
- Dining: ≥ 36″ from table edge to walls/furniture; ~24″ table per seat.
- Living: sofa-to-TV ≈ 1.5–2.5× screen; rug under the seating.
- Keep the bay + front window visible and the bay→stairs path open.
- Nothing overlaps another element or the shell. Cabinets hug walls; islands float.

## Finishes — keep identical across ALL layouts (so only layout varies)
Walnut cabinets, **Calacatta** island, **Dekton** cooking counter, dark plank floor,
black + brass accents. (Materials are auto-applied by element type; you don't set them
except `material` on cabinets/island if you want to override.)

---

## STRICT OUTPUT SCHEMA

Return **one JSON object only** — no markdown fences, no prose. Shape:

```json
{
  "meta": { "model": "<your name>", "count": <n> },
  "layouts": [ <layout>, <layout>, ... ]
}
```

Each `<layout>` MUST contain **every** field below. A layout missing any required
field is rejected by the builder and not drawn. A *box* `{x0,y0,x1,y1}` is a
footprint in inches (height is automatic per piece).

```json
{
  "id": "L01",
  "name": "short name",
  "concept": "one-line hook",
  "kitchen_zone": "east-wall|west-wall|...",
  "dining_zone": "bay|stairs|mid|eat-in",
  "living_zone": "west|east|bay|...",
  "rationale": "2-3 sentences",
  "pros": ["..."],
  "cons": ["..."],
  "seats": 6,

  "kitchen": {
    "cabinets":   [ { "x0":, "y0":, "x1":, "y1":, "height": 36, "wall": "E|W|N|S", "backsplash": true } ],
    "island":     { "x0":, "y0":, "x1":, "y1": },
    "pantry":     { "x0":, "y0":, "x1":, "y1": },
    "fridge":     { "x0":, "y0":, "x1":, "y1": },
    "cooktop":    { "x0":, "y0":, "x1":, "y1": },
    "oven":       { "x0":, "y0":, "x1":, "y1": },
    "hood":       { "x0":, "y0":, "x1":, "y1": },
    "sink":       { "x0":, "y0":, "x1":, "y1": },
    "dishwasher": { "x0":, "y0":, "x1":, "y1": }
  },

  "dining": {
    "table": { "cx":, "cy":, "w": 40, "l": 84, "seats": 6 }
  },

  "living": {
    "seating":      { "kind": "sofa|sectional", "x0":, "y0":, "x1":, "y1":, "facing": "N|S|E|W", "corner": "NE|NW|SE|SW" },
    "rug":          { "x0":, "y0":, "x1":, "y1": },
    "coffee_table": { "x0":, "y0":, "x1":, "y1": },
    "tv":           { "wall": "N|S|E|W", "cx_or_cy": "give cx for N/S walls, cy for E/W walls" }
  },

  "lighting": {
    "island_pendants": { "cx":, "cy":, "count": 2, "axis": "NS|EW", "spacing": 40 }
  },

  "extras": [ { "x0":, "y0":, "x1":, "y1":, "height": 36, "material": "walnut", "name": "banquette/bar/plant" } ]
}
```

Field rules:
- `kitchen.cabinets` is an **array** (≥ 1 run); every other kitchen item is a single box. `corner` is required only when `seating.kind` = "sectional".
- `tv` needs `wall` plus **either** `cx` (N/S walls) **or** `cy` (E/W walls).
- `extras` is optional — use generic boxes for banquettes, a stair-zone bar, plants,
  lounge chairs, window benches, etc.

### A complete, valid layout (copy this shape)
```json
{
  "id": "L01", "name": "Classic East Galley + Bay Dining",
  "concept": "Wet wall stays east; dining glows at the bay; living anchors the west.",
  "kitchen_zone": "east-wall", "dining_zone": "bay", "living_zone": "west",
  "rationale": "Keeps the wet wall east (no plumbing move), an 11ft island parallel to it, dining in the bright bay, and the whole west wall for a lounge.",
  "pros": ["No plumbing move", "Bay is the dining focal point"], "cons": ["Kitchen and dining share the front sightline"], "seats": 6,
  "kitchen": {
    "cabinets": [ { "x0": 267, "y0": 66, "x1": 293, "y1": 200, "height": 36, "wall": "E", "backsplash": true } ],
    "island": { "x0": 184, "y0": 40, "x1": 224, "y1": 172 },
    "pantry": { "x0": 267, "y0": 42, "x1": 293, "y1": 66 },
    "fridge": { "x0": 267, "y0": 7, "x1": 293, "y1": 42 },
    "cooktop": { "x0": 270, "y0": 120, "x1": 292, "y1": 150 },
    "oven": { "x0": 267, "y0": 96, "x1": 290, "y1": 118 },
    "hood": { "x0": 277, "y0": 120, "x1": 292, "y1": 150 },
    "sink": { "x0": 196, "y0": 64, "x1": 212, "y1": 90 },
    "dishwasher": { "x0": 196, "y0": 120, "x1": 214, "y1": 150 }
  },
  "dining": { "table": { "cx": 88, "cy": 78, "w": 40, "l": 84, "seats": 6 } },
  "living": {
    "seating": { "kind": "sectional", "x0": 16, "y0": 150, "x1": 130, "y1": 250, "facing": "W", "corner": "SE" },
    "rug": { "x0": 16, "y0": 150, "x1": 145, "y1": 252 },
    "coffee_table": { "x0": 60, "y0": 185, "x1": 100, "y1": 215 },
    "tv": { "wall": "W", "cy": 200 }
  },
  "lighting": { "island_pendants": { "cx": 204, "cy": 106, "count": 2, "axis": "NS", "spacing": 40 } }
}
```

---

## What to produce
- **8–16 complete layouts.** Cover the matrix: kitchen **east vs west wall**; dining
  **bay / mid / stairs / eat-in**; **single vs double island vs island+peninsula**;
  **sofa vs sectional**; TV east vs west.
- Include **≥ 2 creative wildcards** (waterfall island with eat-in end, banquette
  under the front window, double-galley, a bar resolving the stair zone — via `extras`).
- Skip only physically impossible combos, and say why in that layout's `cons`.

**Self-check before returning:** every required field present; every element inside
the canvas; nothing > 36″ in front of the bay; nothing crosses Y 262.5; work triangle
sane; living furnished and stair zone resolved. **Return the JSON object only.**
