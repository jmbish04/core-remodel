"""Gemini 3 Pro Image provider — edits the working image, pins output framing."""
import base64
import io
import json
from pathlib import Path
from typing import Literal, cast, Any
from PIL import Image
from google.genai import types

from ..framing import aspect_ratio_for, build_generation_config
from ._io import _guess_mime, _read, _client

# Gemini ratio values for aspect ratio mapping
RATIO_VALUES = {
    "1:1": 1.0,
    "3:4": 3 / 4,
    "4:3": 4 / 3,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "5:4": 5 / 4,
    "4:5": 4 / 5,
}


def gemini_generate(model, prompt, image_bytes, references, env, mask=None):
    # mask is unused: Gemini has no pixel-mask; preservation is prompt-driven.
    """Gemini 3 Pro Image edit. Feeds the working image + scoped refs, pins framing."""
    client = env.get("gemini_client") or _client()
    parts = [
        types.Part.from_text(text=prompt),
        types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
    ]
    for path, label in references or []:
        parts.append(types.Part.from_text(text=f"Reference — {label}:"))
        parts.append(types.Part.from_bytes(data=_read(path), mime_type=_guess_mime(path)))

    response = client.models.generate_content(
        model=model,
        contents=[types.Content(role="user", parts=parts)],
        config=build_generation_config(aspect_ratio_for(image_bytes)),
    )
    if (not response.candidates or response.candidates[0] is None
            or not response.candidates[0].content
            or not response.candidates[0].content.parts):
        raise RuntimeError(f"Gemini returned no content (model {model}). Response: {response!r}")
    for part in response.candidates[0].content.parts:
        inline = getattr(part, "inline_data", None)
        if inline and inline.data:
            return inline.data
    raise RuntimeError(f"Gemini returned no image (model {model}). Text: {response.text!r}")


def segment_image(image_path: Path | str, query: str, model_fast: str = "gemini-2.5-flash") -> dict:
    """Analyse an image and suggest a placement box for *query*.

    Uses the fast ``gemini-2.5-flash`` model (text-only output) for speed.
    Returns::

        {"masks": [{"label": str, "box_2d": [x, y, w, h]}]}

    Coordinates are normalised 0-1 (top-left origin).
    """
    from google.genai import types as gtypes

    raw = Path(image_path).read_bytes()

    prompt_text = (
        f"Analyze this image of an empty room and suggest where a {query} should be "
        f"placed, considering the room's architecture, perspective, and typical "
        f"interior design placement.\n\n"
        f"Return a JSON object with this exact structure:\n"
        f'{{\n'
        f'  "masks": [\n'
        f'    {{\n'
        f'      "label": "suggested placement for {query}",\n'
        f'      "box_2d": [x, y, width, height]\n'
        f'    }}\n'
        f'  ]\n'
        f'}}\n\n'
        f"x, y, width, height are normalised 0-1 (top-left origin).  "
        f"If the {query} would not logically be visible from this camera angle, "
        f'return {{"masks": []}}.'
    )

    response = _client().models.generate_content(
        model=model_fast,
        contents=[
            gtypes.Content(role="user", parts=[
                gtypes.Part.from_text(text=prompt_text),
                gtypes.Part.from_bytes(data=raw, mime_type=_guess_mime(image_path)),
            ]),
        ],
        config=gtypes.GenerateContentConfig(response_mime_type="application/json"),
    )

    candidates = response.candidates
    if not candidates or not candidates[0].content or not candidates[0].content.parts:
        return {"masks": []}
    text = candidates[0].content.parts[0].text or ""
    return json.loads(text) if text else {"masks": []}


def edit_with_references(
    image_path: Path,
    obj_key: str,
    mask_bytes: bytes | None = None,
    *,
    image_size: str = "2K",
    model: str = "gemini-3.1-flash-image",
    image_bytes: bytes | None = None,
    reference_images: list[tuple[Path, str, list[str]]] | None = None,
    object_edit_instructions: dict[str, str] | None = None,
    build_edit_prompt_fn: Any = None,
) -> tuple[bytes | None, str | None, str]:
    """Edit a blank-canvas image using the ``interactions.create()`` API
    with multiple reference images for high-fidelity material matching.
    """
    canvas_bytes = image_bytes if image_bytes is not None else image_path.read_bytes()
    canvas_mime = _guess_mime(image_path)

    # Collect references relevant to this object
    ref_parts = []
    if reference_images:
        for ref_path, ref_label, applies_to in reference_images:
            if not ref_path.exists():
                continue
            # Include global refs (empty applies_to) or refs matching this object
            if applies_to and obj_key not in applies_to:
                continue
            ref_data = ref_path.read_bytes()
            ref_parts.append({
                "type": "image",
                "data": base64.b64encode(ref_data).decode("utf-8"),
                "mime_type": _guess_mime(ref_path),
            })
            ref_parts.append({
                "type": "text",
                "text": (
                    f'Reference — "{ref_label}": Use ONLY for its material, color, '
                    f"veining, and form. IGNORE its camera angle, background, and lighting."
                ),
            })

    # Build prompt
    prompt = ""
    if build_edit_prompt_fn:
        prompt = build_edit_prompt_fn(
            object_edit_instructions.get(obj_key, f"Place {obj_key.replace('_', ' ')} here.") if object_edit_instructions else f"Place {obj_key.replace('_', ' ')} here.",
            mask_image=mask_bytes,
            obj_key=obj_key,
            image_path=image_path,
        )

    # Build the input payload
    input_parts: list[dict] = [
        {
            "type": "image",
            "data": base64.b64encode(canvas_bytes).decode("utf-8"),
            "mime_type": canvas_mime,
        },
    ]
    if mask_bytes:
        input_parts.append({
            "type": "image",
            "data": base64.b64encode(mask_bytes).decode("utf-8"),
            "mime_type": "image/png",
        })
        input_parts.append({
            "type": "text",
            "text": "The second image is a pixel-for-pixel binary mask: white (255) = edit zone where the new element must be placed, black (0) = preserve areas from the provided input image exactly.",
        })
    input_parts.extend(ref_parts)
    input_parts.append({"type": "text", "text": prompt})

    # Determine aspect ratio from canvas
    with Image.open(io.BytesIO(canvas_bytes)) as img:
        w, h = img.size
        ratio = w / h

    # Find the closest Gemini aspect ratio
    aspect = min(RATIO_VALUES.keys(), key=lambda k: abs(RATIO_VALUES[k] - ratio))
    sdk_image_size = cast(Literal['512', '1K', '2K', '4K'], image_size)

    interaction = _client().interactions.create(
        model=model,
        input=input_parts,  # type: ignore[arg-type]
        generation_config=cast(
            Any,
            {
                "thinking_config": {"thinking_budget": 1024}
            }
        ),
        response_format={
            "type": "image",
            "mime_type": "image/jpeg",
            "aspect_ratio": aspect,
            "image_size": sdk_image_size,
        },
    )

    output_image: bytes | None = None
    thinking_parts: list[str] = []
    steps = getattr(interaction, "steps", None) or []
    for step in steps:
        if step.type == "thought":
            for block in (step.summary or []):
                if block.type == "text" and block.text:
                    thinking_parts.append(block.text)
        if step.type == "model_output":
            for block in (step.content or []):
                if block.type == "image" and block.data:
                    output_image = base64.b64decode(block.data)
                elif block.type == "text" and block.text:
                    txt = block.text.strip()
                    if "COMMON_SENSE_VIOLATION" in txt or "ERROR" in txt:
                        raise ValueError(f"Aborting session: {txt}")

    if output_image is None:
        out_img = getattr(interaction, "output_image", None)
        if out_img and out_img.data:
            output_image = base64.b64decode(out_img.data)

    thinking_text = "\n".join(thinking_parts) if thinking_parts else None
    return output_image, thinking_text, prompt


def refine_edit_chat(
    initial_image: bytes,
    refinement_prompts: list[str],
    *,
    model: str = "gemini-3.1-flash-image",
) -> list[bytes]:
    """Iteratively refine an image through a multi-turn chat session."""
    from google.genai import types as gtypes

    chat = _client().chats.create(
        model=model,
        config=gtypes.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
        ),
    )

    results: list[bytes] = []
    current_data = initial_image

    for i, prompt in enumerate(refinement_prompts, 1):
        print(f"  Refinement {i}/{len(refinement_prompts)}: {prompt[:80]}…")
        response = chat.send_message(
            message=[
                gtypes.Part.from_bytes(data=current_data, mime_type="image/png"),
                prompt,
            ],
        )
        candidates = response.candidates
        if candidates and candidates[0].content and candidates[0].content.parts:
            for part in candidates[0].content.parts:
                if part.inline_data and part.inline_data.data:
                    current_data = part.inline_data.data
                    break
        results.append(current_data)

    return results
