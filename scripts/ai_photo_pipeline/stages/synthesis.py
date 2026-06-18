"""Stage 5 (synthesis): blend reference material images into the render.

Uses a multi-image edit model (per STAGE_MODELS["synthesis"], default Fal /
flux-2-pro/edit) with @image indexed syntax: @image1 = working render,
@image2+ = references. Feeds the CLEAN stage-4 output.
"""

import os

from .. import config
from ..providers import dispatch, ref, save_image


def intent():
    """Stage 5 intent: blend reference material images into the render.

    Flux 2 Pro Edit uses @image indexed syntax:
      @image1 = working render, @image2+ = references
    """
    return {
        "user_request": (
            "Blend the reference materials into the kitchen render for maximum photorealism. "
            "@image1 is the current kitchen render. "
            "Use the faucet style from @image2 for the island sink faucet. "
            "Use the pendant light design from @image3 for the three island pendants. "
            "Use the wall sconce style from @image4 for the two sconces flanking the hood. "
            "Maintain the exact same room geometry, cabinetry layout, marble veining, "
            "and flooring from @image1. Only update the specific fixtures."
        ),
    }


def run(stem, interaction_bytes, env):
    """Reference image blending (@image indexed). Returns the synthesis render bytes."""
    synthesis_refs = [
        r for r in [
            ref(config.FAUCET_IMAGE, "faucet"),
            ref(config.ISLAND_LIGHT_IMAGE, "island pendant"),
            ref(config.BACK_WALL_SCONCE_IMAGE, "wall sconce"),
        ] if r
    ]
    synthesis_img = dispatch("synthesis", intent(), interaction_bytes, synthesis_refs, env)
    save_image(synthesis_img, os.path.join(env["output_dir"], f"stage5_synthesis_{stem}.png"))
    return synthesis_img
