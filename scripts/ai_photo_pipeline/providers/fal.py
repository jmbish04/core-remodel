"""Fal provider — model-aware argument construction.

Three distinct API shapes:
  bria/*              → instruction + image_url (singular)   [Bria FIBO-Edit]
  flux-2-pro/edit     → prompt + image_urls (plural, up to 9)
  kontext|nano-banana → prompt + image_url (singular)
"""
import io
import os
import tempfile

from PIL import Image

from ._io import _download


def _upload_fal(path, fal_key):
    import fal_client

    os.environ["FAL_KEY"] = fal_key
    return fal_client.upload_file(path)


def _upload_bytes_fal(data, fal_key, suffix=".png"):
    """Upload in-memory bytes via a temp file that is removed immediately after.

    Keeps transient upload artifacts OUT of the run's output_dir — only the
    stageN_*.png renders belong there. Returns the hosted URL.
    """
    import fal_client

    os.environ["FAL_KEY"] = fal_key
    fd, path = tempfile.mkstemp(prefix="fal_up_", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        return fal_client.upload_file(path)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def fal_run(model, prompt, image_bytes, references, env, mask=None):
    import fal_client

    fal_key = env["fal_key"]
    os.environ["FAL_KEY"] = fal_key

    # Normalize the working image to PNG in-memory, then upload via a temp file that is
    # deleted right after — nothing transient is left in output_dir (only stageN_*.png).
    buf = io.BytesIO()
    Image.open(io.BytesIO(image_bytes)).save(buf, "PNG")
    image_url = _upload_bytes_fal(buf.getvalue(), fal_key)

    # Reference images live in base_dir (persistent assets) — upload by path directly.
    ref_urls = [_upload_fal(path, fal_key) for path, _ in references or []]

    # Surgical mask (white = edit zone) for fill / Bria endpoints — temp upload, auto-deleted.
    mask_url = None
    if mask is not None:
        mask_url = _upload_bytes_fal(mask, fal_key)

    is_fill = "/fill" in model
    is_bria = model.startswith("bria/")
    is_flux2_edit = "flux-2" in model and "edit" in model

    if is_fill:
        # Flux Fill (e.g. fal-ai/flux-pro/v1/fill): freezes everything outside the white
        # mask region and only redraws inside it — the surgical Stage-2 path.
        args = {"image_url": image_url, "prompt": prompt}
        if mask_url:
            args["mask_url"] = mask_url
    elif is_bria:
        # Bria FIBO-Edit: a short, direct instruction + image_url (it promptifies to VGL JSON);
        # supports a native mask for region-locked edits.
        args = {
            "image_url": image_url,
            "instruction": prompt,
            "seed": 5555,
            "steps_num": 30,
            "guidance_scale": 5,
        }
        if mask_url:
            args["mask_url"] = mask_url
    elif is_flux2_edit:
        # Flux 2 Pro Edit: prompt + image_urls list (supports up to 9, @image syntax).
        args = {
            "prompt": prompt,
            "image_urls": [image_url] + ref_urls,
            "image_size": "auto",
            "output_format": "png",
        }
    else:
        # Kontext / Nano-Banana: prompt + image_url (singular).
        args = {"prompt": prompt, "image_url": image_url}

    def on_queue_update(update):
        if isinstance(update, fal_client.InProgress):
            for log in update.logs or []:
                print(f"    [fal] {log['message']}")

    result = fal_client.subscribe(
        model, arguments=args, with_logs=True, on_queue_update=on_queue_update
    )
    images = result.get("images") or ([result["image"]] if result.get("image") else [])
    if not images:
        raise RuntimeError(f"Fal returned no image (model {model}): {str(result)[:300]}")
    return _download(images[0]["url"])
