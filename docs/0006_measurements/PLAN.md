# 0006 — Measurements → Decision & Phasing Platform

**Status:** Planning / scoping (for owner review, then phasing). New epic.
**Date:** 2026-06-19
**Stack:** Cloudflare Worker + Astro SSR + Hono + Drizzle/D1 + Workers AI + Agents SDK (assistant-ui). Dark Monolith theme. Reuses 0005's room/photo data + the existing budget / planning-tasks / shopping / scenario systems.

> Owner's framing: *"We should have a master database of all the measurements… because to decide whether to move forward with something — and if we do, how to adjust the budget — we need to know things like: we want to spend $$ to open this space, which gives roughly ## sq ft… is it worth it? Then, like a shopping experience, we add things into a phased plan to get things to sit correctly. This needs to be integrated with budget, tasks, timeline, shopping, etc."* And: *"the chat agent is an overall specialist in everything, not just measurements; don't worry about auth for now."*

---

## 1. Vision

A house-wide **master measurements database** is the foundation. On top of it sits a **decision layer** (evaluate proposed changes by cost vs. space/benefit), a **shopping-cart-style phasing experience** (assemble changes into ordered phases), and **deep integration** with budget, tasks, timeline, and shopping. A **global AI specialist** (floating chat on every page) can answer anything across all of it.

The throughline: **measure → propose a change → see cost + space/benefit impact → decide → add to a phase → it flows into budget, tasks, timeline, and shopping.**

---

## 2. Core concepts (entities)

1. **Measurement (master, as-is)** — single source of truth for every dimension in/around the house: rooms, closets, windows, doors, fixtures, walls, stairs, skylights, outdoor structures, duct/mechanical runs, appliances. Each carries a **source** (insurance/Matterport = approximate, measured, estimated) + accuracy flag. *Not* scenario-scoped — one master set of reality.
2. **Scope Item (proposed change / decision unit)** — e.g., "Push the front door to the street (+~50% of the porch → foyer)," "Remove the primary-bath closet," "Open the kitchen wall above the garage (posts down)." Each scope item captures:
   - affected rooms + measurements (the **deltas**: walls removed, sqft gained/lost, new openings),
   - **estimated cost** (→ budget),
   - **space/benefit impact** (sqft gained, function unlocked),
   - **ROI view**: "$X to gain ~Y sq ft / this benefit — worth it?",
   - dependencies, risks, status (`considering | approved | rejected | done`).
3. **Phase / Plan (the cart)** — assemble approved scope items into **ordered phases** (a shopping-cart experience): add/remove, sequence, see running budget + timeline + required shopping per phase. Reuses `planning_epics` as phases.
4. **Global Specialist Agent** — assistant-ui floating chat on all pages; specialist across measurements, scope items, budget, tasks, timeline, shopping, scenarios. (No auth for now per owner.)

---

## 3. Data model (Drizzle / D1)

### `measurements` (master, as-is)
`id`, `room_id?` (FK rooms), `floor_id?`, `element_type` (`room | closet | built_in | window | door | shower | tub | vanity | sink | toilet | wall | ceiling | clearance | stair | stair_landing | pony_wall | handrail | skylight | roof | post | retaining_wall | appliance | duct | mechanical_run | site_area | other`), `label`, `length_ft/in`, `width_ft/in`, `height_ft/in`, `span_json` (named spans, e.g. skylight distances from each wall), `area_sq_ft`, `quantity`, `source` (`insurance_matterport | measured | estimated | plan`), `is_approximate`, `accuracy_note`, `notes`, `metadata`, timestamps.
Plus a `rooms.area_sq_ft` override (irregular rooms; foyer → 77.28).

### `scope_items` (proposed changes / decisions)
`id`, `title`, `description`, `status`, `category` (structural | finishes | mechanical | plumbing | electrical | outdoor | appliances | …), `estimated_cost_cents_low/high`, `sqft_delta` (+/-), `benefit_summary`, `risk_notes`, `depends_on_scope_item_ids`, `scenario_id?` (optional grouping), `phase_id?` (planning_epic), `priority`, `metadata`, timestamps.
- **`scope_item_measurements`** (join): scope item ↔ affected measurements, with `change_type` (`remove | add | resize | relocate`) + before/after refs → drives the before/after view + sqft math.
- **`scope_item_rooms`** (join): affected rooms.

### Floor-area annotations (for before/after visual)
`floor_annotations`: `id`, `scope_item_id?`, `state` (`as_is | delivered`), `label`, `floor_key`, `polygon_json` (% of floorplan image), `style`. Drives the shaded floor regions + the table-row→flash linkage on the contractor share view.

### Integration (reuse existing tables; add link columns/joins)
- **Budget** → `budget_tracker_items` (scope item ↔ budget line(s)); running phase totals.
- **Tasks/Kanban/Gantt** → `planning_epics` (= phases) + `planning_tasks` (scope item → tasks); reuse 0005's board/timeline/calendar endpoints.
- **Shopping** → `shopping_journal` (items a scope item requires).
- **Scenarios** → `remodel_scenarios` / `scenario_room_plans` (optional grouping of scope items into alternative plans).

---

## 4. Pages / surfaces

1. **`/measurements` (admin data-entry)** — CRUD master measurements grouped by room + element type; source/approximate badges; search/filter; fast bulk entry from insurance docs; the `rooms.area_sq_ft` override.
2. **Scope-item workbench (admin)** — create/evaluate proposed changes: pick affected measurements/rooms, enter cost + sqft/benefit, see the **ROI card** ("$X → +Y sq ft"), set status.
3. **Phasing / "cart" (admin)** — browse approved scope items, add to phases, reorder; live **running budget + timeline + shopping** per phase; push to kanban/gantt.
4. **`/measurements/share` (public, read-only — contractor)** — before/after **diff slider** of the floorplan + a before/after **table**; hovering a row **flashes** the impacted floor area on the plan (all annotations always visible; hover flashes the relevant one). Shareable read-only link.
5. **Per-room surfacing** — a room's measurements + the scope items affecting it on `/rooms/[slug]`.
6. **Dashboards** — cost-vs-space ROI across scope items; phase rollups (budget/timeline/tasks/shopping).
7. **Floating specialist agent** — assistant-ui modal on every page; everything-specialist; no auth for now.

---

## 5. Measurement checklist (owner brain-dump — structured capture)

> Enter as `measurements` rows (as-is). Items marked → *change* also become **scope items** with cost + sqft impact. `~` = owner estimate / approximate.

### Structural / walls
- **Living-room wood-burning fireplace** → remove so the back wall is one continuous wall *(scope item)*. Measure fireplace footprint + wall.
- **Downstairs laundry wall** (holds washer/dryer) → if laundry moves upstairs, open this wall for a **wet bar** *(scope item)*. Measure wall.
- **Micro walls near downstairs laundry**: (a) back-of-laundry wall → storage door; (b) back-of-wet-bar wall (same wall, back-to-back with laundry) → the foyer opening into the wet bar / lower family room.
- **Garage walls (all)**: potential **posts down from the kitchen wall above** (kitchen we want to open) — where they land + space lost from car parking; **distance from the new kitchen-island location** (≈ midpoint of the garage ceiling) **to the garage wall bordering the entry wall** (current kitchen sink drain → sewer under slab, water line, electrical panel) → size the plumbing/water/electrical runs to the island *(scope item)*.
- **Upstairs hallway**: width × length from the stairs back to the rear 2 bedrooms; floor area in front of the hall-bath door + justin-office door.

### Stairs (interior) — partly captured in 0005
- **Pony wall** around the upstairs stairs (width + depth). Each **tread** (width + depth/run). **Landing** (depth + width). Steps: **8** (lower→landing) + **6** (landing→2nd) = 14. **Handrail** length.

### Closets / built-ins
- **Primary-bath closet unit** → rip out; measure available space (fit washer + dryer + Samsung steam/dry-clean unit; barn-door concealment) *(scope item: relocate laundry upstairs)*.
- **Back-left bedroom large closet** (bedroom → new primary) → remove; **~9'2" wide, ~2'10" sides** *(scope item)*.
- **justin-office closet** → remove for more bedroom space *(scope item)*.
- **Upstairs hallway little closet** (may merge with the lightwell): same width as lightwell, **depth unknown** *(scope item)*.

### Doors
- **Interior door openings** — goal: **flush doors** (measure all openings).
- **New front door** *(scope item)*.
- **Bathroom door → pocket door** *(scope item)*; measure opening.

### Windows / drapes
- **All windows**: width / height / **depth**.
- **Drapes**: box bay window (upstairs) + the window in the current kitchen (future living room).

### Bathrooms / fixtures
- **Shower, toilet, vanity** in each bathroom.
- **Primary-bath skylight**: spans from each wall (reposition shower under it; rainfall-head clearance) *(scope item)*.

### Appliances / laundry
- **Washer & dryer** dims (fit primary-bath closet; barn-door hide; room for a Samsung steam dry-clean box alongside).

### Patio (outside)
- **Retaining wall** boxing the patio in → rip out (height + width) *(scope item)*.
- **Posts** holding the little patio roof (height + width). **Little patio roof**: width + depth (upstairs cantilevers ~6' over the patio; the dinky roof is ~3' deep off the cantilever).

### Backyard (outside)
- **Retaining walls** — each of the 4–5 levels up the slope.
- **Backyard staircase** — total + **steps per retaining-wall level**.
- **Flat area** between the patio and the 1st retaining wall — **total sq ft**.

### HVAC / mechanical
- **Minisplits**: condenser locations (TBD) + electrical runs — vs. an **electric furnace** replacing the gas one in the garage *(scope item)*.
- **Existing ducts to replace**: from the back garage wall through the **foyer ceiling near the stairs** (lowered ceiling — measure height for headroom gain via low-profile ducting or minisplits); continues to the **hallway ceiling between the downstairs laundry and bath** (also lowered) *(scope item: raise ceilings)*.

### Room-level deltas (as-is → delivered)
- **Foyer** + ~50% of the porch (push front door to the street) *(scope item)*.
- **Back-left bedroom → new primary**; **current kitchen → living room**; **current living room → kitchen (island)**; **downstairs laundry space → wet bar**.

---

## 6. Proposed build phasing

- **P1 — Master measurements + data entry.** `measurements` schema + `rooms.area_sq_ft` override + admin `/measurements` page (CRUD, grouped, source/approximate flags, search). Seed foyer 77.28 + sync 0005 dims into `home-catalog.ts`. → start logging insurance numbers immediately.
- **P2 — Scope items + ROI.** `scope_items` (+ joins) + the workbench: define a change, attach measurements/rooms, cost + sqft/benefit, ROI card, status. Link to `budget_tracker_items`.
- **P3 — Phasing "cart" + integration.** Assemble scope items into phases (`planning_epics`); running budget/timeline/shopping; push to kanban/gantt (0005 task API) + `shopping_journal`.
- **P4 — Contractor share view.** Before/after table + floorplan **diff slider** + **flash-on-hover** floor annotations (`floor_annotations`); read-only shareable.
- **P5 — Global specialist agent.** assistant-ui floating chat on all pages, everything-specialist (measurements, budget, tasks, scope, shopping, scenarios), Workers AI / Agents SDK. No auth for now; can harden later.

---

## 7. Integration map (reuse, don't duplicate)
- **Budget**: `budget_tracker_items` (+ `budget_tracker_item_rooms`) ↔ scope items; phase + house ROI rollups.
- **Tasks / timeline**: `planning_epics` (phases) + `planning_tasks` + 0005's board/timeline/calendar endpoints.
- **Shopping**: `shopping_journal` ↔ scope items.
- **Scenarios**: `remodel_scenarios` / `scenario_room_plans` for alternative plans.
- **Rooms / photos / floorplan**: 0005 (rooms, coordinates, listing/inspiration, floor annotations overlay on the same floorplan image).

---

## 8. Open questions for the owner (review, then we phase)
- Confirm P1 first (start entering measurements) — or do you want the scope-item/ROI workbench (P2) close behind so decisions can begin immediately?
- ROI metric: is **sq ft gained per $** the primary lens, or also "function unlocked," resale, etc.? (Affects the ROI card + dashboards.)
- Phases as `planning_epics` (reuse) vs. a dedicated `phases` table — I lean reuse.
- The specialist agent: any data it should NOT see (since auth is off for now)?
