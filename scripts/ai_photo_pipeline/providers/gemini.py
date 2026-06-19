"""Gemini 3 Pro Image provider — edits the working image, pins output framing."""
from google.genai import types

from ..framing import aspect_ratio_for, build_generation_config
from ._io import _guess_mime, _read


def gemini_generate(model, prompt, image_bytes, references, env, mask=None):
    # mask is unused: Gemini has no pixel-mask; preservation is prompt-driven.
    """Gemini 3 Pro Image edit. Feeds the working image + scoped refs, pins framing."""
    client = env["gemini_client"]
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
    if (not response.candidates or not response.candidates[0].content
            or not response.candidates[0].content.parts):
        raise RuntimeError(f"Gemini returned no content (model {model}). Response: {response!r}")
    for part in response.candidates[0].content.parts:
        inline = getattr(part, "inline_data", None)
        if inline and inline.data:
            return inline.data
    raise RuntimeError(f"Gemini returned no image (model {model}). Text: {response.text!r}")
