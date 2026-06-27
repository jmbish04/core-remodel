"""Design configuration tokens, reference image filenames, and per-stage model selection.

ASSETS STAY PUT: ``base_dir`` points at the existing proofs/.../ai_renders directory
where ``blank_images/``, the reference images, ``ai_prompt.md``,
``ai_photo_coordinates.json``, and ``nano_bannana_output/`` live.
"""

import os

# =====================================================================
# DESIGN CONFIGURATION TOKENS (reused from the proven script)
# =====================================================================
# Override with AI_RENDERS_BASE_DIR for portability across machines.
base_dir = os.environ.get(
    "AI_RENDERS_BASE_DIR",
    "/Volumes/Projects/workers/core-remodel/proofs/tight/jason_20260615/upper_level/kitchen/ai_renders",
)

FLOOR_INSTRUCTIONS = "dark wide-plank engineered wood flooring"
WALL_FINISH = "clean white drywall plaster finish"
CABINET_COLOR = "walnut"
COUNTERTOP_COLOR = "Calacatta marble with heavy, dramatic purple and burgundy veining"

# Reference images (material/form only). Filenames live in base_dir.
FLOOR_IMAGE = "flooring_2.jpeg"
CABINET_IMAGE = "cabinet_color.jpg"
COUNTERTOP_REFERENCE_IMAGE = "island.jpg"
FAUCET_IMAGE = "faucet.jpg"
ISLAND_LIGHT_IMAGE = "lighting_wooden_lantern.jpeg"
BACK_WALL_SCONCE_IMAGE = "lights_back_wall_sconces.png"

# Optional per-room design context appended to the mood board prompt.
MOOD_BOARD_DESIGN_CONTEXT = (
    f"Kitchen palette: {CABINET_COLOR} cabinetry, {COUNTERTOP_COLOR}, "
    f"{FLOOR_INSTRUCTIONS}, brass and smoked-glass pendants, dark green sconces."
)

# =====================================================================
# PER-STAGE MODEL SELECTION  (flip a value to A/B test a provider)
#   provider one of: "gemini" (default + proven), "fal", "replicate", "openai"
# =====================================================================
STAGE_MODELS = {
    "base": "fal",            # bria/fibo-edit/edit — structured JSON constraints for floor/paint
    "rough_in": "fal",        # flux-pro/v1/fill — surgical masked inpaint from coordinate polygons
    "finish": "fal",          # flux-pro/kontext/max — enterprise-tier photorealism
    "interaction": "fal",     # nano-banana-pro/edit — conversational micro-edits
    "synthesis": "fal",       # flux-2-pro/edit — multi-image reference blending
    "moodboard": "gemini",    # gemini-3-pro-image — mood board collage
}

GEMINI_MODEL = "gemini-3-pro-image"

# Direct-host alternates (this is a local harness, not the Worker, so direct is fine).
# Slugs verified against fal.ai + replicate.com API docs (2026-06-18).
FAL_MODELS = {
    "base": "bria/fibo-edit/edit",           # structured JSON + instruction
    "rough_in": "fal-ai/flux-pro/v1/fill",   # masked surgical inpaint (white = edit zone)
    "finish": "fal-ai/flux-pro/kontext/max",  # enterprise-tier realism
    "interaction": "fal-ai/nano-banana-pro/edit",  # conversational micro-edits
    "synthesis": "fal-ai/flux-2-pro/edit",    # multi-image blending (up to 9)
}
REPLICATE_MODELS = {
    # flux-depth-pro is GENERATIVE depth-conditioned (prompt + control_image -> image that
    # follows the room's 3D structure). It re-renders the WHOLE frame; it does NOT freeze
    # regions like the masked fill path above. It is BFL's FLUX.1 Depth [pro] — NOT Apple's
    # "Depth Pro" estimator. Alternate for rough_in: set STAGE_MODELS["rough_in"] = "replicate".
    "rough_in": "black-forest-labs/flux-depth-pro",
    "finish": "black-forest-labs/flux-kontext-max",
}

# OpenAI image edit — GPT image models (default gpt-image-1.5) + legacy dall-e-2.
# Set any stage to "openai" in STAGE_MODELS to A/B test; switch a value to "dall-e-2"
# for the legacy model (single square PNG, prompt <= 1000 chars).
OPENAI_MODELS = {
    "base": "gpt-image-1.5",
    "rough_in": "gpt-image-1.5",
    "finish": "gpt-image-1.5",
    "interaction": "gpt-image-1.5",
    "synthesis": "gpt-image-1.5",
    "moodboard": "gpt-image-1.5",
}

# Mood board prompt — VERBATIM (per-room context is appended at call time).
MOOD_BOARD_PROMPT = (
    "CREATE A PHOTOGRAPH OF AN INTERIOR DESIGN MOOD BOARD THAT INCORPORATES ELEMENTS "
    "FROM ALL THE UPLOADED IMAGES. THE MOOD BOARD SHOULD BE ORGANIZED, THOUGHT OUT, AND "
    "CRAFTED LIKE A PROFESSIONAL INTERIOR DESIGN MOOD BOARD FLATLAY FOR DESIGN PURPOSES. "
    "MINIMALLY OVERLAP ELEMENTS WHEN APPLICABLE AND USE DESIGN TECHNIQUES LIKE COLLAGING "
    "AND TRANSPARENCY. WHITE BACKGROUND. DO NOT INCLUDE ANY TEXT."
)
