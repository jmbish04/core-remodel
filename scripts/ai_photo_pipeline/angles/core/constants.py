"""Constants and configuration settings for the camera-angle photo pipeline."""
from pathlib import Path

# ── Paths ───────────────────────────────────────────────────────────────────

# This file is in angles/core/constants.py, so parent.parent is angles/
SCRIPT_DIR = Path(__file__).resolve().parent.parent
BLANK_IMAGES_DIR = SCRIPT_DIR / "blank_images"
FLOORPLAN_PATH = Path(
    "/Volumes/Projects/workers/core-remodel/proofs/tight/draft_canvas/"
    "upper_level_floorplan_canvas_v5_cams.jpg"
)
OUTPUT_JSON = SCRIPT_DIR / "angles_mask_data.json"
MASK_OUTPUT_DIR = SCRIPT_DIR / "generated_masks"
EDIT_OUTPUT_DIR = SCRIPT_DIR / "edited_renders"

# ── Gemini Model Tiers ──────────────────────────────────────────────────────

MODEL_EDIT = "gemini-3.1-flash-image"   # primary edit model
MODEL_PRO = "gemini-3-pro-image"        # high-fidelity / 4K / thinking
MODEL_FAST = "gemini-2.5-flash"          # analysis-only (segmentation, JSON)

# Default output resolution. The interactions API accepts: "1K", "2K", "4K".
DEFAULT_IMAGE_SIZE = "2K"

# ── Reference Images for Multi-Ref Editing ──────────────────────────────────

_INSPO_BASE = Path(
    "/Volumes/Projects/workers/core-remodel/proofs/tight/jason_20260615/"
    "upper_level/kitchen/ai_renders/inspo_for_ai_rendering/use_these"
)

REFERENCE_IMAGES: list[tuple[Path, str, list[str]]] = [
    (_INSPO_BASE.parent / "dark_flooring" / "IMG_9097.jpeg",
     "deep espresso-colored engineered hardwood flooring. Planks are 9.5\" wide, featuring a prominent, slightly textured grain pattern matching the 'Pluto' sample (SKU: E-MW-OWID-P5). The surface has a soft, matte reflection consistent with a UV Lacquer finish.", []),
    (_INSPO_BASE / "cabinet_color.jpg",
     "natural, non-shiny, matte-finish walnut cabinetry finish", ["back_countertop"]),
    (_INSPO_BASE / "island.jpg",
     "Calacatta Viola marble with dramatic and complex purple-red veining pattern",
     ["kitchen_island"]),
    (_INSPO_BASE / "faucet.jpg",
     "gooseneck brass faucet", ["kitchen_island"]),
    (_INSPO_BASE / "lighting_wooden_lantern.jpeg",
     "wooden lantern pendant light", ["kitchen_island", "dining_table"]),
    (_INSPO_BASE / "RH_BARDOT_BURL_DINING_TABLE.jpeg",
     "Bardot Burl 60\" round dining table", ["dining_table"]),
    (_INSPO_BASE / "CB2_ODYSSEY_BRASS.jpeg",
     "Odyssey brass chandelier", ["dining_table"]),
    (_INSPO_BASE / "lunar/dekton_lunar_detail.jpg",
     "Dekton Luna material detail (honed white stone with subtle warm grey veining)",
     ["back_countertop"]),
    (_INSPO_BASE / "lunar/slab.jpeg",
     "Dekton Luna slab view showing grain distribution",
     ["back_countertop"]),
    (_INSPO_BASE / "lunar/3dslab.png",
     "Dekton Luna 3D view showing corner profile and texture",
     ["back_countertop"]),
    (_INSPO_BASE / "cafe_oven.png",
     "Cafe CTS70DP2NS1 30-inch wide stainless steel single wall oven with a prominent horizontal handle, large black glass window, and top digital screen",
     ["back_countertop"]),
]

# ── Per-Object Detailed Edit Instructions ───────────────────────────────────

OBJECT_EDIT_INSTRUCTIONS: dict[str, str] = {
    "flooring": (
        "Replace the existing flooring with deep espresso-colored engineered hardwood flooring. "
        "The planks are 9.5\" wide, featuring a prominent, slightly textured grain pattern matching the 'Pluto' sample (SKU: E-MW-OWID-P5). "
        "The surface has a soft, matte reflection consistent with a UV Lacquer finish. "
        "The flooring planks must strictly align with and follow the perspective lines of the existing flooring shown in the base image. "
        "For camera 1 & 2: they must run from the foreground toward the background windows, receding along the room's main perspective vanishing lines. "
        "For camera 3, 4, & 5: they must run toward the stair pony wall, aligned with the room's perspective lines. "
        "The planks must NEVER run at a diagonal 45-degree angle or skewed direction relative to the room's natural perspective lines."
    ),
    "kitchen_island": (
        "An architectural rendering of the sculptural kitchen island from the reference image (island.jpg). "
        "The monolithic island, carved from Calacatta Viola marble with its dramatic and complex purple-red veining pattern, "
        "retains its unique organic shape with highly rounded, soft edges and complex curved leg structure. "
        "There must be no walnut or wood material visible anywhere on the kitchen island; all drawers, doors, fronts, sides, "
        "legs, and surfaces are carved entirely from Calacatta Viola marble to create a seamless, monolithic stone appearance. "
        "The island must run parallel to the long back wall counter (do not orient it facing the stairs or facing the bay window). "
        "The front side of the island (the side facing the living room and visible under the curved structure) must be a single, continuous, seamless slab of Calacatta Viola marble with absolutely no cuts, panel lines, drawers, cabinets, or hardware. "
        "The only time the island should show any cuts or panel lines for drawers or cabinet doors is on the back side of the island directly facing the back wall cabinets. "
        "The integrated sink (with gooseneck brass faucet) must be located at the end of the island closest to the box bay window; "
        "if the box bay window is not visible in the camera view, place the sink on the end closest to the camera. "
        "The entire top surface of the marble is clean, empty except for the sink at the end near the box bay window, "
        "and perfectly smooth, with all objects (vase, bowls, stovetop, pitcher) completely removed, showcasing only the "
        "unbroken marble grain. It is set in the same sunlit kitchen environment with the large windows, walnut wood paneling "
        "on the back counter, and wood floor. Add two wooden lantern pendant lights hanging above the island at equal spacing."
    ),
    "back_countertop": (
        "Install a full back counter and cabinetry system along the wall following this exact sequence, "
        "starting from the right side at the box bay window and moving to the left:\n"
        "- First, a 36\" wide floor-to-ceiling single panel cabinet on the far right by the box bay window.\n"
        "- Next, a section of Dekton Luna countertop and backsplash with walnut upper cabinets above (matching the other cabinetry). These upper cabinets connect the two flanking 36\" floor-to-ceiling cabinets.\n"
        "- Next, a 36\" wide floor-to-ceiling double door cabinet.\n"
        "- Next, another section of Dekton Luna countertop and backsplash (the second counter to the far left). This backsplash turns into a horizontal shelf. Above this shelf, there is plain drywall (no upper cabinets). The lower section has walnut cabinet drawers matching the style of the drawers on the right cabinet side.\n"
        "- Next, a 12\" wide floor-to-ceiling cabinet.\n"
        "- The left side of the 12\" floor-to-ceiling cabinet terminates flush against the existing pony wall.\n"
        "Ensure all cabinets (including lower and upper cabinets) are made of natural, non-shiny, matte-finish walnut. "
        "Every cabinet door and drawer must be completely flush with no handles, no hardware, and no visible finger pulls. "
        "The cooking range is an Invisacook system, which is fully hidden beneath the stone countertop. "
        "There must be absolutely NO visible cooktop, NO glass burners, NO induction hubs, NO stove burners, and NO range controls on or above the countertop. "
        "The entire surface of the Dekton Luna countertop is a single, continuous, completely smooth, unbroken stone surface with nothing placed on top, showcasing a perfectly clean and empty countertop. "
        "The oven is a Cafe CTS70DP2NS1 30-inch wide stainless steel single wall oven, built flush and centered in the lower cabinet structure beneath the right-side countertop. It features a modern stainless steel front, a wide horizontal handle with copper-accented end caps, a large black glass viewing window, and a prominent top LCD touch screen control panel. "
        "All countertops and backsplashes are Dekton Luna. The entire layout fits perfectly along the wall structure, keeping original perspective lines."
    ),
    "dining_table": (
        "Place a dining table setup in the dining area. The table must be exactly the RH Bardot Burl 60\" round dining table as shown in the reference image (RH_BARDOT_BURL_DINING_TABLE.jpeg) with exactly 4 dining chairs matching the table's aesthetic. "
        "The dining table must appear in the 5ft area near the living room window (not the box bay window). "
        "DO NOT add any ceiling lights, pendant lights, or chandelier above the dining table. The ceiling above the dining table must remain completely empty and untouched."
    ),
    "living_room_couch": (
        "Place a modern L-shaped sectional sofa in a solid camel color with absolutely NO pillows and no other furniture or rugs. "
        "The sofa must be pushed to the far right of the living room, opposite the 2-panel living room window. "
        "The back of the sectional sofa must face toward the kitchen area, with the couch facing toward the TV hung on the wall. "
        "The sofa must be positioned exactly where the mask is drawn and not placed in the center of the room."
    ),
    "living_room_tv": (
        "Mount a large, thin flat-screen TV directly on the wall in front of the couch (the living room exterior wall). "
        "DO NOT add any TV console, media cabinet, shelves, or any furniture underneath or around the TV. Just hang the TV itself on the wall. "
        "DO NOT add any walls or dividers separating the living room and dining room. The wall should remain open, and the TV is simply hung flat on the existing wall."
    ),
}

# ── Object Palette for Tkinter Frontend ─────────────────────────────────────

OBJECTS: list[tuple[str, str, str]] = [
    ("kitchen_island",    "Kitchen Island",    "#FF6B6B"),
    ("back_countertop",   "Back Countertop",   "#4ECDC4"),
    ("dining_table",      "Dining Table",      "#45B7D1"),
    ("living_room_couch", "Living Room Couch",  "#96CEB4"),
    ("living_room_tv",    "Living Room TV",     "#FFEAA7"),
]

# ── Display Constants ───────────────────────────────────────────────────────

MAX_CANVAS_W = 1200
MAX_CANVAS_H = 800
FLOORPLAN_SIDEBAR_W = 360
POINT_RADIUS = 5
LINE_WIDTH = 2

# ── Structure-Preservation Guardrails ───────────────────────────────────────

PRESERVATION_BLOCK = "\n".join([
    "- PRESERVE EXACTLY (do not change in any way): the flooring (its material, deep espresso color, "
    "9.5\" wide planks running parallel to the island and countertops and walls from left to right, and matte finish), "
    "every wall and wall color, all windows and their grids, all openings, the ceiling, the room's dimensions and proportions, and the camera angle.",
    "- The flooring planks must run strictly from left to right, parallel to the island, counters, and walls, and never be pictured running at an angle.",
    "- Do NOT invent, move, widen, or close any wall, window, or opening.",
    "- Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio — the output "
    "framing must match the input one-to-one.",
    "- Do NOT add any furniture, rugs, decor, plants, or props that are not explicitly requested.",
    "- Everything outside the immediate edit area must remain identical to the original.",
    "- Do NOT add, modify, or touch any ceiling lights, recessed canned lights, or any light "
    "fixtures unless explicitly requested in the prompt. The ceiling must remain completely untouched.",
    "- Do NOT add any wall lights, wall sconces, or any light fixtures on the walls. All walls must remain completely free of new lighting fixtures.",
    "- Do NOT add any electrical panels, wall outlets, switches, or utility boxes anywhere.",
    "- All cabinet doors and drawers must be entirely flush with no handles, no hardware, no visible finger pulls, "
    "and no face frames of any kind.",
    "- Do NOT invent or add any unrequested furniture, beds, decor, plants, or props in the background or "
    "adjacent rooms. Keep the background rooms exactly as they appear in the original blank canvas.",
    "- Everything outside the immediate masked edit area must remain pixel-identical to the original blank canvas.",
])
