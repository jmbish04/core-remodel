"""Binary inpainting masks + FLUX box_2d from NORMALIZED coordinate polygons.

Coordinates in ai_photo_coordinates.json are normalized (x, y in 0..1), so we scale
by the working image's pixel dimensions before drawing. Mask convention: WHITE (255)
= the edit zone (union of the requested regions); BLACK = frozen / preserved. This is
the FLUX fill convention (white = redraw). Returns PNG bytes.
"""
import io

from PIL import Image, ImageDraw


def _poly_px(points, width, height):
    return [(float(p["x"]) * width, float(p["y"]) * height) for p in points]


def build_mask(coords, region_keys, width, height):
    """Union of the given polygon regions drawn white on black. PNG bytes, or None if empty."""
    if not coords:
        return None
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    drew = False
    for key in region_keys:
        pts = coords.get(key) or []
        if isinstance(pts, list) and len(pts) >= 3 and isinstance(pts[0], dict):
            draw.polygon(_poly_px(pts, width, height), fill=255)
            drew = True
    if not drew:
        return None
    buf = io.BytesIO()
    mask.save(buf, "PNG")
    return buf.getvalue()


def box_2d(coords, key):
    """FLUX-normalized [ymin, xmin, ymax, xmax] (0-1000) for a polygon, or None."""
    pts = (coords or {}).get(key) or []
    if not (isinstance(pts, list) and pts and isinstance(pts[0], dict)):
        return None
    xs = [float(p["x"]) for p in pts]
    ys = [float(p["y"]) for p in pts]
    return [
        int(min(ys) * 1000),
        int(min(xs) * 1000),
        int(max(ys) * 1000),
        int(max(xs) * 1000),
    ]
