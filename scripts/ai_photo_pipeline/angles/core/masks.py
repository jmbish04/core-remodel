"""Mask generation and coordinate helpers for the camera-angle photo pipeline."""
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw

from .constants import OUTPUT_JSON, BLANK_IMAGES_DIR, MASK_OUTPUT_DIR


def build_masks_from_json(
    json_path: Path | str = OUTPUT_JSON,
    images_dir: Path | str = BLANK_IMAGES_DIR,
    output_dir: Path | str = MASK_OUTPUT_DIR,
) -> dict[str, dict[str, bytes | str]]:
    """Generate per-object binary mask PNGs from ``angles_mask_data.json``.

    Saves masks to *output_dir* and returns
    ``{img_name: {obj_key: mask_bytes | "not_visible"}}``.
    """
    json_path = Path(json_path)
    images_dir = Path(images_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(json_path) as f:
        data = json.load(f)

    result: dict[str, dict[str, bytes | str]] = {}
    for img_name, objects in data.items():
        img_path = images_dir / img_name
        if not img_path.exists():
            print(f"  SKIP {img_name}: image not found")
            continue
        with Image.open(img_path) as img:
            w, h = img.size

        result[img_name] = {}
        for obj_key, obj_data in objects.items():
            if obj_data == "not_visible":
                result[img_name][obj_key] = "not_visible"
                continue
            if not isinstance(obj_data, list) or len(obj_data) < 3:
                continue

            mask = Image.new("L", (w, h), 0)
            draw = ImageDraw.Draw(mask)
            pts = [(pt["x"] * w, pt["y"] * h) for pt in obj_data]
            draw.polygon(pts, fill=255)

            # Save to disk
            stem = Path(img_name).stem
            mask_path = output_dir / f"{stem}_{obj_key}_mask.png"
            mask.save(mask_path)

            buf = io.BytesIO()
            mask.save(buf, "PNG")
            result[img_name][obj_key] = buf.getvalue()

    print(f"✓ Masks written to {output_dir}/")
    return result


def get_normalized_point(cx: float, cy: float, off_x: float, off_y: float, scale: float, img_w: int, img_h: int) -> dict:
    """Helper to convert screen coordinates to normalized coordinates (0 to 1)."""
    ix = (cx - off_x) / scale
    iy = (cy - off_y) / scale
    return {
        "x": round(max(0.0, min(1.0, ix / img_w)), 4),
        "y": round(max(0.0, min(1.0, iy / img_h)), 4),
    }
