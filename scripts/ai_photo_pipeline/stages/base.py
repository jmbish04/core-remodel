"""Stage 1 (base): set floor material + wall paint on the CLEAN blank canvas.

Provider per STAGE_MODELS["base"] (default: Fal / Bria FIBO Edit).
"""

import os

from .. import config
from ..providers import dispatch, ref, save_image


def intent():
    """Stage 1 intent: floor + wall materials on the clean blank canvas."""
    return {
        "user_request": (
            f"Set the floor to {config.FLOOR_INSTRUCTIONS}. "
            f"Paint every wall with a {config.WALL_FINISH}. "
            f"Do not add any cabinetry, island, fixtures, furniture, or decor."
        ),
        "edit_location": "The entire room's floor surface and wall surfaces.",
    }


def run(stem, source_bytes, env):
    """Floor + wall paint on the clean blank canvas. Returns the base render bytes."""
    references = [r for r in [ref(config.FLOOR_IMAGE, "floor material")] if r]
    base_img = dispatch("base", intent(), source_bytes, references, env)
    save_image(base_img, os.path.join(env["output_dir"], f"stage1_base_{stem}.png"))
    return base_img
