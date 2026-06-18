"""Mood board: interior-design flatlay from the final render + key references.

Uses the verbatim MOOD_BOARD_PROMPT with the per-room design context appended.
Provider per STAGE_MODELS["moodboard"] (default: Gemini 3 Pro Image).
"""

import os

from .. import config
from ..providers import dispatch, ref, save_image


def moodboard_references():
    """Key references for the mood board, scoped to material/form."""
    candidates = [
        (config.CABINET_IMAGE, "cabinetry finish"),
        (config.COUNTERTOP_REFERENCE_IMAGE, "island marble"),
        (config.FLOOR_IMAGE, "floor material"),
        (config.FAUCET_IMAGE, "faucet"),
        (config.ISLAND_LIGHT_IMAGE, "island pendant"),
        (config.BACK_WALL_SCONCE_IMAGE, "wall sconce"),
    ]
    return [r for r in (ref(f, lbl) for f, lbl in candidates) if r]


def intent():
    """Mood board intent: verbatim prompt + per-room design context appended."""
    return {
        "user_request": f"{config.MOOD_BOARD_PROMPT}\n\n{config.MOOD_BOARD_DESIGN_CONTEXT}",
    }


def run(stem, synthesis_bytes, env):
    """Interior-design flatlay collage. Returns the mood board image bytes."""
    moodboard_img = dispatch("moodboard", intent(), synthesis_bytes,
                             moodboard_references(), env)
    save_image(moodboard_img, os.path.join(env["output_dir"], f"moodboard_{stem}.png"))
    return moodboard_img
