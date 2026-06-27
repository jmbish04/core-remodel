#!/usr/bin/env python3
"""
stack_blueprint_floors.py
─────────────────────────
Overlays two surgically-cropped floor plan images, aligning them by
their bottom-left building corners.

The input images should be pre-cropped to just the building footprint
(no title block, no excess margin).  The script:

  1. Detects the bottom-left corner of the building in each image
     (leftmost thick wall + bottommost thick wall).
  2. Aligns both images so their bottom-left corners coincide.
  3. Strips white backgrounds from both.
  4. Tints the background floor blue for visual contrast.
  5. Verifies alignment by checking that left/right/bottom walls overlap.

Outputs:
  upper_over_lower.png  — Upper floor (black) over Lower level (blue)
  lower_over_upper.png  — Lower level (black) over Upper floor (blue)

Usage:
  python stack_blueprint_floors.py
  python stack_blueprint_floors.py --lower path/lower.png --upper path/upper.png
  python stack_blueprint_floors.py --opacity 0.5
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_LOWER = SCRIPT_DIR / "lower_level_surgical.png"
DEFAULT_UPPER = SCRIPT_DIR / "upper_floor_surgical.png"

BG_COLOR = (50, 120, 230)       # blue tint for background floor
BG_OPACITY = 0.70               # opacity of background floor ink
WHITE_THRESHOLD = 220           # brighter than this → transparent
INK_THRESHOLD = 150             # darker than this → ink
ALIGN_TOLERANCE = 15            # px — max allowable wall mismatch


# ──────────────────────────────────────────────────────────────
# Low-level helpers
# ──────────────────────────────────────────────────────────────

def longest_run(arr_bool: np.ndarray) -> int:
    """Longest consecutive True run in a 1-D boolean array."""
    if len(arr_bool) == 0 or not np.any(arr_bool):
        return 0
    padded = np.concatenate(([False], arr_bool, [False]))
    d = np.diff(padded.astype(np.int8))
    starts = np.where(d == 1)[0]
    ends = np.where(d == -1)[0]
    return int(np.max(ends - starts)) if len(starts) > 0 else 0


def total_dark_in_col(gray: np.ndarray, x: int,
                      threshold: int = INK_THRESHOLD) -> int:
    """Count total dark pixels in column x."""
    return int(np.sum(gray[:, x] < threshold))


def total_dark_in_row(gray: np.ndarray, y: int,
                      threshold: int = INK_THRESHOLD) -> int:
    """Count total dark pixels in row y."""
    return int(np.sum(gray[y, :] < threshold))


# ──────────────────────────────────────────────────────────────
# Wall / corner detection
# ──────────────────────────────────────────────────────────────

def find_wall_x(gray: np.ndarray, side: str = "left",
                min_run: int = 80,
                threshold: int = INK_THRESHOLD,
                min_thick: int = 2) -> int:
    """
    Find the X coordinate of an exterior wall.

    For surgically-cropped images the wall is very close to the image edge.
    Looks for a cluster of adjacent columns with long vertical dark runs.
    min_run is lower than the full-sheet version because these crops are
    smaller (~1300px tall).
    """
    h, w = gray.shape

    # Pre-compute longest vertical dark run per column
    col_runs = np.zeros(w, dtype=int)
    for x in range(w):
        col_runs[x] = longest_run(gray[:, x] < threshold)

    if side == "left":
        scan = range(0, min(w // 3, 150))
    else:
        scan = range(w - 1, max(w * 2 // 3, w - 150), -1)

    # Find first cluster of min_thick adjacent qualifying columns
    run_count = 0
    first_x = -1
    for x in scan:
        if col_runs[x] >= min_run:
            if run_count == 0:
                first_x = x
            run_count += 1
            if run_count >= min_thick:
                return first_x if side == "left" else x
        else:
            # Allow 1px gap (scan wobble)
            step = 1 if side == "left" else -1
            nx = x + step
            if 0 <= nx < w and col_runs[nx] >= min_run:
                continue  # gap, keep going
            run_count = 0
            first_x = -1

    # Fallback: first qualifying column
    qual = np.where(col_runs >= min_run)[0]
    if len(qual) > 0:
        return int(qual[0] if side == "left" else qual[-1])

    # Ultra-fallback: first column with significant ink
    for x in (range(w) if side == "left" else range(w - 1, -1, -1)):
        if total_dark_in_col(gray, x, threshold) > h * 0.05:
            return x

    return 0 if side == "left" else w - 1


def find_wall_y(gray: np.ndarray, side: str = "bottom",
                min_run: int = 80,
                threshold: int = INK_THRESHOLD,
                min_thick: int = 2) -> int:
    """
    Find the Y coordinate of an exterior wall (top or bottom).
    Same logic as find_wall_x but for horizontal lines.
    """
    h, w = gray.shape

    row_runs = np.zeros(h, dtype=int)
    for y in range(h):
        row_runs[y] = longest_run(gray[y, :] < threshold)

    if side == "bottom":
        scan = range(h - 1, max(h * 2 // 3, h - 150), -1)
    else:
        scan = range(0, min(h // 3, 150))

    run_count = 0
    first_y = -1
    for y in scan:
        if row_runs[y] >= min_run:
            if run_count == 0:
                first_y = y
            run_count += 1
            if run_count >= min_thick:
                return first_y if side == "bottom" else y
        else:
            step = -1 if side == "bottom" else 1
            ny = y + step
            if 0 <= ny < h and row_runs[ny] >= min_run:
                continue
            run_count = 0
            first_y = -1

    qual = np.where(row_runs >= min_run)[0]
    if len(qual) > 0:
        return int(qual[-1] if side == "bottom" else qual[0])

    for y in (range(h - 1, -1, -1) if side == "bottom" else range(h)):
        if total_dark_in_row(gray, y, threshold) > w * 0.05:
            return y

    return h - 1 if side == "bottom" else 0


def detect_building_corners(img: Image.Image, label: str) -> dict:
    """
    Detect the building's structural walls (left, right, top, bottom).
    Returns a dict with wall positions and corner coordinates.
    """
    gray = np.array(img.convert("L"))
    h, w = gray.shape

    left_x = find_wall_x(gray, "left")
    right_x = find_wall_x(gray, "right")
    top_y = find_wall_y(gray, "top")
    bottom_y = find_wall_y(gray, "bottom")

    info = {
        "left_x": left_x,
        "right_x": right_x,
        "top_y": top_y,
        "bottom_y": bottom_y,
        "width": right_x - left_x,
        "height": bottom_y - top_y,
    }

    print(f"\n  {label} ({w}×{h} px):")
    print(f"    Left wall   X = {left_x}")
    print(f"    Right wall  X = {right_x}")
    print(f"    Top wall    Y = {top_y}")
    print(f"    Bottom wall Y = {bottom_y}")
    print(f"    Building footprint: {info['width']}×{info['height']} px")
    print(f"    Bottom-left corner: ({left_x}, {bottom_y})")
    print(f"    Bottom-right corner: ({right_x}, {bottom_y})")

    return info


# ──────────────────────────────────────────────────────────────
# Image processing
# ──────────────────────────────────────────────────────────────

def strip_white(img: Image.Image,
                threshold: int = WHITE_THRESHOLD) -> Image.Image:
    """Make white/near-white pixels transparent with smooth alpha ramp."""
    arr = np.array(img.convert("RGBA")).copy()
    gray = np.array(img.convert("L"))
    ramp_start = max(0, threshold - 50)
    alpha = np.where(
        gray <= ramp_start, 255,
        np.where(gray >= threshold, 0,
                 ((threshold - gray) / (threshold - ramp_start) * 255)),
    ).astype(np.uint8)
    arr[:, :, 3] = alpha
    return Image.fromarray(arr)


def tint_ink(img: Image.Image, color: tuple[int, int, int],
             opacity: float = 1.0) -> Image.Image:
    """Replace ink pixels with a solid tint color, preserving alpha."""
    arr = np.array(img).copy()
    mask = arr[:, :, 3] > 0
    arr[mask, 0] = color[0]
    arr[mask, 1] = color[1]
    arr[mask, 2] = color[2]
    if opacity < 1.0:
        arr[:, :, 3] = (arr[:, :, 3].astype(float) * opacity
                        ).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


# ──────────────────────────────────────────────────────────────
# Alignment verification
# ──────────────────────────────────────────────────────────────

def verify_alignment(lower: dict, upper: dict, dx: int, dy: int,
                     tolerance: int = ALIGN_TOLERANCE) -> list[tuple]:
    """
    After applying offset (dx, dy) to the upper floor, check that
    structural walls overlap.
    """
    checks = []

    # Left walls
    l_lw = lower["left_x"]
    u_lw = upper["left_x"] + dx
    diff = abs(l_lw - u_lw)
    checks.append(("Left wall X", l_lw, u_lw, diff, diff <= tolerance))

    # Bottom walls
    l_bw = lower["bottom_y"]
    u_bw = upper["bottom_y"] + dy
    diff = abs(l_bw - u_bw)
    checks.append(("Bottom wall Y", l_bw, u_bw, diff, diff <= tolerance))

    # Right walls (may differ due to cantilever)
    l_rw = lower["right_x"]
    u_rw = upper["right_x"] + dx
    diff = abs(l_rw - u_rw)
    right_tol = tolerance + 10  # extra for cantilever
    checks.append(("Right wall X (±cantilever)", l_rw, u_rw, diff,
                    diff <= right_tol))

    # Building width comparison
    l_w = lower["width"]
    u_w = upper["width"]
    diff = abs(l_w - u_w)
    checks.append(("Building width match", l_w, u_w, diff,
                    diff <= right_tol))

    return checks


# ──────────────────────────────────────────────────────────────
# Compositing
# ──────────────────────────────────────────────────────────────

def _place(img: Image.Image, x: int, y: int,
           cw: int, ch: int) -> Image.Image:
    """Place img at (x, y) on a transparent canvas."""
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.paste(img, (x, y), img)
    return canvas


def composite_aligned(
    fg: Image.Image,
    bg: Image.Image,
    fg_corner: tuple[int, int],
    bg_corner: tuple[int, int],
    fg_label: str,
    bg_label: str,
    bg_color: tuple[int, int, int] = BG_COLOR,
    bg_opacity: float = BG_OPACITY,
) -> Image.Image:
    """
    Overlay fg and bg, aligning their bottom-left building corners.

    fg_corner / bg_corner = (left_wall_x, bottom_wall_y) in each image.
    The composite places both images so these corners coincide.
    """
    fg_clear = strip_white(fg)
    bg_clear = strip_white(bg)
    bg_tinted = tint_ink(bg_clear, bg_color, opacity=bg_opacity)

    # Compute placement: align fg_corner with bg_corner
    # Both images placed relative to a common reference point
    fg_ox = max(0, bg_corner[0] - fg_corner[0])
    fg_oy = max(0, bg_corner[1] - fg_corner[1])
    bg_ox = max(0, fg_corner[0] - bg_corner[0])
    bg_oy = max(0, fg_corner[1] - bg_corner[1])

    canvas_w = max(fg_ox + fg.width, bg_ox + bg.width)
    canvas_h = max(fg_oy + fg.height, bg_oy + bg.height)

    canvas = Image.new("RGBA", (canvas_w, canvas_h), (255, 255, 255, 255))
    canvas = Image.alpha_composite(
        canvas, _place(bg_tinted, bg_ox, bg_oy, canvas_w, canvas_h)
    )
    canvas = Image.alpha_composite(
        canvas, _place(fg_clear, fg_ox, fg_oy, canvas_w, canvas_h)
    )

    _add_label(canvas, f"■ {fg_label} (black)  ·  ■ {bg_label} (blue)")
    return canvas


def _add_label(img: Image.Image, text: str) -> None:
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except (OSError, IOError):
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (img.width - tw) // 2
    y = img.height - th - 8
    pad = 5
    draw.rectangle(
        [x - pad, y - pad, x + tw + pad, y + th + pad],
        fill=(255, 255, 255, 220),
    )
    draw.text((x, y), text, fill=(40, 40, 40, 255), font=font)


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Overlay two floor plans aligned by bottom-left corner."
    )
    parser.add_argument("--lower", type=Path, default=DEFAULT_LOWER,
                        help="Lower level (basement) image")
    parser.add_argument("--upper", type=Path, default=DEFAULT_UPPER,
                        help="Upper floor image")
    parser.add_argument("--opacity", type=float, default=BG_OPACITY)
    parser.add_argument("--output-dir", "-o", type=Path, default=None)
    args = parser.parse_args()

    lower_path = args.lower.resolve()
    upper_path = args.upper.resolve()
    for p in [lower_path, upper_path]:
        if not p.exists():
            print(f"Error: {p} not found", file=sys.stderr)
            sys.exit(1)
    out_dir = (args.output_dir or lower_path.parent).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print("━" * 62)
    print("  Blueprint Floor Stacker  (corner-aligned)")
    print("━" * 62)

    # ── 1. Load ──────────────────────────────────────────────
    print("\n▸ Loading images…")
    lower_img = Image.open(lower_path).convert("RGBA")
    upper_img = Image.open(upper_path).convert("RGBA")
    print(f"  Lower: {lower_img.width}×{lower_img.height} ← {lower_path.name}")
    print(f"  Upper: {upper_img.width}×{upper_img.height} ← {upper_path.name}")

    # ── 2. Detect building walls ─────────────────────────────
    print("\n▸ Detecting building walls…")
    lower_info = detect_building_corners(lower_img, "Lower Level")
    upper_info = detect_building_corners(upper_img, "Upper Floor")

    # ── 3. Compute alignment ─────────────────────────────────
    # Align by bottom-left corners:
    #   lower's (left_x, bottom_y)  ↔  upper's (left_x, bottom_y)
    lower_corner = (lower_info["left_x"], lower_info["bottom_y"])
    upper_corner = (upper_info["left_x"], upper_info["bottom_y"])

    dx = lower_corner[0] - upper_corner[0]
    dy = lower_corner[1] - upper_corner[1]

    print(f"\n▸ Alignment:")
    print(f"  Lower bottom-left: {lower_corner}")
    print(f"  Upper bottom-left: {upper_corner}")
    print(f"  Offset to align upper→lower: dx={dx}, dy={dy}")

    # ── 4. Verify ────────────────────────────────────────────
    print("\n▸ Verification:")
    checks = verify_alignment(lower_info, upper_info, dx, dy)

    all_pass = True
    for name, lower_val, upper_val, diff, passed in checks:
        status = "✓ PASS" if passed else "✗ FAIL"
        if not passed:
            all_pass = False
        print(f"  {status}  {name}: "
              f"lower={lower_val}, upper(aligned)={upper_val}, "
              f"Δ={diff}px (tol={ALIGN_TOLERANCE}px)")

    if all_pass:
        print("\n  ✅  All alignment checks PASSED")
    else:
        print("\n  ⚠️  Some checks FAILED — review wall positions")

    # ── 5. Composite ─────────────────────────────────────────
    print("\n▸ Compositing: Upper over Lower…")
    upper_over = composite_aligned(
        fg=upper_img, bg=lower_img,
        fg_corner=upper_corner, bg_corner=lower_corner,
        fg_label="Upper Floor", bg_label="Lower Level",
        bg_opacity=args.opacity,
    )
    p1 = out_dir / "upper_over_lower.png"
    upper_over.convert("RGB").save(p1, dpi=(150, 150))
    print(f"  {upper_over.width}×{upper_over.height} → {p1.name}")

    print("\n▸ Compositing: Lower over Upper…")
    lower_over = composite_aligned(
        fg=lower_img, bg=upper_img,
        fg_corner=lower_corner, bg_corner=upper_corner,
        fg_label="Lower Level", bg_label="Upper Floor",
        bg_opacity=args.opacity,
    )
    p2 = out_dir / "lower_over_upper.png"
    lower_over.convert("RGB").save(p2, dpi=(150, 150))
    print(f"  {lower_over.width}×{lower_over.height} → {p2.name}")

    # ── Summary ──────────────────────────────────────────────
    status = "✅ ALIGNED" if all_pass else "⚠️ REVIEW"
    print(f"\n{'━' * 62}")
    print(f"  Done!  ({status}  dx={dx}, dy={dy})")
    print(f"    1. {p1}")
    print(f"    2. {p2}")
    print("━" * 62)


if __name__ == "__main__":
    main()
