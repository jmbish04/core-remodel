#!/usr/bin/env python3
"""Interactive mask-drawing frontend + Gemini 3.x image editing pipeline.

Usage
-----
    python generate_angles.py                  # open the mask-drawing GUI
    python generate_angles.py --masks          # regenerate binary mask PNGs from saved JSON
    python generate_angles.py --execute        # run masked edits on all images (requires masks)
    python generate_angles.py --execute --4k   # same but at 4K resolution
"""
from __future__ import annotations

# ── Auto-venv bootstrap ─────────────────────────────────────────────────────
# Re-exec under the project venv so tkinter, Pillow, and google-genai are
# available without manual `source .venv/bin/activate`.
import os as _os, sys as _sys
from pathlib import Path as _Path

_VENV_PYTHON = _Path(__file__).resolve().parent.parent / ".venv" / "bin" / "python3"
if _VENV_PYTHON.exists() and _sys.prefix == _sys.base_prefix:
    _os.execv(str(_VENV_PYTHON), [str(_VENV_PYTHON), *_sys.argv])
# ─────────────────────────────────────────────────────────────────────────────

import sys
import tkinter as tk
from pathlib import Path

# ── Parent package imports ──────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_photo_pipeline import config
from ai_photo_pipeline.angles.core.constants import (
    BLANK_IMAGES_DIR,
    OUTPUT_JSON,
    FLOORPLAN_PATH,
    DEFAULT_IMAGE_SIZE,
    MODEL_EDIT,
    MODEL_FAST,
    MAX_CANVAS_W,
    MAX_CANVAS_H,
    FLOORPLAN_SIDEBAR_W,
)
from ai_photo_pipeline.angles.core.masks import build_masks_from_json
from ai_photo_pipeline.angles.core.orchestrator import execute_edits, parse_models
from ai_photo_pipeline.angles.gui.mask_editor import MaskDrawingApp


def discover_blank_images() -> list[Path]:
    """Return sorted list of blank-canvas images (by camera number)."""
    exts = {".jpeg", ".jpg", ".png"}
    images = sorted(
        p for p in BLANK_IMAGES_DIR.iterdir()
        if p.suffix.lower() in exts and not p.name.startswith(".")
    )
    if not images:
        print(f"ERROR: No images found in {BLANK_IMAGES_DIR}")
        sys.exit(1)
    return images


def list_available_models():
    """Print all available models/providers configured in config.py and default constants."""
    print(f"\n{'═' * 60}")
    print("  AVAILABLE MODELS & PROVIDERS")
    print(f"{'═' * 60}")

    print("\n[Gemini]")
    print(f"  • {config.GEMINI_MODEL} (configured primary pro: config.GEMINI_MODEL)")
    print(f"  • {MODEL_EDIT} (primary flash edit: MODEL_EDIT)")
    print(f"  • {MODEL_FAST} (fast analysis: MODEL_FAST)")
    
    gemini_listed = {config.GEMINI_MODEL, MODEL_EDIT, MODEL_FAST}
    other_gemini = ["imagen-3.0-generate-002", "imagen-3.0-fast-generate-002"]
    for m in other_gemini:
        if m not in gemini_listed:
            print(f"  • {m} (Imagen 3 Image Generation)")

    print("\n[Fal] (config.FAL_MODELS)")
    for key, val in config.FAL_MODELS.items():
        print(f"  • {key:<12} : {val}")

    print("\n[Replicate] (config.REPLICATE_MODELS)")
    for key, val in config.REPLICATE_MODELS.items():
        print(f"  • {key:<12} : {val}")

    print("\n[OpenAI] (config.OPENAI_MODELS)")
    unique_openai = []
    for key, val in config.OPENAI_MODELS.items():
        if val not in unique_openai:
            unique_openai.append(val)
            print(f"  • {val:<12} : (configured in config.OPENAI_MODELS['{key}'])")
            
    openai_listed = set(config.OPENAI_MODELS.values())
    openai_listed.add("dall-e-2")
    other_openai = ["dall-e-3", "chatgpt-image-latest", "dall-e-2"]
    for m in other_openai:
        if m not in openai_listed:
            desc = "DALL-E 3 Image Generation" if m == "dall-e-3" else "DALL-E 2 edit model" if m == "dall-e-2" else "ChatGPT Image Generation"
            print(f"  • {m:<12} : {desc}")
            openai_listed.add(m)

    print("\nShorthands & Custom Aliases:")
    print("  • all          -> Runs [gemini, openai, fal, replicate] in parallel")
    print("  • gemini       -> Maps to gemini-3.1-flash-image")
    print("  • gemini-pro-3 -> Maps to gemini-3-pro-image (or config.GEMINI_MODEL)")
    print("  • openai       -> Maps to gpt-image-2")
    print("  • flux / fal   -> Maps to config.FAL_MODELS[\"finish\"] / stage-specific")
    print("  • replicate    -> Maps to config.REPLICATE_MODELS stage-specific")
    print(f"{'═' * 60}\n")


def main():
    args = set(sys.argv[1:])

    # --list or --models option
    if "--list" in args or "--models" in args:
        list_available_models()
        return

    if "--help" in args or "-h" in args:
        print("Usage: python generate_angles.py [options]")
        print()
        print("Options:")
        print("  --masks                                                Generate binary mask PNGs from angles_mask_data.json")
        print("  --execute                                              Run the progressive masking edit pipeline")
        print("  --model {all, gemini, openai, fal, replicate, list}    Select model provider(s) / model name(s)")
        print("  --pro                                                  Override default Gemini model with Gemini 3 Pro")
        print("  --4k                                                   Set render resolution to 4K (Gemini 3 Pro only)")
        print("  --demo [cam_num]                                       Only run one camera angle as a demo (default: 1)")
        return

    # --masks: only regenerate mask PNGs and exit
    if "--masks" in args:
        build_masks_from_json()
        return

    # --execute: run the full edit pipeline from saved masks
    if "--execute" in args:
        size = "4K" if "--4k" in args else DEFAULT_IMAGE_SIZE

        # Get model string from CLI. Defaults to config.GEMINI_MODEL if not specified.
        model_str = config.GEMINI_MODEL
        for i, arg in enumerate(sys.argv):
            if arg == "--model":
                model_parts = []
                j = i + 1
                while j < len(sys.argv) and not sys.argv[j].startswith("-"):
                    model_parts.append(sys.argv[j])
                    j += 1
                if model_parts:
                    model_str = "".join(model_parts)

        # Parse configurations
        resolved_configs = parse_models(model_str)

        # Override default gemini model with Pro if --pro flag is passed
        if "--pro" in args:
            for c in resolved_configs:
                if c["provider"] == "gemini" and c["model"] == "gemini-3.1-flash-image":
                    c["model"] = config.GEMINI_MODEL
                    c["label"] = "gemini_pro"

        # Parse --demo [cam_num]
        demo_cam = None
        if "--demo" in sys.argv:
            idx = sys.argv.index("--demo")
            if idx + 1 < len(sys.argv) and sys.argv[idx + 1].isdigit():
                demo_cam = int(sys.argv[idx + 1])
            else:
                demo_cam = 1

        execute_edits(
            image_size=size,
            resolved_configs=resolved_configs,
            demo_cam=demo_cam,
        )
        return

    # Default: open the mask-drawing GUI
    image_paths = discover_blank_images()
    print(f"Found {len(image_paths)} blank canvas images:")
    for p in image_paths:
        print(f"  • {p.name}")
    print()

    root = tk.Tk()
    root.geometry(f"{MAX_CANVAS_W + FLOORPLAN_SIDEBAR_W + 40}x{MAX_CANVAS_H + 160}")
    root.minsize(1000, 600)

    MaskDrawingApp(root, image_paths, FLOORPLAN_PATH)
    root.mainloop()

    if OUTPUT_JSON.exists():
        print(f"\n✓ Mask data saved → {OUTPUT_JSON}")
        print("  Next steps:")
        print("    python generate_angles.py --masks                                                # generate binary mask PNGs")
        print("    python generate_angles.py --execute                                              # run default Gemini edits")
        print("    python generate_angles.py --execute --model all                                  # run all providers side-by-side")
        print("    python generate_angles.py --execute --model gemini-pro-3,fal,flux,gpt-image-latest # run specific mix")
        print("    python generate_angles.py --execute --demo 1                                     # run camera 1 only as a demo")
    else:
        print("\n✗ No mask data saved.")


if __name__ == "__main__":
    main()