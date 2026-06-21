"""Stage 3 (finish): high-fidelity finishes, feeding the CLEAN stage-2 output.

Premium materials + lighting on the existing cabinetry/island, with per-image sink
placement awareness. Provider per STAGE_MODELS["finish"] (default: Fal / flux-pro/kontext/max).
"""

import os

from .. import config
from ..providers import dispatch, ref, save_image


def intent(image_filename=None, coordinates=None):
    """Stage 3 intent: high-fidelity finishes + materials."""
    # Determine sink-side phrasing from coordinates
    sink_location = "at the end of the island closest to the windows"
    if coordinates and image_filename:
        img_coords = coordinates.get(image_filename, {})
        sink_pts = img_coords.get("sink", [])
        if sink_pts:
            avg_x = sum(p["x"] for p in sink_pts) / len(sink_pts)
            if avg_x < 0.4:
                sink_location = "on the LEFT end of the island (closest to the windows)"
            elif avg_x > 0.6:
                sink_location = "on the RIGHT end of the island (closest to the windows)"

    return {
        "user_request": (
            f"Apply premium finishes to the existing cabinetry and island: "
            f"back-wall cabinetry in warm natural {config.CABINET_COLOR} wood finish with beautiful "
            f"grain, NO handles/hardware; countertops, backsplash, shelf, and a monolithic "
            f"waterfall-edge island all in {config.COUNTERTOP_COLOR}; range hood in {config.WALL_FINISH} "
            f"matching the walls. Integrated sink with black and brass spring-neck faucet "
            f"positioned {sink_location}."
        ),
        "edit_location": "The cabinetry, countertops, island, and range hood already in the scene.",
        "extra_guidelines": (
            "Finish pass: high-end photographic realism with natural lighting, soft ambient "
            "shadows, and realistic reflections. Do not move or resize any existing element. "
            "Floor-to-ceiling cabinet on the window side must remain flush with the bay window box."
        ),
        "references": [
            r for r in [
                ref(config.CABINET_IMAGE, "cabinetry finish"),
                ref(config.COUNTERTOP_REFERENCE_IMAGE, "island marble"),
            ] if r
        ],
    }


def run(stem, filename, roughin_bytes, env):
    """High-fidelity materials + lighting. Returns the finish render bytes."""
    finish_refs = [
        r for r in [
            ref(config.CABINET_IMAGE, "cabinetry finish"),
            ref(config.COUNTERTOP_REFERENCE_IMAGE, "island marble"),
        ] if r
    ]
    s3_intent = intent(filename, env.get("coordinates", {}))
    finish_img = dispatch("finish", s3_intent, roughin_bytes, finish_refs, env)
    save_image(finish_img, os.path.join(env["output_dir"], f"stage3_finish_{stem}.png"))
    return finish_img
