# Layout Engine — brainstorm & build every upstairs floor plan

An AI design model fully specifies many floor-plan layouts as **strict JSON**
(every cabinet, the island, every appliance, the dining table, the sofa, the rug,
the TV, the pendants — all required, all with exact coordinates). A Ruby script
validates each layout and builds it to scale in SketchUp, one toggleable tag each.

```
  PROMPT.md ──► (run through any AI model) ──► layouts.json
                                                   │
                                                   ▼
  base_colby.skp  +  build_layouts.rb  ──►  every layout built to scale + screenshots
```

## The two things you run
- **PROMPT.md** — self-contained. Paste it into any capable model; it returns a
  `layouts.json` object. Defines the room, the fixed architecture, the rules, and
  the **strict required-field schema**.
- **build_layouts.rb** — reads `layouts.json`, **validates** every layout against the
  schema (rejects any with missing fields and tells you which), builds the valid ones
  on `Layout: <id>` tags, and screenshots each.

Supporting files: `layouts.example.json` (two complete valid layouts; the builder
runs on these by default) and `AGENTS.md` (deeper reference incl. Ruby conventions).

## Run it
1. Paste **PROMPT.md** into a model. Save its JSON reply as `layouts.json` here.
2. Open **base_colby.skp** in SketchUp (the fixed shell).
3. Window ▸ Ruby Console:
   ```ruby
   $colby_layouts_json = '/Volumes/Projects/workers/core-remodel/scripts/sketchup/layout-engine/layouts.json'
   load '/Volumes/Projects/workers/core-remodel/scripts/sketchup/layout-engine/build_layouts.rb'
   ```
   (Omit the first line to build the bundled example set.)
4. Browse:
   ```ruby
   ColbyLayouts.list          # ids + names + VALID/BAD status
   ColbyLayouts.show('L03')   # show only L03
   ColbyLayouts.shoot('L03')  # re-screenshot one
   ```
   Screenshots: `proofs/tight/sketchup-screenshots/layout-studies/<id>/`
   (override with `$colby_layouts_out`).

## Guarantees
- **Strict validation** — a layout must define every required piece or it's rejected
  (the console prints exactly which fields are missing).
- **Never touches the shell** — only adds furniture/cabinet massing under
  `Layout: <id>` tags; clears its own prior output each run (idempotent).
- Builds blocky **massing** with consistent finishes — meant to compare *layouts*,
  then take the winners into a detailed model or an AI render.
- Run big builds by `load`-ing in the Ruby Console (no timeout), not via the 15-s
  supex `eval_ruby` bridge.
