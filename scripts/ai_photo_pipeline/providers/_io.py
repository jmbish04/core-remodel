"""Shared IO helpers used by every provider module."""
import os

import requests

from .. import config


def _read(path):
    with open(path, "rb") as fh:
        return fh.read()


def _guess_mime(path):
    return "image/png" if path.lower().endswith(".png") else "image/jpeg"


def _download(url):
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return resp.content


def save_image(image_bytes, path):
    with open(path, "wb") as fh:
        fh.write(image_bytes)
    print(f"  saved {path}")


def ref(filename, label):
    """Build a (filepath, label) reference tuple if the file exists, else None."""
    path = os.path.join(config.base_dir, filename)
    return (path, label) if os.path.exists(path) else None
