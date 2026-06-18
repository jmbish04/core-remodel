"""Output framing / resolution control.

gemini-3.x image models default to ~1K and will silently re-frame the scene
(crop / zoom / rotate to portrait) unless an explicit image_config is supplied.
Pinning the aspect ratio + size to the source keeps edits in control.
"""

import io

from google.genai import types
from PIL import Image

OUTPUT_IMAGE_SIZE = "2K"
SUPPORTED_ASPECT_RATIOS = {
    "1:1": 1.0, "2:3": 2 / 3, "3:2": 3 / 2, "3:4": 3 / 4, "4:3": 4 / 3,
    "4:5": 4 / 5, "5:4": 5 / 4, "9:16": 9 / 16, "16:9": 16 / 9, "21:9": 21 / 9,
}


def nearest_aspect_ratio(width, height):
    """Return the Gemini-supported aspect-ratio string closest to the source image."""
    ratio = width / height
    return min(SUPPORTED_ASPECT_RATIOS.items(), key=lambda kv: abs(kv[1] - ratio))[0]


def build_generation_config(aspect_ratio):
    """GenerateContentConfig that pins output framing + resolution for image edits."""
    return types.GenerateContentConfig(
        response_modalities=["Image"],
        image_config=types.ImageConfig(
            aspect_ratio=aspect_ratio,
            image_size=OUTPUT_IMAGE_SIZE,
        ),
    )


def aspect_ratio_for(image_bytes):
    """Nearest supported aspect ratio for an in-memory image."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        return nearest_aspect_ratio(img.width, img.height)
