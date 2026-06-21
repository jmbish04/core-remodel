"""
Local test harness mirroring the deployed Cloudflare Worker's staged render flow
(src/backend/services/render/*). For each blank canvas in blank_images/ it runs:

  Stage 1 (base)        set floor material + wall paint on the CLEAN blank canvas
  Stage 2 (rough-in)    place cabinetry/island/fixtures, feeding the CLEAN stage-1 output
  Stage 3 (finish)      high-fidelity materials/lighting, feeding the CLEAN stage-2 output
  Stage 4 (interaction) conversational micro-edits (sink, fixtures), feeding stage-3 output
  Stage 5 (synthesis)   reference-image blending (@image indexed), feeding stage-4 output
  Mood board            interior-design flatlay from the final render + key references

Each stage feeds the CLEAN previous-stage image to the model (never painted guides),
pins Gemini output framing via image_config (nearest aspect ratio + "2K"), and includes
the same preservation/anti-hallucination guardrails the Worker uses.

ENTRY POINT: this file parses args, resolves credentials, and orchestrates the stage
modules in ``ai_photo_pipeline/stages/`` in sequence per blank-canvas image. Flip
``ai_photo_pipeline.config.STAGE_MODELS`` to A/B test Fal or Replicate alternates
(called directly here since this is a local harness).

The script's own directory is on sys.path[0], so ``ai_photo_pipeline/`` under
``scripts/`` resolves without any install step.
"""

import argparse
import os
import sys
from datetime import datetime

from google import genai

from ai_photo_pipeline import config
from ai_photo_pipeline.context import load_coordinates, load_per_image_prompts
from ai_photo_pipeline.providers import _read
from ai_photo_pipeline.secrets import (
    get_fal_key,
    get_gemini_api_key,
    get_openai_key,
    get_replicate_token,
)
from ai_photo_pipeline.stages import (
    base,
    finish,
    interaction,
    mood_board,
    rough_in,
    synthesis,
)


def process_canvas(filename, env):
    """Run one blank canvas through all 5 stages + mood board."""
    source_path = os.path.join(config.base_dir, "blank_images", filename)
    if not os.path.exists(source_path):
        print(f"  skipping {filename} (not found)")
        return

    stem = os.path.splitext(filename)[0]
    per_image_prompts = env.get("per_image_prompts", {})
    coordinates = env.get("coordinates", {})
    print(f"\n=== {filename} ===")
    if filename in per_image_prompts:
        print(f"  ✓ per-image prompt loaded ({len(per_image_prompts[filename])} chars)")
    else:
        print(f"  ⚠ no per-image prompt found — using generic fallback")
    if filename in coordinates:
        print(f"  ✓ coordinate data loaded ({len(coordinates[filename])} keys)")

    # ── Stage 1 (base): floor + wall on the CLEAN blank canvas ──
    base_img = base.run(stem, _read(source_path), env)

    # ── Stage 2 (rough-in): depth-locked cabinet/island placement ──
    roughin_img = rough_in.run(stem, filename, base_img, env)

    # ── Stage 3 (finish): high-fidelity materials + lighting ──
    finish_img = finish.run(stem, filename, roughin_img, env)

    # ── Stage 4 (interaction): micro-edits (sink, fixtures) ──
    interaction_img = interaction.run(stem, filename, finish_img, env)

    # ── Stage 5 (synthesis): reference image blending ──
    synthesis_img = synthesis.run(stem, interaction_img, env)

    # ── Mood board: flatlay from the final render + key references ──
    mood_board.run(stem, synthesis_img, env)

    print(f"  done: {filename}")


def list_blank_images():
    blank_dir = os.path.join(config.base_dir, "blank_images")
    if not os.path.isdir(blank_dir):
        return []
    return sorted(
        f for f in os.listdir(blank_dir)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    )


def build_env(output_dir):
    """Resolve credentials/clients for the providers actually selected in STAGE_MODELS."""
    providers = set(config.STAGE_MODELS.values())
    env = {"output_dir": output_dir}

    # Load per-image context data
    env["per_image_prompts"] = load_per_image_prompts()
    env["coordinates"] = load_coordinates()
    print(f"  Loaded {len(env['per_image_prompts'])} per-image prompts")
    print(f"  Loaded {len(env['coordinates'])} coordinate sets")

    if "gemini" in providers:
        api_key = get_gemini_api_key()
        if not api_key:
            raise SystemExit("GEMINI_API_KEY is required for the selected stages.")
        env["gemini_client"] = genai.Client(api_key=api_key)
    if "fal" in providers:
        env["fal_key"] = get_fal_key()
        if not env["fal_key"]:
            raise SystemExit("FAL_API_KEY is required for the selected Fal stages.")
    if "replicate" in providers:
        env["replicate_token"] = get_replicate_token()
        if not env["replicate_token"]:
            raise SystemExit("REPLICATE_API_TOKEN is required for the selected Replicate stages.")
    if "openai" in providers:
        env["openai_key"] = get_openai_key()
        if not env["openai_key"]:
            raise SystemExit("OPENAI_API_KEY is required for the selected OpenAI stages.")
    return env


def _text_select(items):
    """Plain numbered-menu fallback when curses can't initialize."""
    print("\nPick a blank canvas to render:")
    for i, (_, label) in enumerate(items, 1):
        print(f"  {i}. {label}")
    while True:
        raw = input("Enter number (q to quit): ").strip().lower()
        if raw in ("q", ""):
            return None
        if raw.isdigit() and 1 <= int(raw) <= len(items):
            return items[int(raw) - 1][0]
        print("  invalid choice")


def tui_select(blanks):
    """Arrow-key menu over blank_images/.

    Returns a single filename to render, the sentinel ``"__ALL__"`` to run the
    entire pipeline over every image, or ``None`` if the user quit.
    Up/Down (or k/j) to move, Enter to choose, q/Esc to quit. Falls back to a
    plain numbered prompt if the terminal can't drive curses.
    """
    import curses

    items = [(b, b) for b in blanks]
    items.append(("__ALL__", ">> Run entire pipeline (all images, one at a time)"))

    def _menu(stdscr):
        try:
            curses.curs_set(0)  # cosmetic; some terminals (e.g. via pnpm) reject it
        except curses.error:
            pass
        idx = 0
        while True:
            stdscr.erase()
            h, w = stdscr.getmaxyx()

            def put(y, x, text, attr=curses.A_NORMAL):
                if 0 <= y < h and 0 <= x < w:
                    try:
                        stdscr.addnstr(y, x, text, max(0, w - x - 1), attr)
                    except curses.error:
                        pass

            put(0, 0, "AI photo pipeline -- pick a blank canvas to render", curses.A_BOLD)
            put(1, 0, "Up/Down: move    Enter: run    q: quit")
            for i, (_, label) in enumerate(items):
                attr = curses.A_REVERSE if i == idx else curses.A_NORMAL
                put(i + 3, 2, ("> " if i == idx else "  ") + label, attr)
            ch = stdscr.getch()
            if ch in (curses.KEY_UP, ord("k")):
                idx = (idx - 1) % len(items)
            elif ch in (curses.KEY_DOWN, ord("j")):
                idx = (idx + 1) % len(items)
            elif ch in (curses.KEY_ENTER, 10, 13):
                return items[idx][0]
            elif ch in (ord("q"), 27):
                return None

    try:
        return curses.wrapper(_menu)
    except curses.error:
        return _text_select(items)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", action="store_true",
                        help="Process only the first blank image (non-interactive).")
    parser.add_argument("--image", help="Process a single blank image by filename (non-interactive).")
    parser.add_argument("--all", action="store_true",
                        help="Process every blank image, one at a time (non-interactive).")
    args = parser.parse_args()

    blanks = list_blank_images()
    if not blanks:
        raise SystemExit(f"No blank images found in {os.path.join(config.base_dir, 'blank_images')}")

    # Target resolution. With no explicit flag on an interactive terminal we open the
    # TUI so you can pick exactly one image (or choose to run the whole batch).
    if args.image:
        targets = [args.image]
    elif args.sample:
        targets = blanks[:1]
    elif args.all:
        targets = blanks
    elif sys.stdin.isatty() and sys.stdout.isatty():
        choice = tui_select(blanks)
        if not choice:
            print("Nothing selected — exiting.")
            return
        targets = blanks if choice == "__ALL__" else [choice]
    else:
        targets = blanks  # non-interactive (piped) fallback

    timestamp = datetime.now().strftime("%Y-%m-%d_%I-%M-%S_%p")
    output_dir = os.path.join(config.base_dir, "nano_bannana_output", timestamp)
    os.makedirs(output_dir, exist_ok=True)

    print("=== STAGED RENDER TEST (mirrors deployed Worker flow) ===")
    print(f"Stage providers: {config.STAGE_MODELS}")
    print(f"Output dir:      {output_dir}")
    print(f"Targets:         {len(targets)} image(s)")

    env = build_env(output_dir)
    # Strictly sequential: one image fully through the pipeline before the next starts.
    for i, filename in enumerate(targets, 1):
        print(f"\n[{i}/{len(targets)}] {filename}")
        try:
            process_canvas(filename, env)
        except Exception as exc:
            print(f"  ERROR on {filename}: {exc}")

    print(f"\nAll done. Outputs in: {output_dir}")


if __name__ == "__main__":
    main()
