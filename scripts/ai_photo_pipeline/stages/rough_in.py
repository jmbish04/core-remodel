"""Stage 2 (rough-in): place cabinetry/island/fixtures, feeding the CLEAN stage-1 output.

Structure-only pass (plain neutral materials), with per-image spatial context.
Provider per STAGE_MODELS["rough_in"] (default: Replicate / flux-depth-pro).
"""

import io
import os

from PIL import Image

from .. import masks
from ..context import describe_spatial_anchor
from ..providers import dispatch, save_image


def intent(image_filename=None, per_image_prompts=None, coordinates=None):
    """Stage 2 intent: rough-in cabinet/island placement with per-image spatial context."""
    # Rich per-image description from ai_prompt.md
    image_context = None
    if per_image_prompts and image_filename:
        image_context = per_image_prompts.get(image_filename)

    spatial_anchor = None
    if coordinates and image_filename:
        img_coords = coordinates.get(image_filename)
        if img_coords:
            spatial_anchor = describe_spatial_anchor(img_coords)

    if image_context:
        user_request = (
            f"Install the kitchen's structure on this room exactly as described below. "
            f"Structure-only pass — use plain neutral materials. "
            f"Cabinets are flat-front, NO handles or hardware. "
            f"Tall pantry cabinets are single normal-width doors.\n\n"
            f"DESIGN INTENT:\n{image_context}\n\n"
            f"CRITICAL SPATIAL RULES:\n"
            f"- Cabinetry MUST be flush against the existing walls.\n"
            f"- Island must be parallel to the long wall, not angled.\n"
            f"- Floor-to-ceiling cabinet on the window side MUST be flush with the bay window box.\n"
            f"- Integrated sink at the end of the island closest to the windows.\n"
            f"- Keep everything square and true to the room's real walls, floor, and ceiling."
        )
    else:
        user_request = (
            "Install kitchen structure: built-in cabinetry along the back wall, "
            "range hood centered on back wall, kitchen island parallel to the long wall. "
            "Flat-front cabinets, NO handles/hardware. Tall cabinet nearest the bay window "
            "must be flush with the window box. Sink at the window end of the island."
        )

    edit_location = "The long wall (cabinetry + hood) and the open floor area (island)."
    if spatial_anchor:
        edit_location += f"\nSpatial reference:\n{spatial_anchor}"

    return {
        "user_request": user_request,
        "edit_location": edit_location,
        "extra_guidelines": (
            "Structure-preserving pass: establish correct FORMS and placement only. "
            "Use plain neutral materials (finishes come in a later pass). "
            "Do NOT change the room's architecture — preserve ALL walls, windows, "
            "openings, and ceiling exactly as they appear."
        ),
    }


def run(stem, filename, base_bytes, env):
    """Surgical, mask-locked cabinet/island placement. Returns the rough-in render bytes.

    Builds a binary mask + box_2d layout hints from the manual polygons in
    ai_photo_coordinates.json so the fill model freezes everything outside the
    cabinet/island footprints (true surgical inpainting).
    """
    coords = (env.get("coordinates", {}) or {}).get(filename) or {}
    s2_intent = intent(filename, env.get("per_image_prompts", {}), env.get("coordinates", {}))

    mask_bytes = None
    if coords:
        width, height = Image.open(io.BytesIO(base_bytes)).size
        zone_keys = ["leftCabinet", "rightCabinet", "backCounter", "hood", "island", "sink"]
        mask_bytes = masks.build_mask(coords, zone_keys, width, height)
        boxes = []
        for key, label in (
            ("leftCabinet", "tall left cabinet"),
            ("rightCabinet", "tall right cabinet"),
            ("backCounter", "back-wall counter + upper cabinets"),
            ("hood", "range hood"),
            ("island", "kitchen island"),
            ("sink", "integrated sink"),
        ):
            box = masks.box_2d(coords, key)
            if box:
                boxes.append(f"[box_2d={box}] {label}")
        if boxes:
            s2_intent["user_request"] += (
                "\n\nLAYOUT BOXES (normalized 0-1000 [ymin,xmin,ymax,xmax]):\n" + "\n".join(boxes)
            )

    roughin_img = dispatch("rough_in", s2_intent, base_bytes, None, env, mask=mask_bytes)
    save_image(roughin_img, os.path.join(env["output_dir"], f"stage2_roughin_{stem}.png"))
    return roughin_img
