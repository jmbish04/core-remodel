"""Per-image context loaders.

Parses ``ai_prompt.md`` (per-image design descriptions) and
``ai_photo_coordinates.json`` (normalised element polygons) from ``base_dir``,
and converts coordinate polygons into human-readable spatial directions.
"""

import json
import os
import re

from . import config


def load_per_image_prompts():
    """Parse ai_prompt.md into a dict keyed by image filename -> prompt text."""
    prompt_path = os.path.join(config.base_dir, "ai_prompt.md")
    if not os.path.exists(prompt_path):
        print("  WARNING: ai_prompt.md not found — falling back to generic prompts.")
        return {}
    with open(prompt_path, "r") as fh:
        content = fh.read()
    # Each section starts with ### `filename`
    sections = re.split(r"### `([^`]+)`", content)
    prompts = {}
    # sections[0] is preamble (empty), then alternating filename / body
    for i in range(1, len(sections) - 1, 2):
        raw_name = sections[i].strip()
        body = sections[i + 1].strip()
        # Match both .jpeg and .png variants of the same stem
        prompts[raw_name] = body
        stem = os.path.splitext(raw_name)[0]
        for ext in (".jpeg", ".jpg", ".png"):
            prompts[stem + ext] = body
    return prompts


def load_coordinates():
    """Load ai_photo_coordinates.json into a dict keyed by image filename."""
    coord_path = os.path.join(config.base_dir, "ai_photo_coordinates.json")
    if not os.path.exists(coord_path):
        print("  WARNING: ai_photo_coordinates.json not found — no spatial anchoring.")
        return {}
    with open(coord_path, "r") as fh:
        return json.load(fh)


def describe_spatial_anchor(coords):
    """Convert normalised coordinate polygons into human-readable spatial directions.

    x=0 is left edge, x=1 is right edge.
    y=0 is top edge, y=1 is bottom edge.
    """
    def _centroid(pts):
        if not pts:
            return None
        xs = [p["x"] for p in pts]
        ys = [p["y"] for p in pts]
        return (sum(xs) / len(xs), sum(ys) / len(ys))

    def _horiz(cx):
        if cx < 0.33:
            return "left third"
        elif cx < 0.66:
            return "center"
        else:
            return "right third"

    def _vert(cy):
        if cy < 0.33:
            return "upper"
        elif cy < 0.66:
            return "middle"
        else:
            return "lower"

    lines = []
    for key in ("backCounter", "hood", "island", "sink", "leftCabinet", "rightCabinet"):
        pts = coords.get(key)
        if not pts:
            continue
        c = _centroid(pts)
        if c is None:
            continue
        label = {
            "backCounter": "back-wall cabinetry/counter",
            "hood": "range hood",
            "island": "kitchen island",
            "sink": "integrated sink",
            "leftCabinet": "left tall cabinet",
            "rightCabinet": "right tall cabinet",
        }.get(key, key)
        lines.append(f"  • {label} is in the {_vert(c[1])} {_horiz(c[0])} of the frame")

    return "\n".join(lines) if lines else None
