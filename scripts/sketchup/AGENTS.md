# AGENTS.md — Driving SketchUp (base_colby) from an agent session

This directory is the control surface for the **126 Colby** SketchUp model. It lets an
agent write Ruby into a *running* SketchUp 2026, read the model back, and screenshot it —
the live-bridge loop, not pixel-clicking.

## TL;DR — start a session

```bash
/Volumes/Projects/workers/core-remodel/scripts/sketchup/spinup_sketchup.sh
```

When it prints `READY`, the **supex MCP bridge** is connected and you can call the supex
tools directly: `eval_ruby`, `get_model_info`, `take_screenshot`, etc. Re-running it while a
session is already live is a no-op (it short-circuits). Pass `--restart` to force a clean
cold relaunch, or a path to open a different `.skp`.

If the MCP `supex` tools are deferred in your harness, load them first (e.g. ToolSearch
`select:mcp__supex__eval_ruby,mcp__supex__check_sketchup_status,...`).

## The one gotcha that will waste your session

The supex extension loads **only** via SketchUp's `-RubyStartup` flag, which **only fires on
a COLD start**. So:

- ❌ `open -a SketchUp base_colby.skp` → model loads, **bridge never starts**, MCP stays
  "disconnected" forever. (This is the trap. Don't do this.)
- ✅ `spinup_sketchup.sh` (or `supex/scripts/launch-sketchup.sh <model>`) → cold-starts with
  the injector, so the bridge comes up.

Two more boot quirks the script already handles:
- On cold start SketchUp shows the **Welcome/Home screen** with no document. The bridge's
  auto-start timer (`UI.start_timer(1.0)` → `Main.start`) only fires once the run loop is
  active, which opening a model triggers. So: cold-start, then open the model.
- Opening the model too early returns LaunchServices **error -600** ("app not ready"). The
  script retries the open until it succeeds.

## How the bridge works

```
agent (MCP tools)  →  Python driver (supex/mcp, FastMCP)  →  JSON-RPC over TCP
                      localhost:9876  →  Ruby "Supex Runtime" extension inside SketchUp
```

- Port **9876** = MCP/CLI bridge. Port **4433** = REPL.
- The extension auto-starts the bridge ~1s after load unless `SUPEX_NO_AUTOSTART=1`.
- The MCP server is registered as `supex` (config points at `…/scripts/sketchup/supex/mcp`).

## Verify / recover

```bash
cd /Volumes/Projects/workers/core-remodel/scripts/sketchup
bash supex/supex status     # -> "Connected" + "Version: 0.2.0"
bash supex/supex info
lsof -nP -iTCP:9876          # bridge listening?
```

Recovery, in order of preference:
1. `spinup_sketchup.sh --restart` — clean cold relaunch.
2. **Deterministic fix when the bridge never bound** (port 9876 closed,
   `…/.tmp/sketchup_console.log` is 0 bytes): the Welcome window blocked the one-shot
   auto-start timer and it was dropped. Have the user open **Window ▸ Ruby Console** and
   run `SupexRuntime::Main.start` — it prints `Supex: Bridge server started on
   127.0.0.1:9876`. (Closing the Welcome window alone often does NOT recover it; opening a
   model usually fires the late timer, which is why the script opens one.)
3. SketchUp menu: **Extensions ▸ Supex Runtime ▸ Restart All Servers**.
4. `bash supex/supex reload` — only works once the bridge is already connected (it goes
   through the bridge); useless if it never bound.
5. Logs: `supex/.tmp/sketchup_out.txt`, `…_err.txt`, `…_console.log`,
   and `supex/.tmp/supex-mcp.log`.

Note: don't try to type `SupexRuntime::Main.start` into the Ruby Console via computer-use —
keystrokes scatter into SketchUp tool shortcuts and `osascript`/automation permission is
unreliable here. Ask the user to run it.

## supex tools you'll use (via MCP)

`eval_ruby` (arbitrary Ruby, the workhorse) · `eval_ruby_file` (run a `.rb` from disk —
note: runs in a **sandboxed** binding) · `get_model_info` · `list_entities` ·
`get_layers` · `get_materials` · `get_selection` · `get_camera_info` ·
`take_screenshot` · `take_batch_screenshots` · `open_model` · `save_model` · `export_scene`.

## The model: base_colby

- Path: `claude_scripts/base_colby.skp` (~66 MB). Units = **inches**.
- ~110 tags organized into folders: room/wall dividers, `MEP - Plumbing` + `Plumbing - *`,
  `Electrical - *`, the kitchen folder (`Kitchen - Island/Cabinets/Lighting`), a per-room
  `Floor - *` set, `Windows` / `Skylights` / `Window Grids`, plus materials `Dark Walnut`
  and `Calacatta Viola Stone`.
- Backups live in `claude_scripts/backups/` and timestamped copies in `claude_scripts/`.
  **Save discipline:** before a risky edit, save a timestamped backup, e.g.
  `bash supex/supex save /…/claude_scripts/base_colby_backup_$(date +%Y%m%d_%H%M%S).skp`
  then continue working on `base_colby.skp`.

### Hard rules

- The cloud `build_model` MCP (a separate, headless SketchUp builder) **cannot** edit
  `base_colby`. Only this supex desktop bridge edits the real model. Don't cross them.
- Rendering gotchas when screenshotting for review: use `view.write_image` (not
  batch-screenshot for styled output); set `InstanceFade=0` so solids don't render
  see-through; `RenderMode=3` for textures; **triangulate non-planar tube faces** or they
  vanish.
- Follow `supex/CLAUDE.md`: never bump versions, never commit, don't read git-ignored
  files unless asked. Don't commit these spin-up files unless the user asks.

## Related docs

- `claude_scripts/CLAUDE_DRIVES_SKETCHUP.md` — background on the bridge approach + the
  alternative `mhyrr/sketchup-mcp` bridge.
- `supex/CLAUDE.md` / `supex/README.md` — the supex platform itself.
- `claude_scripts/ruby_scripts/` — existing build/edit Ruby scripts to reuse as patterns.
