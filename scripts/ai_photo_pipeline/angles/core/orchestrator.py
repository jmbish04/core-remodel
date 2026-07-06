"""Execution and orchestration pipelines for the camera-angle photo pipeline."""
import base64
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Literal, cast, Any
from PIL import Image

from ai_photo_pipeline import config
from ai_photo_pipeline import secrets
from ai_photo_pipeline.providers.fal import fal_run
from ai_photo_pipeline.providers.replicate import replicate_run
from ai_photo_pipeline.providers.openai import openai_edit
from ai_photo_pipeline.providers.gemini import edit_with_references

from .constants import (
    BLANK_IMAGES_DIR,
    OUTPUT_JSON,
    EDIT_OUTPUT_DIR,
    MODEL_EDIT,
    MODEL_FAST,
    DEFAULT_IMAGE_SIZE,
    REFERENCE_IMAGES,
    OBJECT_EDIT_INSTRUCTIONS,
    OBJECTS,
    PRESERVATION_BLOCK,
)
from .masks import build_masks_from_json


def generate_session_phrase() -> str:
    """Generate a random phrase for the output session folder."""
    import random
    adjectives = [
        "sculptural", "monolithic", "luminous", "velvet", "espresso", "walnut",
        "serene", "dramatic", "warm", "diffused", "organic", "modern", "vintage",
        "classic", "rustic", "minimal", "sleek", "textured", "boucle", "polished"
    ]
    nouns = [
        "island", "countertop", "table", "sofa", "credenza", "chandelier", "sconce",
        "cabinet", "faucet", "floor", "lounge", "kitchen", "canvas", "render",
        "perspective", "shadow", "marble", "burl", "brass", "wood"
    ]
    return f"{random.choice(adjectives)}-{random.choice(nouns)}"


def build_edit_prompt(
    instruction: str,
    *,
    mask_image: bytes | None = None,
    obj_key: str | None = None,
    image_path: Path | None = None,
) -> str:
    """Preservation-aware, step-by-step edit prompt.

    Applies Gemini best practices:
    - **Hyper-specific**: detailed material/form/dimension descriptions.
    - **Step-by-step**: breaks the edit into ordered sub-tasks.
    - **Semantic negative prompts**: describes the intended scene positively
      rather than listing negatives.
    - **Camera control**: photographic language for composition.
    - **Context & intent**: explains *why* the edit is being made.
    """
    # Parse camera number dynamically (defaults to "1" if not found)
    cam_num = "1"
    if image_path:
        m = re.search(r'\d+', Path(image_path).name)
        if m:
            cam_num = m.group(0)

    # Prefer the hyper-specific instruction if available
    detailed = OBJECT_EDIT_INSTRUCTIONS.get(obj_key or "", "")
    edit_text = detailed if detailed else instruction

    if obj_key == "flooring":
        if cam_num in ("1", "2"):
            direction_desc = "run from the foreground toward the background windows, receding along the room's main perspective vanishing lines"
        else:
            direction_desc = "run toward the stair pony wall, aligned with the room's perspective lines"
        
        edit_text = (
            "Replace the existing flooring with deep espresso-colored engineered hardwood flooring. "
            "The planks are 9.5\" wide, featuring a prominent, slightly textured grain pattern matching the 'Pluto' sample (SKU: E-MW-OWID-P5). "
            "The surface has a soft, matte reflection consistent with a UV Lacquer finish. "
            f"The flooring planks must strictly align with and follow the perspective lines of the existing flooring shown in the base image, meaning they {direction_desc}. "
            "The planks must NEVER run at a diagonal 45-degree angle or skewed direction relative to the room's natural perspective lines. "
            "The pattern and direction of the planks must match the original flooring's alignment exactly."
        )

    # 1. Base preservation list (dynamic window grids and language)
    if obj_key == "flooring":
        if cam_num in ("1", "2"):
            preserve_line = (
                "- PRESERVE EXACTLY (do not change in any way): every wall and wall color, all windows and their grids, "
                "all openings, the ceiling, the room's dimensions and proportions, and the camera angle."
            )
            structure_line = "- Do NOT invent, move, widen, or close any wall, window, or opening."
        else:
            preserve_line = (
                "- PRESERVE EXACTLY (do not change in any way): every wall and wall color, all openings, the ceiling, "
                "the room's dimensions and proportions, and the camera angle."
            )
            structure_line = "- Do NOT invent, move, widen, or close any wall or opening."
        flooring_preservation_line = ""
    else:
        if cam_num in ("1", "2"):
            preserve_line = (
                "- PRESERVE EXACTLY (do not change in any way): the flooring (its material, deep espresso color, "
                "9.5\" wide planks running parallel to the island and countertops and walls from left to right, and matte finish), "
                "every wall and wall color, all windows and their grids, all openings, the ceiling, the room's dimensions and proportions, and the camera angle."
            )
            structure_line = "- Do NOT invent, move, widen, or close any wall, window, or opening."
        else:
            preserve_line = (
                "- PRESERVE EXACTLY (do not change in any way): the flooring (its material, deep espresso color, "
                "9.5\" wide planks running parallel to the island and countertops and walls from left to right, and matte finish), "
                "every wall and wall color, all openings, the ceiling, the room's dimensions and proportions, and the camera angle."
            )
            structure_line = "- Do NOT invent, move, widen, or close any wall or opening."
        flooring_preservation_line = "- The flooring planks must run strictly from left to right, parallel to the island, counters, and walls, and never be pictured running at an angle.\n"

    # 2. Pony wall rules for cameras 3, 4, 5
    pony_wall_block = ""
    if cam_num in ("3", "4", "5"):
        pony_wall_block = (
            "- The pony wall is visible. You must NEVER render, generate, or add anything to the left of the pony wall, "
            "and you must NEVER render, generate, or place anything in the open area above or behind the pony wall. "
            "Keep the entire area to the left, above, and behind the pony wall completely empty, blank, and untouched exactly as shown in the original image.\n"
        )

    # Assemble local preservation block as a clean multiline string block
    local_preservation_block = f"""{preserve_line}
{flooring_preservation_line}{structure_line}
{pony_wall_block}- Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio — the output framing must match the input one-to-one.
- Do NOT add any furniture, rugs, decor, plants, or props that are not explicitly requested.
- Everything outside the immediate edit area must remain identical to the original.
- Do NOT add, modify, or touch any ceiling lights, recessed canned lights, or any light fixtures unless explicitly requested in the prompt. The ceiling must remain completely untouched.
- Do NOT add any wall lights, wall sconces, or any light fixtures on the walls. All walls must remain completely free of new lighting fixtures.
- Do NOT add any electrical panels, wall outlets, switches, or utility boxes anywhere.
- All cabinet doors and drawers must be entirely flush with no handles, no hardware, no visible finger pulls, and no face frames of any kind.
- Do NOT invent or add any unrequested furniture, beds, decor, plants, or props in the background or adjacent rooms. Keep the background rooms exactly as they appear in the original blank canvas.
- Everything outside the immediate masked edit area must remain pixel-identical to the provided input image."""

    mask_block = ""
    if mask_image is not None:
        mask_block = """
Step 4 — Mask discipline:
  The second image provided is a pixel-for-pixel binary mask. The white pixels (value 255) indicate the EXACT region of the first image where the new object must be composited. 
  The black pixels (value 0) indicate areas that MUST NOT be changed in any way and must remain 100% pixel-identical to the provided input image. 
  Do NOT move the object or place it on any other wall, area, or room. It must be constrained and placed strictly inside the white mask boundary, blending seamlessly at the edges."""

    return f"""You are an expert architectural photo editor performing a localised, photorealistic edit on the provided room image.

Context & intent: This is a blank-canvas photo of a room undergoing a modern remodel. The goal is to visualise the final design for the homeowner by compositing furniture and fixtures into the empty space.

Step 1 — Understand the space:
  Study the room's architecture, lighting direction, vanishing points, and material textures. The camera angle is FIXED — do not change it.

Step 2 — Place the element:
  {edit_text}

Step 3 — Preserve everything else:
  {local_preservation_block}
{mask_block}

Step 5 — Quality control & Common sense checks:
  The edit must be photorealistic and blend seamlessly. Match the room's existing diffused lighting, perspective lines, and shadow direction.
  The floor, walls, windows, ceiling, and all openings must remain pixel-identical to the original.
  You MUST verify the layout against these strict common sense rules:
  - The back countertops and cabinets must run perfectly flat against a wall, parallel to the flooring lines, and never be at a diagonal or angle of any kind. Countertops should never be placed on anything other than a blank wall, and must never be placed in front of windows or in front of egress or walking areas (blocking walking egress).
  - The kitchen island must run perfectly parallel to the flooring planks and back countertops (if a countertop is present), and never run at any angle or diagonal. The island must always be the exact same shape and look of the reference island image (a curved rectangular block with highly rounded ends); if the island ever looks like anything other than a curved rectangular block, it is incorrect.
  - The cabinets/cabinetry must never be broken into two pieces shown on two different walls facing two different directions.
  - The pendant lights above the kitchen island must be placed directly over the island, running in the exact same direction as the island. The lights must never run east-to-west if the island is running north-to-south (or vice versa); they must be aligned perfectly with the island.
  - A television must NEVER be generated or placed on the same wall as the kitchen countertops, cabinets, or island.
  - The television must hang flat on a blank, clean drywall wall with no cabinets or countertops anywhere on that wall.
  - The couch must face directly toward the wall-mounted television and the back of the couch should be pointing away from the tv and towards the kitchen so that if someone were sitting on the couch they would be facing forward looking at the TV and if someone were standing behind the island in the kitchen facing the tv, they would see the back of someones head sitting on the couch.
  - No windows may be generated, rendered, or added that are not already present in the starter blank canvas image. Adding phantom windows is strictly prohibited.
  - If the input image is in violation of any of these common sense rules, or if your planned render would violate them, you MUST abort the generation immediately and output ONLY this text block: "ERROR: COMMON_SENSE_VIOLATION - [write here a detailed explanation of which rule was violated and why]"

Output: return ONLY the final edited image. If aborting, output ONLY the text starting with: "ERROR: COMMON_SENSE_VIOLATION - [reason]"."""


def parse_models(model_str: str) -> list[dict]:
    """Parse comma-separated model/shorthand/provider string into configuration objects."""
    parts = [p.strip() for p in model_str.split(",") if p.strip()]
    configs = []

    expanded_parts = []
    for p in parts:
        if p.lower() in ("all", "both"):
            expanded_parts.extend(["gemini", "openai", "fal", "replicate"])
        else:
            expanded_parts.append(p)

    for p in expanded_parts:
        if ":" in p:
            prov, model_name = p.split(":", 1)
            prov = prov.strip().lower()
            model_name = model_name.strip()
            if prov not in ("gemini", "openai", "fal", "replicate"):
                print(f"ERROR: Unknown provider '{prov}' in '{p}'")
                sys.exit(1)
            label = f"{prov}_{model_name.replace('/', '_').replace(':', '_')}"
            configs.append({
                "provider": prov,
                "model": model_name,
                "label": label
            })
        else:
            p_lower = p.lower()
            if p_lower == "gemini":
                configs.append({
                    "provider": "gemini",
                    "model": "gemini-3.1-flash-image",
                    "label": "gemini"
                })
            elif p_lower in ("gemini-pro-3", "gemini-pro", "gemini-3-pro-image"):
                configs.append({
                    "provider": "gemini",
                    "model": config.GEMINI_MODEL,
                    "label": "gemini_pro"
                })
            elif p_lower == "openai":
                configs.append({
                    "provider": "openai",
                    "model": "gpt-image-2",
                    "label": "openai"
                })
            elif p_lower in ("gpt-image-latest", "gpt-image-2", "gpt-image-1.5", "chatgpt-image-latest", "dall-e-2"):
                configs.append({
                    "provider": "openai",
                    "model": p,
                    "label": f"openai_{p}"
                })
            elif p_lower == "fal":
                configs.append({
                    "provider": "fal",
                    "model": None,
                    "label": "fal"
                })
            elif p_lower in ("flux", "flux-pro"):
                configs.append({
                    "provider": "fal",
                    "model": config.FAL_MODELS["finish"],
                    "label": "flux_pro"
                })
            elif p_lower == "replicate":
                configs.append({
                    "provider": "replicate",
                    "model": None,
                    "label": "replicate"
                })
            elif p_lower in ("flux-depth-pro", "flux-kontext-max"):
                model_name = config.REPLICATE_MODELS.get("finish")
                if "depth" in p_lower:
                    model_name = config.REPLICATE_MODELS.get("rough_in")
                configs.append({
                    "provider": "replicate",
                    "model": model_name,
                    "label": f"replicate_{p_lower}"
                })
            else:
                if "gemini" in p_lower:
                    configs.append({"provider": "gemini", "model": p, "label": f"gemini_{p}"})
                elif "gpt" in p_lower or "openai" in p_lower or "dall-e" in p_lower:
                    configs.append({"provider": "openai", "model": p, "label": f"openai_{p}"})
                elif "fal" in p_lower:
                    configs.append({"provider": "fal", "model": p, "label": f"fal_{p}"})
                elif "replicate" in p_lower or "flux" in p_lower or "black-forest" in p_lower:
                    configs.append({"provider": "replicate", "model": p, "label": f"replicate_{p}"})
                else:
                    print(f"ERROR: Could not resolve provider for model/shorthand: '{p}'")
                    sys.exit(1)
    return configs


def edit_for_config(
    c: dict,
    image_path: Path,
    obj_key: str,
    mask_bytes: bytes | None,
    image_bytes: bytes,
    image_size: str,
    env: dict
) -> tuple[bytes | None, str | None, str]:
    """Dispatch the edit to the configured provider runner."""
    provider = c["provider"]
    model_name = c["model"]

    if model_name is None:
        if provider == "fal":
            model_name = config.FAL_MODELS.get(obj_key) or config.FAL_MODELS["finish"]
        elif provider == "replicate":
            model_name = config.REPLICATE_MODELS.get(obj_key) or config.REPLICATE_MODELS["finish"]
        elif provider == "openai":
            model_name = config.OPENAI_MODELS.get(obj_key) or config.OPENAI_MODELS["finish"]
        elif provider == "gemini":
            model_name = config.GEMINI_MODEL

    if provider == "gemini":
        result_bytes, thinking, prompt_run = edit_with_references(
            image_path, obj_key, mask_bytes,
            image_size=image_size, model=model_name,
            image_bytes=image_bytes,
            reference_images=REFERENCE_IMAGES,
            object_edit_instructions=OBJECT_EDIT_INSTRUCTIONS,
            build_edit_prompt_fn=build_edit_prompt,
        )
        return result_bytes, thinking, prompt_run

    elif provider == "openai":
        prompt_run = build_edit_prompt(
            OBJECT_EDIT_INSTRUCTIONS.get(obj_key, f"Place {obj_key.replace('_', ' ')} here."),
            mask_image=mask_bytes,
            obj_key=obj_key,
            image_path=image_path,
        )

        references = []
        for ref_path, ref_label, applies_to in REFERENCE_IMAGES:
            if not ref_path.exists():
                continue
            if applies_to and obj_key not in applies_to:
                continue
            references.append((ref_path, ref_label))

        try:
            result_bytes = openai_edit(
                model=model_name,
                prompt=prompt_run,
                image_bytes=image_bytes,
                references=references,
                env=env,
                mask=mask_bytes,
            )
            return result_bytes, None, prompt_run
        except Exception as e:
            print(f"│  ✗ OpenAI API failed: {e}")
            return None, None, prompt_run

    elif provider == "fal":
        stage_intent = {
            "user_request": OBJECT_EDIT_INSTRUCTIONS.get(obj_key, f"Place {obj_key.replace('_', ' ')} here."),
            "edit_location": obj_key,
            "extra_guidelines": "",
        }
        from ai_photo_pipeline.providers.dispatch import format_prompt
        prompt_run = format_prompt("fal", model_name, stage_intent)

        references = []
        for ref_path, ref_label, applies_to in REFERENCE_IMAGES:
            if not ref_path.exists():
                continue
            if applies_to and obj_key not in applies_to:
                continue
            references.append((ref_path, ref_label))

        try:
            result_bytes = fal_run(
                model=model_name,
                prompt=prompt_run,
                image_bytes=image_bytes,
                references=references,
                env=env,
                mask=mask_bytes,
            )
            return result_bytes, None, prompt_run
        except Exception as e:
            print(f"│  ✗ [Fal] API failed: {e}")
            return None, None, prompt_run

    elif provider == "replicate":
        stage_intent = {
            "user_request": OBJECT_EDIT_INSTRUCTIONS.get(obj_key, f"Place {obj_key.replace('_', ' ')} here."),
            "edit_location": obj_key,
            "extra_guidelines": "",
        }
        from ai_photo_pipeline.providers.dispatch import format_prompt
        prompt_run = format_prompt("replicate", model_name, stage_intent)

        references = []
        for ref_path, ref_label, applies_to in REFERENCE_IMAGES:
            if not ref_path.exists():
                continue
            if applies_to and obj_key not in applies_to:
                continue
            references.append((ref_path, ref_label))

        try:
            result_bytes = replicate_run(
                model=model_name,
                prompt=prompt_run,
                image_bytes=image_bytes,
                references=references,
                env=env,
                mask=mask_bytes,
            )
            return result_bytes, None, prompt_run
        except Exception as e:
            print(f"│  ✗ [Replicate] API failed: {e}")
            return None, None, prompt_run

    else:
        raise ValueError(f"Unknown provider: {provider}")


def execute_edits(
    *,
    image_size: str = DEFAULT_IMAGE_SIZE,
    resolved_configs: list[dict],
    demo_cam: int | None = None,
):
    """Load saved mask data and run the edit pipeline on every image."""
    if not OUTPUT_JSON.exists():
        print(f"ERROR: {OUTPUT_JSON} not found. Run the mask-drawing GUI first.")
        sys.exit(1)

    env = {}
    active_providers = {c["provider"] for c in resolved_configs}

    if "gemini" in active_providers:
        gemini_key = secrets.get_gemini_api_key()
        if not gemini_key:
            print("ERROR: GEMINI_API_KEY is not set. Set it via env or 'tokens set GEMINI_API_KEY'.")
            sys.exit(1)
        env["gemini_api_key"] = gemini_key
        from google import genai
        env["gemini_client"] = genai.Client(api_key=gemini_key)

    if "openai" in active_providers:
        openai_key = secrets.get_openai_key()
        if not openai_key:
            print("ERROR: OPENAI_API_KEY is not set. Set it via env or 'tokens set OPENAI_API_KEY'.")
            sys.exit(1)
        env["openai_key"] = openai_key

    if "fal" in active_providers:
        fal_key = secrets.get_fal_key()
        if not fal_key:
            print("ERROR: FAL_API_KEY is not set. Set it via env or 'tokens set FAL_API_KEY'.")
            sys.exit(1)
        env["fal_key"] = fal_key

    if "replicate" in active_providers:
        rep_token = secrets.get_replicate_token()
        if not rep_token:
            print("ERROR: REPLICATE_API_TOKEN is not set. Set it via env or 'tokens set REPLICATE_API_TOKEN'.")
            sys.exit(1)
        env["replicate_token"] = rep_token

    session_phrase = generate_session_phrase()
    if demo_cam is not None:
        session_phrase = f"demo_{session_phrase}"
    session_dir = EDIT_OUTPUT_DIR / session_phrase
    session_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'═' * 60}")
    print(f"  EXECUTING MASKED EDITS")
    print(f"  Resolution: {image_size}")
    print(f"  Active Providers/Models:")
    for c in resolved_configs:
        print(f"    • {c['label']} ({c['provider']}: {c['model'] or 'config default'})")
    print(f"  Demo Camera: {demo_cam if demo_cam is not None else 'All'}")
    print(f"  Session Phrase: {session_phrase}")
    print(f"  Output Folder:  {session_phrase}/")
    print(f"{'═' * 60}\n")

    masks_by_image = build_masks_from_json()

    for img_name, objects in masks_by_image.items():
        img_path = BLANK_IMAGES_DIR / img_name
        if not img_path.exists():
            continue

        stem = Path(img_name).stem
        m = re.search(r'\d+', stem)
        cam_num_str = m.group(0) if m else "1"
        cam_num = int(cam_num_str)

        if demo_cam is not None and cam_num != demo_cam:
            continue

        cam_dir = session_dir / f"cam_{cam_num}"
        cam_dir.mkdir(parents=True, exist_ok=True)

        for c in resolved_configs:
            sub_dir = cam_dir / c["label"]
            sub_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n┌─ {img_name} (cam_{cam_num})")

        original_bytes = img_path.read_bytes()
        model_bytes = {c["label"]: original_bytes for c in resolved_configs}
        model_thoughts = {c["label"]: {} for c in resolved_configs}
        has_any_output = {c["label"]: False for c in resolved_configs}
        aborted_camera = False

        # Step 1: Change the flooring first
        print(f"│  🖌  Changing flooring…")
        input_photo_name = img_name

        for c in resolved_configs:
            label = c["label"]
            if aborted_camera:
                continue

            try:
                result_bytes, thinking, prompt_run = edit_for_config(
                    c=c,
                    image_path=img_path,
                    obj_key="flooring",
                    mask_bytes=None,
                    image_bytes=model_bytes[label],
                    image_size=image_size,
                    env=env
                )

                if thinking and "ABORTED due to Common Sense Violation" in thinking:
                    print(f"│  🛑 Common Sense Violation detected by Gemini: {thinking}")
                    print(f"│  🛑 Aborting all edits for {img_name}!")
                    model_thoughts[label]["flooring"] = {
                        "prompt": prompt_run,
                        "input_photo": input_photo_name,
                        "output_photo": None,
                        "thinking": thinking
                    }
                    aborted_camera = True
                    continue

                if result_bytes:
                    out_path = cam_dir / label / f"{stem}_flooring.png"
                    out_path.write_bytes(result_bytes)
                    print(f"│  ✓ [{label}] Saved step → {out_path.relative_to(session_dir.parent)}")
                    model_bytes[label] = result_bytes
                    has_any_output[label] = True

                    model_thoughts[label]["flooring"] = {
                        "prompt": prompt_run,
                        "input_photo": input_photo_name,
                        "output_photo": out_path.name,
                        "thinking": thinking
                    }
                else:
                    print(f"│  ✗ [{label}] Flooring edit returned no image")
                    model_thoughts[label]["flooring"] = {
                        "prompt": prompt_run,
                        "input_photo": input_photo_name,
                        "output_photo": None,
                        "thinking": thinking
                    }

                if thinking:
                    print(f"│  💭 [{label}] Thinking Process:")
                    for line in thinking.splitlines():
                        print(f"│     {line}")

            except ValueError as exc:
                if "Aborting session" in str(exc):
                    print(f"│  🛑 Common Sense Violation detected by Gemini: {exc}")
                    print(f"│  🛑 Aborting all edits for {img_name}!")
                    model_thoughts[label]["flooring"] = {
                        "prompt": None,
                        "input_photo": input_photo_name,
                        "output_photo": None,
                        "thinking": f"ABORTED due to Common Sense Violation: {exc}"
                    }
                    aborted_camera = True
            except Exception as exc:
                print(f"│  ✗ [{label}] Flooring edit failed: {exc}")

        if not aborted_camera:
            ordered_keys = ["back_countertop", "kitchen_island", "dining_table", "living_room_tv", "living_room_couch"]
            for obj_key in ordered_keys:
                if obj_key not in objects:
                    continue
                mask_data = objects[obj_key]
                if mask_data == "not_visible":
                    print(f"│  ⊘ {obj_key}: not visible — skipping")
                    continue
                if not isinstance(mask_data, bytes):
                    print(f"│  ⚠ {obj_key}: no valid mask — skipping")
                    continue

                obj_label = next((l for k, l, _ in OBJECTS if k == obj_key), obj_key)
                print(f"│  🖌  Editing: {obj_label}…")

                for c in resolved_configs:
                    label = c["label"]
                    if aborted_camera:
                        continue

                    input_name = img_name
                    if obj_key == "back_countertop":
                        test_path = cam_dir / label / f"{stem}_flooring.png"
                        if test_path.exists():
                            input_name = test_path.name
                    else:
                        prev_index = ordered_keys.index(obj_key) - 1
                        for pk in reversed(ordered_keys[:prev_index + 1]):
                            test_path = cam_dir / label / f"{stem}_{pk}.png"
                            if test_path.exists():
                                input_name = test_path.name
                                break
                        if input_name == img_name:
                            test_path = cam_dir / label / f"{stem}_flooring.png"
                            if test_path.exists():
                                input_name = test_path.name

                    try:
                        result_bytes, thinking, prompt_run = edit_for_config(
                            c=c,
                            image_path=img_path,
                            obj_key=obj_key,
                            mask_bytes=mask_data,
                            image_bytes=model_bytes[label],
                            image_size=image_size,
                            env=env
                        )

                        if thinking and "ABORTED due to Common Sense Violation" in thinking:
                            print(f"│  🛑 Common Sense Violation detected by Gemini: {thinking}")
                            print(f"│  🛑 Aborting all remaining edits for {img_name}!")
                            model_thoughts[label][obj_key] = {
                                "prompt": prompt_run,
                                "input_name": input_name,
                                "output_photo": None,
                                "thinking": thinking
                            }
                            aborted_camera = True
                            continue

                        if result_bytes:
                            out_path = cam_dir / label / f"{stem}_{obj_key}.png"
                            out_path.write_bytes(result_bytes)
                            print(f"│  ✓ [{label}] Saved step → {out_path.relative_to(session_dir.parent)}")
                            model_bytes[label] = result_bytes
                            has_any_output[label] = True

                            model_thoughts[label][obj_key] = {
                                "prompt": prompt_run,
                                "input_photo": input_name,
                                "output_photo": out_path.name,
                                "thinking": thinking
                            }
                        else:
                            print(f"│  ✗ [{label}] No image returned")
                            model_thoughts[label][obj_key] = {
                                "prompt": prompt_run,
                                "input_photo": input_name,
                                "output_photo": None,
                                "thinking": thinking
                            }

                        if thinking:
                            print(f"│  💭 [{label}] Thinking Process:")
                            for line in thinking.splitlines():
                                print(f"│     {line}")

                    except ValueError as exc:
                        if "Aborting session" in str(exc):
                            print(f"│  🛑 Common Sense Violation detected by Gemini: {exc}")
                            print(f"│  🛑 Aborting all remaining edits for {img_name}!")
                            model_thoughts[label][obj_key] = {
                                "prompt": None,
                                "input_photo": input_name,
                                "output_photo": None,
                                "thinking": f"ABORTED due to Common Sense Violation: {exc}"
                            }
                            aborted_camera = True
                    except Exception as exc:
                        print(f"│  ✗ [{label}] Failed: {exc}")

                if aborted_camera:
                    break

        for c in resolved_configs:
            label = c["label"]
            if model_thoughts[label]:
                thoughts_path = cam_dir / label / "gemini_thoughts.json"
                with open(thoughts_path, "w") as f:
                    json.dump(model_thoughts[label], f, indent=2)
                print(f"│  📝 Saved [{label}] thoughts trace → {thoughts_path.relative_to(session_dir.parent)}")

        if not aborted_camera:
            for c in resolved_configs:
                label = c["label"]
                if has_any_output[label] and model_bytes[label]:
                    combined_path = session_dir / f"{stem}_{label}_combined.png"
                    combined_path.write_bytes(model_bytes[label])
                    print(f"│  🌟 Saved [{label}] combined render → {session_phrase}/{combined_path.name}")

        print(f"└─ Done.")
        if demo_cam is not None:
            break

    print(f"\n✓ All renders saved to {session_dir}/")
