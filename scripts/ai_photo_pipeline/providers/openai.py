"""OpenAI image-edit provider via ``client.images.edit``.

- GPT image models (default ``gpt-image-1.5``; also ``gpt-image-1``, ``-mini``,
  ``gpt-image-2``, ``chatgpt-image-latest``) accept up to 16 input images and always
  return base64. ``input_fidelity="high"`` matches reference materials closely (not on -mini).
- ``dall-e-2`` (legacy) takes a single square PNG and returns a URL by default, so we
  request ``response_format="b64_json"``.

The ``openai`` package is imported lazily so the pipeline imports even when it is not
installed (only the selected stages need it).
"""
import base64
import os

from ._io import _guess_mime, _read

# GPT image models that support input_fidelity (per OpenAI docs; -mini does not).
_FIDELITY_MODELS = {"gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2-2026-04-21"}


def openai_edit(model, prompt, image_bytes, references, env, mask=None):
    # NOTE: OpenAI's mask convention is INVERTED vs FLUX (transparent alpha = edit region).
    # A white-edit FLUX mask would need converting to RGBA-transparent-edit before use here;
    # not wired yet since Stage 2 routes to the Fal fill model.
    from openai import OpenAI  # lazy import — only needed when an OpenAI stage runs

    client = OpenAI(api_key=env.get("openai_key") or os.environ.get("OPENAI_API_KEY"))

    if model == "dall-e-2":
        # Single square PNG; dall-e-2 defaults to a URL response, so force base64.
        result = client.images.edit(
            model=model,
            image=("image.png", image_bytes, "image/png"),
            prompt=prompt[:1000],
            size="1024x1024",
            n=1,
            response_format="b64_json",
        )
    else:
        # GPT image models: working image + reference images (up to 16); base64 by default.
        images = [("image.png", image_bytes, "image/png")]
        for path, _label in references or []:
            images.append((os.path.basename(path), _read(path), _guess_mime(path)))
        kwargs = {"model": model, "image": images, "prompt": prompt, "quality": "high"}
        if model in _FIDELITY_MODELS:
            kwargs["input_fidelity"] = "high"
        result = client.images.edit(**kwargs)

    data = getattr(result, "data", None) or []
    b64 = getattr(data[0], "b64_json", None) if data else None
    if not b64:
        raise RuntimeError(f"OpenAI returned no image (model {model})")
    return base64.b64decode(b64)
