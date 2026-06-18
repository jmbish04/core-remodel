"""Replicate provider — model-aware (BFL flux-depth-pro + flux-kontext-max).

flux-depth-pro uses `control_image` + `guidance` + `steps`.
flux-kontext-max uses `image` + standard params. Replicate is async: create a
prediction, then poll (we also send `Prefer: wait` to block where supported).
"""
import base64
import time

import requests

from ..framing import aspect_ratio_for
from ._io import _download


def replicate_run(model, prompt, image_bytes, references, env, mask=None):
    # mask currently unused here (no fill model wired on Replicate; depth-pro is depth-conditioned).
    token = env["replicate_token"]
    data_uri = "data:image/png;base64," + base64.b64encode(image_bytes).decode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "wait",
    }

    if "depth" in model.lower():
        inp = {
            "prompt": prompt,
            "control_image": data_uri,
            "guidance": 30,
            "steps": 50,
            "output_format": "png",
        }
    else:
        inp = {"prompt": prompt, "image": data_uri, "aspect_ratio": aspect_ratio_for(image_bytes)}

    res = requests.post(
        f"https://api.replicate.com/v1/models/{model}/predictions",
        headers=headers,
        json={"input": inp},
        timeout=180,
    )
    res.raise_for_status()
    pred = res.json()

    deadline = time.time() + 180
    while pred.get("status") in ("starting", "processing"):
        if time.time() > deadline:
            raise RuntimeError(f"Replicate timed out (model {model})")
        time.sleep(3)
        poll = requests.get(
            pred["urls"]["get"], headers={"Authorization": f"Bearer {token}"}, timeout=60
        )
        poll.raise_for_status()
        pred = poll.json()

    if pred.get("status") != "succeeded":
        raise RuntimeError(f"Replicate {pred.get('status')} (model {model}): {pred.get('error')}")

    output = pred.get("output")
    if isinstance(output, list):
        url = output[0]
    elif isinstance(output, str):
        url = output
    elif hasattr(output, "url"):
        url = output.url
    else:
        url = str(output)
    if not url:
        raise RuntimeError(f"Replicate produced no image URL (model {model})")
    return _download(url)
