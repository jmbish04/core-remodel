"""OpenAI image-edit provider via ``client.images.edit``.

- GPT image models (default ``gpt-image-1.5``; also ``gpt-image-1``, ``-mini``,
  ``gpt-image-2``, ``gpt-image-latest``) accept up to 16 input images and always
  return base64. ``input_fidelity="high"`` matches reference materials closely (not on -mini).
- ``dall-e-2`` (legacy) takes a single square PNG and returns a URL by default, so we
  request ``response_format="b64_json"``.

The ``openai`` package is imported lazily so the pipeline imports even when it is not
installed (only the selected stages need it).
"""
import base64
import io
import os
from PIL import Image, ImageOps

from ._io import _guess_mime, _read

# GPT image models that support input_fidelity (per OpenAI docs; -mini and -2 do not).
_FIDELITY_MODELS = {"gpt-image-1", "gpt-image-1.5"}


def openai_edit(model, prompt, image_bytes, references, env, mask=None):
    from openai import OpenAI  # lazy import — only needed when an OpenAI stage runs

    client = OpenAI(api_key=env.get("openai_key") or os.environ.get("OPENAI_API_KEY"))

    # Track original size for restoring output geometry alignment
    with Image.open(io.BytesIO(image_bytes)) as img:
        orig_w, orig_h = img.size

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
        # Apply modulo 16 resolution constraints required by gpt-image models
        w, h = orig_w, orig_h
        new_w = w - (w % 16)
        new_h = h - (h % 16)
        
        with Image.open(io.BytesIO(image_bytes)) as img:
            if (new_w, new_h) != (w, h):
                img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            
            out_io = io.BytesIO()
            img.save(out_io, format="PNG")
            processed_image_bytes = out_io.getvalue()
            
            # Update w, h for the mask logic below
            w, h = new_w, new_h

        images = [("image.png", processed_image_bytes, "image/png")]
        for path, _label in references or []:
            images.append((os.path.basename(path), _read(path), _guess_mime(path)))
            
        kwargs = {
            "model": model, 
            "image": images, 
            "prompt": prompt, 
            "quality": "high",
            "response_format": "b64_json"
        }
        
        if model in _FIDELITY_MODELS:
            kwargs["input_fidelity"] = "high"
            
        if mask:
            # FLUX/Gemini masks are white for edit, black for preserve.
            # OpenAI requires an RGBA PNG where edit area is transparent (alpha=0).
            with Image.open(io.BytesIO(mask)) as mask_img:
                mask_gray = mask_img.convert("L").resize((w, h), Image.Resampling.LANCZOS)
                inv_mask = ImageOps.invert(mask_gray)
                mask_rgba = Image.new("RGBA", (w, h), (0, 0, 0, 0))
                mask_rgba.putalpha(inv_mask)
                mask_io = io.BytesIO()
                mask_rgba.save(mask_io, format="PNG")
                kwargs["mask"] = ("mask.png", mask_io.getvalue(), "image/png")
                
        try:
            result = client.images.edit(**kwargs)
        except Exception as e:
            if "response_format" in str(e) or "Unknown parameter" in str(e):
                kwargs.pop("response_format", None)
                result = client.images.edit(**kwargs)
            else:
                raise e

    data = getattr(result, "data", None) or []
    b64 = getattr(data[0], "b64_json", None) if data else None
    if not b64:
        raise RuntimeError(f"OpenAI returned no image (model {model})")
    
    decoded = base64.b64decode(b64)
    # Restore to original dimensions if resized to maintain coordinate space parity
    with Image.open(io.BytesIO(decoded)) as ret_img:
        if ret_img.size != (orig_w, orig_h):
            ret_img_resized = ret_img.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
            out_io = io.BytesIO()
            ret_img_resized.save(out_io, format="PNG")
            return out_io.getvalue()
    return decoded
