#!/usr/bin/env bash
#
# spinup_sketchup.sh — One command to get an agent-ready SketchUp session.
#
# Cold-starts SketchUp 2026 with the supex Ruby extension injected, opens a model
# (default: base_colby.skp), waits for the supex MCP bridge to come up on port 9876,
# and reports READY. After this exits 0, an agent can call the supex MCP tools
# (eval_ruby, get_model_info, take_screenshot, ...) immediately.
#
# WHY THIS EXISTS — the gotcha that wastes a session if you don't know it:
#   The supex extension only loads via SketchUp's `-RubyStartup` flag, which ONLY
#   fires on a COLD start. A plain `open -a SketchUp model.skp` loads the model but
#   NEVER starts the bridge, so the MCP tools sit "disconnected" forever. You must
#   relaunch through the injector. This script does that correctly.
#
# Usage:
#   ./spinup_sketchup.sh                 # cold-start + open base_colby.skp
#   ./spinup_sketchup.sh /path/to.skp    # cold-start + open a specific model
#   ./spinup_sketchup.sh --restart       # force a clean relaunch even if already connected
#   ./spinup_sketchup.sh --restart /path/to.skp
#
# Env overrides:
#   SUPEX_SKETCHUP_APP   path to SketchUp.app (default: /Applications/SketchUp 2026/SketchUp.app)
#
set -euo pipefail

# --- Fixed locations (canonical install on this machine) ---------------------
SKETCHUP_DIR="/Volumes/Projects/workers/core-remodel/scripts/sketchup"
SUPEX_DIR="$SKETCHUP_DIR/supex"
# Robust boot wrapper (loads supex + retries the bridge on a repeating timer). Falls back
# to supex's raw injector if the wrapper is missing.
INJECTOR="$SKETCHUP_DIR/claude_scripts/ruby_scripts/agent_boot.rb"
[[ -f "$INJECTOR" ]] || INJECTOR="$SUPEX_DIR/runtime/src/injector.rb"
DEFAULT_MODEL="$SKETCHUP_DIR/claude_scripts/base_colby.skp"
APP_PATH="${SUPEX_SKETCHUP_APP:-/Applications/SketchUp 2026/SketchUp.app}"
APP_BIN="$APP_PATH/Contents/MacOS/SketchUp"
LOG_DIR="$SUPEX_DIR/.tmp"

# --- Arg parsing -------------------------------------------------------------
FORCE_RESTART=0
MODEL=""
for arg in "$@"; do
  case "$arg" in
    --restart|--force) FORCE_RESTART=1 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) MODEL="$arg" ;;
  esac
done
MODEL="${MODEL:-$DEFAULT_MODEL}"

log()  { printf '\033[0;34m[spinup]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m[spinup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[spinup]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[spinup]\033[0m %s\n' "$*" >&2; }

# Run the supex CLI (avoids any exec-bit quirks by going through uv directly).
supex() { ( cd "$SUPEX_DIR/driver" && uv run supex "$@" ); }

is_connected() { supex status 2>/dev/null | grep -qx "Connected"; }
model_id()     { supex eval 'm=Sketchup.active_model; "#{m.title}|#{File.basename(m.path.to_s)}"' 2>/dev/null | head -1; }

# --- Preflight ---------------------------------------------------------------
[[ -f "$MODEL" ]]    || { err "Model not found: $MODEL"; exit 1; }
MODEL="$(cd "$(dirname "$MODEL")" && pwd)/$(basename "$MODEL")"   # absolutize
[[ -x "$APP_BIN" ]]  || { err "SketchUp binary not found: $APP_BIN  (set SUPEX_SKETCHUP_APP)"; exit 1; }
[[ -f "$INJECTOR" ]] || { err "supex injector not found: $INJECTOR"; exit 1; }
command -v uv >/dev/null 2>&1 || { err "'uv' not on PATH — needed to run the supex driver."; exit 1; }

# --- Short-circuit: already live? --------------------------------------------
if [[ $FORCE_RESTART -eq 0 ]] && is_connected; then
  cur="$(model_id)"
  ok "supex bridge already connected. Current model: ${cur:-unknown}"
  if [[ "$cur" != *"$(basename "$MODEL")"* ]]; then
    warn "A different model is open. Opening $(basename "$MODEL") via the live bridge..."
    supex open "$MODEL" || warn "supex open returned non-zero; open it manually if needed."
  fi
  log  "Already ready — pass --restart to force a clean cold relaunch."
  exit 0
fi

# --- 1) Quit any running SketchUp (cold start is required for injection) ------
if pgrep -x SketchUp >/dev/null 2>&1; then
  warn "SketchUp is running — quitting for a clean cold start (saved file on disk is preserved)..."
  osascript -e 'tell application "SketchUp" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do pgrep -x SketchUp >/dev/null 2>&1 || break; sleep 1; done
  pkill -x SketchUp 2>/dev/null || true
  sleep 2
fi

# Clear stale Chromium/CEF ProcessSingleton locks. A force-quit or a previous aborted
# launch leaves these behind, and the next direct binary launch then aborts with
# "Failed to create SingletonSocket: File exists (17) ... CEF init failed (exit 21)".
shopt -s nullglob
for lock in "$HOME/Library/Application Support/SketchUp 2026/"WebCache-*/Cache0/Singleton*; do
  rm -f "$lock" 2>/dev/null && log "Cleared stale lock: $(basename "$lock")"
done
shopt -u nullglob

# --- 2) Cold start with the extension injected (NO model arg) -----------------
# IMPORTANT: do NOT pass the model file as a launch arg — SketchUp SILENTLY IGNORES
# -RubyStartup when a document is also opened at launch, so the extension never loads.
# Inject first; open the model in the next step.
mkdir -p "$LOG_DIR"
: > "$LOG_DIR/sketchup_console.log" 2>/dev/null || true   # clean so bridge-start is detectable
: > "$LOG_DIR/agent_boot.log" 2>/dev/null || true
log "Cold-starting SketchUp with supex injected (-RubyStartup $(basename "$INJECTOR"))..."
"$APP_BIN" -RubyStartup "$INJECTOR" >>"$LOG_DIR/sketchup_out.txt" 2>>"$LOG_DIR/sketchup_err.txt" &
for _ in $(seq 1 30); do pgrep -x SketchUp >/dev/null 2>&1 && break; sleep 1; done
pgrep -x SketchUp >/dev/null 2>&1 || { err "SketchUp failed to start within 30s."; exit 1; }

# --- 3) Open the model -------------------------------------------------------
# Opening the model dismisses the modal Welcome window and un-blocks the run loop, which
# lets the boot wrapper's REPEATING timer fire and bind the bridge (it keeps retrying, so
# it survives the long 66MB load that kills supex's stock one-shot timer). A too-early
# open returns LaunchServices -600, so retry until SketchUp accepts it.
log "Opening $(basename "$MODEL") (retries until SketchUp accepts the open event)..."
for _ in $(seq 1 20); do
  open -a "$APP_PATH" "$MODEL" 2>/dev/null && break
  sleep 2
done

# --- 4) Wait for the bridge --------------------------------------------------
log "Waiting for the supex bridge (port 9876)..."
connected=0
for i in $(seq 1 75); do             # up to ~150s for the 66MB load + repeating timer to bind
  if is_connected; then connected=1; break; fi
  # If still down past ~40s, re-issue the open as another run-loop kick.
  if [[ $i -eq 20 ]]; then open -a "$APP_PATH" "$MODEL" 2>/dev/null || true; fi
  sleep 2
done
if [[ $connected -ne 1 ]]; then
  err "Bridge did not connect within timeout (the Welcome window likely dropped the"
  err "one-shot auto-start timer). Deterministic fix:"
  err "  -> In SketchUp open Window > Ruby Console and run:  SupexRuntime::Main.start"
  err "     (prints 'Supex: Bridge server started on 127.0.0.1:9876')"
  err "  - Or menu: Extensions > Supex Runtime > Restart All Servers"
  err "  - Logs: $LOG_DIR/sketchup_out.txt , $LOG_DIR/sketchup_err.txt , $LOG_DIR/sketchup_console.log"
  exit 1
fi

# --- 5) Confirm + report -----------------------------------------------------
cur="$(model_id)"
ok  "Bridge connected (supex v$(supex status 2>/dev/null | awk -F': ' '/Version/{print $2}'))."
ok  "Model loaded: ${cur:-unknown}"
echo
ok  "READY — the supex MCP bridge is live. Agent tools available:"
echo "       eval_ruby, eval_ruby_file, get_model_info, list_entities,"
echo "       get_layers, get_materials, get_selection, get_camera_info,"
echo "       take_screenshot, take_batch_screenshots, save_model, export_scene."
