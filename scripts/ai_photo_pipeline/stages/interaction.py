"""Stage 4 (interaction): conversational micro-edits for sink/fixture positioning.

Uses a model that understands spatial relationships natively (per
STAGE_MODELS["interaction"], default Fal / nano-banana-pro/edit). Feeds the CLEAN
stage-3 output.
"""

import os

from .. import config
from ..providers import dispatch, ref, save_image


def intent(image_filename=None, coordinates=None):
    """Stage 4 intent: conversational micro-edits for sink/fixture positioning."""
    corrections = []

    if coordinates and image_filename:
        img_coords = coordinates.get(image_filename, {})

        sink_pts = img_coords.get("sink", [])
        if sink_pts:
            avg_x = sum(p["x"] for p in sink_pts) / len(sink_pts)
            side = "RIGHT" if avg_x > 0.5 else "LEFT"
            corrections.append(
                f"Ensure the integrated sink with black and brass spring-neck faucet "
                f"is at the {side} end of the island, closest to the windows."
            )

        right_cab = img_coords.get("rightCabinet", [])
        if right_cab:
            max_x = max(p["x"] for p in right_cab)
            if max_x > 0.9:
                corrections.append(
                    "Floor-to-ceiling cabinet on the far right must be flush with "
                    "the bay window box — no gap, no overlap."
                )

    if not corrections:
        corrections = [
            "Ensure the sink is at the window end of the island.",
            "Ensure the tall cabinet nearest the bay window is flush with the window box.",
        ]

    correction_text = " ".join(corrections)
    return {
        "user_request": (
            f"{correction_text} "
            f"Add three evenly spaced brass and smoked-glass pendant lights hanging from "
            f"the ceiling directly above the island. Add two dark green wall sconces mounted "
            f"above the marble shelf on either side of the range hood."
        ),
        "edit_location": "Island (sink end), ceiling above island (pendants), back wall above shelf (sconces).",
        "extra_guidelines": (
            "Micro-edit pass: make ONLY the specific changes requested. Do NOT alter the "
            "cabinetry finish, countertop material, flooring, walls, or overall room geometry."
        ),
    }


def run(stem, filename, finish_bytes, env):
    """Conversational micro-edits (sink, fixtures). Returns the interaction render bytes."""
    interaction_refs = [
        r for r in [
            ref(config.FAUCET_IMAGE, "faucet"),
            ref(config.ISLAND_LIGHT_IMAGE, "island pendant"),
            ref(config.BACK_WALL_SCONCE_IMAGE, "wall sconce"),
        ] if r
    ]
    s4_intent = intent(filename, env.get("coordinates", {}))
    interaction_img = dispatch("interaction", s4_intent, finish_bytes, interaction_refs, env)
    save_image(interaction_img, os.path.join(env["output_dir"], f"stage4_interaction_{stem}.png"))
    return interaction_img
