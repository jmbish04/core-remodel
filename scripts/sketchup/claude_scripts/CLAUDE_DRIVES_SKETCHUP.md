# Letting Claude draw walls & manage edits in SketchUp from chat

Goal: stop driving SketchUp by pixel-clicking. Instead, give Claude a **live bridge** into your running SketchUp so it can send Ruby, read the model back, screenshot it, and iterate — all from chat / Cowork.

The pattern that makes this work is always the same:

> A small **Ruby extension runs a socket server inside SketchUp** → a **Python MCP server** connects to that socket and exposes tools (most importantly `eval_ruby`) to the AI agent → Claude calls those tools to build and edit geometry, then reads the model state / screenshots back to verify.

Your machine already matches the best-supported config: **macOS + SketchUp 2026**.

---

## The two bridges worth using (pick one)

### 1. darwin/supex — best fit for your setup
`https://github.com/darwin/supex` — "SketchUp meets AI Agents"

- **Architecture:** Python MCP server (`./mcp`, FastMCP) ⇄ JSON-RPC 2.0 over TCP (`localhost:9876`) ⇄ a Ruby "Supex Runtime" bridge running inside SketchUp.
- **Tools exposed to Claude:** `eval_ruby` / `eval_ruby_file` (run any SketchUp Ruby), plus introspection: `get_model_info`, `list_entities`, `take_screenshot`, selection/material/layer/camera queries. Exports SKP/OBJ/STL/PNG/JPG.
- **Workflow:** project-based — Ruby scripts live in a git repo; Claude writes a script, runs it via `eval_ruby_file`, screenshots, and iterates. Exactly the "manage all edits from chat" loop.
- **Tested on:** macOS, **SketchUp 2026**, Claude Code, Python 3.14+, Ruby 3.2.2. v0.2.0 (Dec 2025). Early-stage, ~22 stars, MIT.
- **Why it's the pick:** it targets *your* exact environment and is built around Claude/agentic coding. Cowork is built on Claude Code, so the same `claude mcp add` registration applies.

**Install (≈10 min):**
```bash
git clone https://github.com/darwin/supex.git
cd supex
./scripts/launch-sketchup.sh path/to/your/model.skp   # launches SketchUp + deploys the extension
claude mcp add supex -- /absolute/path/to/supex/mcp    # register the MCP server
./supex status                                          # verify connection
```
Then in chat: *"Draw the lower-level exterior shell: 25 ft × 54.8 ft, 6.5″ walls, opening for the garage door…"* → Claude writes Ruby → runs it → screenshots → you correct in words.

### 2. mhyrr/sketchup-mcp — more established alternative
`https://github.com/mhyrr/sketchup-mcp` — "SketchUp Model Context Protocol"

- Same shape: a **.rbz extension** runs a TCP server in SketchUp; a Python FastMCP server connects and registers with Claude.
- **Higher-level tools** in addition to `eval_ruby`: `create_component`, `transform_component`, `set_material`, scene inspection, selection handling.
- Packaged as an installable `.rbz`, more stars/usage, and generally treated as cross-platform. Good if supex's dev-oriented setup feels heavy or you're ever on Windows.

**Either one gives Claude the same superpower: type Ruby into SketchUp and read the result.** Supex = best match for your machine; sketchup-mcp = easier packaging / more mature.

---

## The other repos you listed — where each fits

| Repo | What it actually is | Use it for |
|---|---|---|
| **darwin/supex** | Live MCP↔SketchUp bridge (Ruby runtime + Python MCP) | ✅ The main event — Claude edits the model from chat |
| **mhyrr/sketchup-mcp** | Live MCP↔SketchUp bridge (.rbz + Python MCP) | ✅ Alternative bridge, more packaged |
| **matyo91/sketchup-shape** | PHP + local Ollama; turns a sentence → design spec → a Ruby script you paste into SketchUp's Ruby Console | One-shot generator. No feedback loop, no read-back. Reference only — the live bridges supersede it |
| **mageaustralia/FloorPlanAnalyzer** | Python/PyQt5 GUI; detects rooms/doors/walls from a plan **image** (CubiCasa5K / YOLOv8 / watershed), exports SVG/JSON | Optional front-end to auto-extract walls from your raster → JSON. Explicitly experimental ("mixed results"), macOS-ARM only, **non-commercial license** |
| **fadyazizz/FloorPlanTo3D-unityClient** | Unity client to a Mask R-CNN REST API that turns 2D plans → 3D walls | Image→walls idea, but the output targets Unity, not SketchUp. Only the API concept is reusable here |
| **SketchUp/sketchup-ruby-api-tutorials** | Official, well-commented Ruby API examples (faces, push/pull, camera) | Reference/templates so the Ruby Claude writes is idiomatic and correct |
| **bikemike/HouseBuilder** | Old Ruby SketchUp extension that frames a building (walls/studs/joists) | Reference for wall/framing Ruby patterns. It's a manual GUI tool, not AI-driven |

---

## Recommended path for *your* project

1. **Install supex** (above) so I can write/run Ruby in your SketchUp 2026 and read it back.
2. **Skip image auto-detection for now.** I already have every labeled dimension from both plan images, and I produced an exact wall-coordinate model when I built the Trimble files. Feeding those coordinates to `eval_ruby` is cleaner and more reliable than the experimental image detectors — which struggle exactly on annotated, furnished plans like yours.
3. I generate the **lower level** walls from the dimensions, screenshot, and you correct in plain English ("nudge the laundry wall 4″", "widen the garage opening"). Then the **upper level**.
4. Optionally revisit **FloorPlanAnalyzer** later if you want auto-tracing of other, unlabeled plans.

### One important caveat about DIBAC
These bridges create **native SketchUp geometry** (faces + push/pull, groups, components). DIBAC's own "smart wall" objects are created by its private extension and aren't exposed through a public Ruby API, so Claude can't reliably author *DIBAC wall entities* through the bridge. If the deliverable specifically needs editable **DIBAC** walls, that part still has to be drawn with the DIBAC tool by hand (I can guide you live). If "accurate, editable SketchUp walls" is the real goal, the bridge handles it end-to-end.

---

## Sources
- [darwin/supex](https://github.com/darwin/supex)
- [mhyrr/sketchup-mcp](https://github.com/mhyrr/sketchup-mcp)
- [matyo91/sketchup-shape](https://github.com/matyo91/sketchup-shape)
- [mageaustralia/FloorPlanAnalyzer](https://github.com/mageaustralia/FloorPlanAnalyzer)
- [fadyazizz/FloorPlanTo3D-unityClient](https://github.com/fadyazizz/FloorPlanTo3D-unityClient)
- [SketchUp/sketchup-ruby-api-tutorials](https://github.com/SketchUp/sketchup-ruby-api-tutorials)
- [bikemike/HouseBuilder](https://github.com/bikemike/HouseBuilder)
