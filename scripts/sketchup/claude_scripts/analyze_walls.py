#!/usr/bin/env python3
"""
analyze_walls.py — wall-uniformity auditor for the Colby St SketchUp model.

Pipeline:
    1. (optional) run the Ruby extractor inside SketchUp to refresh the JSON
       snapshot of every group's global bounding box.
    2. read that JSON, classify the wall-like groups, and FLAG any that are
       not uniform in depth (thickness) or height, plus misalignments,
       floor-pokes, and dangling ends (a dangling end = a likely MISSING wall).

The extractor is `extract_walls.rb` (writes sketchup_diagnostics.json). There is
no headless SketchUp on macOS, so Python can only "run" it when a live bridge
(supex / mhyrr) is connected — otherwise it prints the one-line Ruby Console
command and waits for the file. See CLAUDE_DRIVES_SKETCHUP.md.

Usage:
    python3 analyze_walls.py                      # analyze existing JSON
    python3 analyze_walls.py --extract            # try to run the extractor first
    python3 analyze_walls.py --json other.json    # analyze a specific snapshot
    python3 analyze_walls.py --out report.json    # also write machine-readable flags
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import NamedTuple

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_JSON = os.path.join(HERE, "sketchup_diagnostics.json")
EXTRACTOR_RB = os.path.join(HERE, "ruby_scripts", "extract_walls.rb")

# ---- House standards (inches) -------------------------------------------------
STD_EXTERIOR_THICK = 6.5
STD_INTERIOR_THICKS = (4.5, 3.5, 5.0)
THICK_TOL = 0.35              # how close counts as "matching" a standard
LOWER_TOPS = (96.0, 116.0, 120.0)   # acceptable lower-level wall tops
UPPER_TOP = 216.0                   # full upper-level wall top
FLOOR_PLANES = (96.0, 120.0)        # finished-floor elevations a wall must not pierce
GAP_TOL = 5.0                # endpoints closer than this are "connected"
DANGLE_MIN = 6.0             # ignore micro-walls when checking dangling ends

# groups that are not architectural walls (skip them entirely). NOTE: structural
# dividers ARE walls and must stay in, or they create false "dangling" reports.
SKIP_SUBSTR = ("MEP", "Water -", "Plumbing", "Backyard", "Door -", "Modern Gate",
               "Site -", "Electrical", "lbl:", "Note -", "Wishlist", "House Numbers",
               "Slider", "Garage Door Panel", "Pivot Front Door", "Bath Fixtures",
               "Appliances", "Induction", "Cabinet", "Island", "Vanity", "Toilet",
               "Shower", "Niche", "Skylight", "Window", "Lookbook", "Staircase")


class Wall(NamedTuple):
    path: str
    short: str
    x0: float
    x1: float
    y0: float
    y1: float
    z0: float
    z1: float
    thick: float
    axis: str     # "X" or "Y" — the direction the wall runs
    level: str    # "lower" or "upper"
    ext: bool


class Flag(NamedTuple):
    severity: str
    wall: str
    kind: str
    detail: str
    path: str


def load(path):
    with open(path) as f:
        return json.load(f)


def bb(o):
    x, y, z = o["x_bounds"], o["y_bounds"], o["z_bounds"]
    return (x["min"], x["max"], y["min"], y["max"], z["min"], z["max"])


def is_wall(o) -> bool:
    if any(s in o["path"] for s in SKIP_SUBSTR):
        return False
    x0, x1, y0, y1, z0, z1 = bb(o)
    w, d, h = x1 - x0, y1 - y0, z1 - z0
    thin, long = min(w, d), max(w, d)
    return thin <= 8.0 and h >= 60.0 and long >= 18.0 and long > thin * 2


def classify(o) -> Wall:
    x0, x1, y0, y1, z0, z1 = bb(o)
    w, d = x1 - x0, y1 - y0
    return Wall(path=o["path"], short=o["path"].split("> ")[-1],
                x0=x0, x1=x1, y0=y0, y1=y1, z0=z0, z1=z1,
                thick=round(min(w, d), 2), axis=("Y" if d > w else "X"),
                level=("lower" if z0 <= 24.0 else "upper"),
                ext=("Exterior" in o["path"]))


def near_any(v, opts, tol) -> bool:
    return any(abs(v - o) <= tol for o in opts)


def analyze(objs):
    walls = [classify(o) for o in objs if is_wall(o)]
    flags: list[Flag] = []

    def flag(sev, w: Wall, kind, msg):
        flags.append(Flag(sev, w.short, kind, msg, w.path))

    # Elevations shared by >=2 walls are treated as intentional datums, not pokes.
    tops = [w.z1 for w in walls]
    shared_tops = {t for t in tops if sum(1 for u in tops if abs(u - t) <= 1.0) >= 2}
    standard_tops = set(LOWER_TOPS) | {UPPER_TOP} | shared_tops

    # 1) DEPTH / THICKNESS uniformity --------------------------------------
    for w in walls:
        if w.ext:
            if abs(w.thick - STD_EXTERIOR_THICK) > THICK_TOL:
                flag("HIGH", w, "thickness",
                     f'exterior wall is {w.thick}" thick; house standard is '
                     f'{STD_EXTERIOR_THICK}" (off by {round(w.thick - STD_EXTERIOR_THICK, 2)}")')
        elif not near_any(w.thick, STD_INTERIOR_THICKS, THICK_TOL):
            flag("LOW", w, "thickness",
                 f'interior wall is {w.thick}"; not a standard interior thickness '
                 f'{STD_INTERIOR_THICKS}')

    # 2) HEIGHT uniformity + floor-poke ------------------------------------
    for w in walls:
        if w.level == "lower":
            if not near_any(w.z1, standard_tops, 1.5):
                pierced = [p for p in FLOOR_PLANES if w.z0 < p - 1 < w.z1]
                if pierced:
                    flag("HIGH", w, "floor-poke",
                         f'rises z {w.z0:.0f}->{w.z1:.0f}, piercing the {pierced[0]:.0f}" '
                         f'floor plane by {w.z1 - pierced[0]:.0f}" (stops mid-air, '
                         f'not at a floor/ceiling)')
                else:
                    flag("MED", w, "height",
                         f'lower wall top z={w.z1:.1f} is not a standard elevation')
        elif abs(w.z1 - UPPER_TOP) > 1.5 and not near_any(w.z1, shared_tops, 1.5):
            flag("LOW", w, "height",
                 f'upper wall top z={w.z1:.1f}; expected {UPPER_TOP:.0f}')

    # 3) EXTERIOR inner-face vs nearest INTERIOR face (the right-wall gap) --
    all_x1 = max((w.x1 for w in walls), default=0.0)
    all_x0 = min((w.x0 for w in walls), default=0.0)
    for w in walls:
        if not (w.ext and w.axis == "Y"):
            continue
        # the interior boundary is set by ANY interior wall (cross-walls run in X)
        # whose y-span overlaps this exterior wall.
        def yover(u: Wall) -> bool:
            return u.y0 < w.y1 and u.y1 > w.y0
        if abs(w.x1 - all_x1) < 1.0:          # right-side wall: inner face = x0
            inner = w.x0
            cands = [u.x1 for u in walls if not u.ext and yover(u) and u.x1 <= inner + 0.1]
            side = "right"
        elif abs(w.x0 - all_x0) < 1.0:        # left-side wall: inner face = x1
            inner = w.x1
            cands = [u.x0 for u in walls if not u.ext and yover(u) and u.x0 >= inner - 0.1]
            side = "left"
        else:
            continue
        if not cands:
            continue
        build = max(cands) if side == "right" else min(cands)
        gap = abs(inner - build)
        if gap > 1.0:
            flag("HIGH", w, "gap-to-interior",
                 f'{side} wall inner face x={inner:.1f} sits {gap:.1f}" off the '
                 f'interior build line x={build:.1f} — continuous void behind the interior')

    # 4) DANGLING ENDS => candidate MISSING walls --------------------------
    # Perimeter is the INTERIOR envelope; an interior wall ending on it is fine.
    lower = [w for w in walls if w.level == "lower"]
    interior_lower = [w for w in lower if not w.ext]
    if interior_lower:
        PX0 = min(w.x0 for w in interior_lower); PX1 = max(w.x1 for w in interior_lower)
        PY0 = min(w.y0 for w in interior_lower); PY1 = max(w.y1 for w in interior_lower)

        def connected(px, py, exclude: Wall) -> bool:
            if (abs(px - PX0) <= GAP_TOL or abs(px - PX1) <= GAP_TOL or
                    abs(py - PY0) <= GAP_TOL or abs(py - PY1) <= GAP_TOL):
                return True
            for o in lower:
                if o is exclude:
                    continue
                if (o.x0 - GAP_TOL <= px <= o.x1 + GAP_TOL and
                        o.y0 - GAP_TOL <= py <= o.y1 + GAP_TOL):
                    return True
            return False

        for w in interior_lower:      # missing-wall candidates are interior walls
            if (w.x1 - w.x0) + (w.y1 - w.y0) < DANGLE_MIN:
                continue
            cx, cy = (w.x0 + w.x1) / 2.0, (w.y0 + w.y1) / 2.0
            ends = ([(cx, w.y0, "south"), (cx, w.y1, "north")] if w.axis == "Y"
                    else [(w.x0, cy, "west"), (w.x1, cy, "east")])
            for ex, ey, label in ends:
                if not connected(ex, ey, w):
                    flag("HIGH", w, "dangling-end/missing-wall",
                         f'{label} end at (x={ex:.1f}, y={ey:.1f}) connects to nothing '
                         f'— wall line stops here; likely a missing segment')

    return walls, flags


def run_extractor() -> bool:
    if not os.path.exists(EXTRACTOR_RB):
        print(f"[extract] {EXTRACTOR_RB} not found; skipping.", file=sys.stderr)
        return False
    supex = shutil.which("supex")               # only possible with a live bridge
    if supex:
        print(f"[extract] running via supex bridge: {EXTRACTOR_RB}")
        try:
            subprocess.run([supex, "eval_ruby_file", EXTRACTOR_RB], check=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"[extract] supex call failed: {e}", file=sys.stderr)
            return False
    print("[extract] No live SketchUp bridge on PATH (supex/mhyrr).")
    print("[extract] Run this in SketchUp's Ruby Console, then re-run without --extract:")
    print(f"            load '{EXTRACTOR_RB}'")
    return False


SEV_ORDER = {"HIGH": 0, "MED": 1, "LOW": 2}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", default=DEFAULT_JSON, help="snapshot to analyze")
    ap.add_argument("--extract", action="store_true",
                    help="run the Ruby extractor first (needs a live bridge)")
    ap.add_argument("--out", help="also write flags as JSON to this path")
    args = ap.parse_args()

    if args.extract:
        run_extractor()

    if not os.path.exists(args.json):
        print(f"ERROR: {args.json} not found. Run the extractor first.", file=sys.stderr)
        sys.exit(1)

    data = load(args.json)
    walls, flags = analyze(data["objects"])
    flags = sorted(flags, key=lambda f: (SEV_ORDER[f.severity], f.kind))

    print(f"\nWall audit of '{data.get('model_name', '?')}'  "
          f"({data.get('export_time', '?')})")
    print(f"  classified {len(walls)} wall-like groups; {len(flags)} flag(s)\n")
    if not flags:
        print("  no uniformity problems detected.")
    last = None
    for f in flags:
        if f.severity != last:
            print(f"  -- {f.severity} --")
            last = f.severity
        print(f"  [{f.kind}] {f.wall}")
        print(f"        {f.detail}")

    if args.out:
        with open(args.out, "w") as fh:
            json.dump({"model": data.get("model_name"),
                       "flags": [f._asdict() for f in flags]}, fh, indent=2)
        print(f"\n  wrote {args.out}")


if __name__ == "__main__":
    main()
